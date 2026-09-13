import { NextRequest, NextResponse } from "next/server";
import { getAllIdeas, getManifest } from "../../../lib/dataset";
import { buildIndex, search, getDocs } from "../../../lib/similarity";
import { generateExternalQueries } from "../../../lib/ai-query-gen";
import { isShoppingConfigured, searchShopping } from "../../../lib/ebay-shopping";
import { isPatentSearchConfigured, searchPatents } from "../../../lib/kipris";
import { rankAndDiagnose } from "../../../lib/ai-rank";
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
          report: null,
          warnings: [],
        };

        let productItems: ProductResultItem[] = [];
        let patentItems: PatentResultItem[] = [];

        if (useAi) {
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
          } else if (aiMeta.shoppingAvailable) {
            aiMeta.warnings.push("쇼핑 검색을 불러오지 못했습니다.");
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

        controller.enqueue(encodeEvent({ stage: "complete", result }));
      } catch (e) {
        controller.enqueue(encodeEvent({ stage: "error", message: e instanceof Error ? e.message : String(e) }));
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
