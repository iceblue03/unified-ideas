import { after, NextRequest, NextResponse } from "next/server";
import { getAllIdeas, getManifest } from "../../../lib/dataset";
import { buildIndex, search, getDocs } from "../../../lib/similarity";
import { generateExternalQueries } from "../../../lib/ai-query-gen";
import { isShoppingConfigured, searchShopping } from "../../../lib/ebay-shopping";
import { isPatentSearchConfigured, searchPatents } from "../../../lib/kipris";
import { rankAndDiagnose } from "../../../lib/ai-rank";
import { callOpenRouter } from "../../../lib/openrouter";
import { getSessionFromRequest } from "../../../lib/session";
import { logSearch } from "../../../lib/sheets-log";
import type {
  AiMeta,
  CompetitionResultItem,
  Idea,
  PatentResultItem,
  ProductResultItem,
  UnifiedResultItem,
} from "../../../lib/types";

const ALL_IDEAS = getAllIdeas();
const INDEX = buildIndex(
  ALL_IDEAS.map((item) => ({
    item,
    title: item.title,
    body: [item.summary, item.category].filter(Boolean).join(" "),
  })),
);
const ALL_DOCS = getDocs(INDEX);

// AI 토글 사용 시 OpenRouter(쿼리 생성 + 랭킹) + eBay/KIPRIS가 체이닝되어
// 무료 모델 지연시간에 따라 20~30초까지 걸릴 수 있다. 이 저장소는 Vercel 무료
// 플랜을 대상으로 하므로(README 참고) 기본 함수 실행 제한보다 여유를 둔다.
export const maxDuration = 60;

export interface SearchResponse {
  query: string;
  useAi: boolean;
  totalIndexed: number;
  manifest: ReturnType<typeof getManifest>;
  results: {
    competition: CompetitionResultItem[];
    product: ProductResultItem[];
    patent: PatentResultItem[];
  };
  aiMeta: AiMeta;
}

/**
 * AI 검색은 내부적으로 4단계(대회 검색 → 검색어 생성 → 특허/제품 검색 → AI 랭킹)를
 * 거치는데, 예전엔 이 전체가 하나의 JSON 응답으로만 끝나서 프론트가 "요청 중"과
 * "완료"밖에 몰랐다(스피너 하나가 20~30초 내내 도는 것처럼 보임). 실제로 존재하는
 * 단계 그대로를 NDJSON(줄바꿈 구분 JSON) 스트림으로 내보낸다 — 가짜 단계를
 * 만들지 않는다. useAi가 false면 competition_done → complete만 거의 즉시 발생한다.
 */
export type SearchStreamEvent =
  | { stage: "competition_done"; competitionCount: number }
  | { stage: "query_gen_done"; kiprisKeywords: string[]; shoppingQuery: string }
  | { stage: "external_search_done"; productCount: number; patentCount: number }
  | { stage: "ai_rank_done" }
  | { stage: "complete"; result: SearchResponse }
  | { stage: "error"; message: string };

function sortByBestScore<T extends UnifiedResultItem>(items: T[]): T[] {
  return [...items].sort((a, b) => (b.aiScore ?? b.score) - (a.aiScore ?? a.score));
}

/**
 * 일부 수집기는 원본이 이미지/PDF뿐이라 summary가 비어있거나 아주 짧을 수 있다
 * (esw-contest, code-fair, capstone-design 등 — lib/collector-meta.ts 참고).
 * AI 검색에 그런 후보가 상위로 걸리면, 사용자에게 보여주는 결과는 그대로 두되
 * (aiMeta.warnings에 짧은 참고 문구 한 줄만 추가) 응답을 막지 않는 별도 요청으로
 * "왜 데이터가 부족한지, attachments를 보면 무엇을 더 보강해야 하는지"를 모델에게
 * 물어 서버 로그에만 남긴다 — 사람이 나중에 수집기를 개선할 단서로 쓰기 위함이다.
 */
function isIncompleteIdea(idea: Idea): boolean {
  return (idea.summary?.trim().length ?? 0) < 20;
}

async function fireHiddenDataDiagnostic(query: string, incomplete: Idea[]): Promise<void> {
  const listText = incomplete
    .map((idea, i) => {
      const hasAttachments = (idea.attachments?.length ?? 0) > 0;
      return (
        `${i + 1}. [${idea.competitionName}] ${idea.title}${idea.sourceUrl ? ` (원본: ${idea.sourceUrl})` : ""}` +
        (hasAttachments ? " — 첨부/이미지 있음, summary 텍스트 없음" : " — summary 없음, 첨부도 없음")
      );
    })
    .join("\n");

  const prompt =
    `다음은 검색 결과 상위 후보인데 설명(summary) 데이터가 비어있거나 매우 짧다:\n\n${listText}\n\n` +
    `각 항목에 대해 (1) 왜 데이터가 부족할 것으로 추정되는지 (2) 원본을 보강하려면 무엇을 ` +
    `추가로 수집해야 하는지 한두 문장씩만 진단해줘. 이 응답은 사용자에게 보여주지 않고 운영 로그로만 쓴다.`;

  const res = await callOpenRouter(prompt, 10_000);
  if (res.ok) {
    console.log(`[data-diagnostic] query="${query.slice(0, 80)}" items=${incomplete.length}\n${res.text}`);
  } else {
    console.warn("[data-diagnostic] failed:", res.error);
  }
}

export async function POST(req: NextRequest) {
  let body: { query?: string; useAi?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  if (!query || query.length < 2) {
    return NextResponse.json({ error: "query가 너무 짧습니다 (2자 이상 입력해주세요)" }, { status: 400 });
  }
  if (query.length > 2000) {
    return NextResponse.json({ error: "query가 너무 깁니다 (2000자 이하)" }, { status: 400 });
  }
  const useAi = body.useAi === true;
  const startTs = Date.now();

  // 쿠키(Set-Cookie 포함 응답 헤더)는 스트림의 첫 청크가 나가는 순간 확정되고 그
  // 이후로는 바꿀 수 없으므로, anon_id 생성/읽기와 로그인 세션 읽기는 반드시
  // ReadableStream을 만들기 전에 여기서 동기적으로 끝내야 한다.
  const existingAnonId = req.cookies.get("anon_id")?.value;
  const anonId = existingAnonId ?? crypto.randomUUID();
  const session = await getSessionFromRequest(req);

  const encoder = new TextEncoder();
  function encodeEvent(event: SearchStreamEvent): Uint8Array {
    return encoder.encode(JSON.stringify(event) + "\n");
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 1) 로컬 TF-IDF 검색 — useAi 여부와 무관하게 항상 실행되는 무료/즉시 경로
        const competitionRaw = search(INDEX, query, ALL_DOCS, 15);
        let competitionItems: CompetitionResultItem[] = competitionRaw.map((m) => ({
          type: "competition",
          score: m.score,
          idea: m.item as Idea,
        }));
        controller.enqueue(encodeEvent({ stage: "competition_done", competitionCount: competitionItems.length }));

        const aiMeta: AiMeta = {
          used: useAi,
          shoppingAvailable: isShoppingConfigured(),
          patentAvailable: isPatentSearchConfigured(),
          kiprisQuery: null,
          kiprisKeywords: null,
          kiprisItemCount: null,
          kiprisFallbackUsed: false,
          shoppingQuery: null,
          shoppingItemCount: null,
          report: null,
          warnings: [],
        };

        let productItems: ProductResultItem[] = [];
        let patentItems: PatentResultItem[] = [];

        if (useAi) {
          // 사용자 응답과는 무관하게, 실패하거나 느려도 아래 흐름을 막지 않는 백그라운드 진단.
          // after()로 감싸 응답 전송 이후에도 (Vercel의 waitUntil을 통해) 끝까지 실행되게 한다.
          const incompleteTop = competitionItems
            .slice(0, 5)
            .map((c) => c.idea)
            .filter(isIncompleteIdea);
          if (incompleteTop.length > 0) {
            after(() => fireHiddenDataDiagnostic(query, incompleteTop));
            aiMeta.warnings.push("일부 후보는 원문이 이미지/스캔본이라 설명이 제한적일 수 있어요.");
          }

          const gen = await generateExternalQueries(query);
          aiMeta.kiprisKeywords = gen.kiprisKeywords;
          aiMeta.shoppingQuery = gen.shoppingQuery;
          if (gen.warning) aiMeta.warnings.push(gen.warning);
          controller.enqueue(
            encodeEvent({ stage: "query_gen_done", kiprisKeywords: gen.kiprisKeywords, shoppingQuery: gen.shoppingQuery }),
          );

          const [shopRes, patRes] = await Promise.allSettled([
            searchShopping(gen.shoppingQuery),
            searchPatents(gen.kiprisKeywords),
          ]);

          if (shopRes.status === "fulfilled" && shopRes.value.ok) {
            productItems = shopRes.value.items.map((product, i) => ({
              type: "product" as const,
              score: 1 - i / 10,
              product,
            }));
            // 성공했을 때만 채운다 — 그래야 "확인 안 됨"(null)과 "확인했지만 0건"이 구분된다.
            aiMeta.shoppingItemCount = shopRes.value.items.length;
          } else if (aiMeta.shoppingAvailable) {
            const detail =
              shopRes.status === "fulfilled"
                ? shopRes.value.error
                : shopRes.reason instanceof Error
                  ? shopRes.reason.message
                  : String(shopRes.reason);
            console.warn(`[shopping] search failed: ${detail ?? "unknown error"}`);
            aiMeta.warnings.push(`쇼핑 검색을 불러오지 못했습니다.${detail ? ` (${detail})` : ""}`);
          }

          if (patRes.status === "fulfilled" && patRes.value.ok) {
            patentItems = patRes.value.items.map((patent, i) => ({
              type: "patent" as const,
              score: 1 - i / 10,
              patent,
            }));
            // 성공했을 때만 채운다 — 그래야 "확인 안 됨"(null)과 "확인했지만 0건"이 구분된다.
            aiMeta.kiprisQuery = patRes.value.queryUsed ?? null;
            aiMeta.kiprisItemCount = patRes.value.items.length;
            aiMeta.kiprisFallbackUsed = patRes.value.fallbackUsed ?? false;
          } else if (aiMeta.patentAvailable) {
            aiMeta.warnings.push("특허 검색을 불러오지 못했습니다.");
          }
          controller.enqueue(
            encodeEvent({
              stage: "external_search_done",
              productCount: productItems.length,
              patentCount: patentItems.length,
            }),
          );

          const pool: UnifiedResultItem[] = [...competitionItems, ...productItems, ...patentItems];
          if (pool.length > 0) {
            const ranked = await rankAndDiagnose(query, pool);
            aiMeta.report = ranked.report;
            if (ranked.warning) aiMeta.warnings.push(ranked.warning);
            // aiScore가 채워졌으면 그 기준으로, 실패해 못 채워졌으면 원래 score 기준으로 정렬(no-op)
            competitionItems = sortByBestScore(competitionItems);
            productItems = sortByBestScore(productItems);
            patentItems = sortByBestScore(patentItems);
          }
          controller.enqueue(encodeEvent({ stage: "ai_rank_done" }));
        }

        aiMeta.warnings = [...new Set(aiMeta.warnings)];

        const result: SearchResponse = {
          query,
          useAi,
          totalIndexed: ALL_IDEAS.length,
          manifest: getManifest(),
          results: {
            competition: competitionItems,
            product: productItems,
            patent: patentItems,
          },
          aiMeta,
        };

        after(() =>
          logSearch({
            timestamp: new Date(startTs).toISOString(),
            query: query.slice(0, 500),
            useAi,
            identity: session ? session.email : `anon:${anonId}`,
            loggedIn: !!session,
            competitionCount: competitionItems.length,
            productCount: productItems.length,
            patentCount: patentItems.length,
            kiprisKeywords: aiMeta.kiprisKeywords,
            kiprisQuery: aiMeta.kiprisQuery,
            kiprisItemCount: aiMeta.kiprisItemCount,
            kiprisFallbackUsed: aiMeta.kiprisFallbackUsed,
            shoppingQuery: aiMeta.shoppingQuery,
            verdict: aiMeta.report?.verdict ?? "none",
            aiSummary: (aiMeta.report?.summary ?? "").slice(0, 300),
            latencyMs: Date.now() - startTs,
            warnings: aiMeta.warnings.join("; "),
          }),
        );

        controller.enqueue(encodeEvent({ stage: "complete", result }));
      } catch (e) {
        controller.enqueue(encodeEvent({ stage: "error", message: e instanceof Error ? e.message : String(e) }));
      } finally {
        controller.close();
      }
    },
  });

  const response = new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
  if (!existingAnonId) {
    response.cookies.set("anon_id", anonId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}
