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

// AI 토글 사용 시 OpenRouter(쿼리 생성 + 랭킹) + 네이버쇼핑/KIPRIS가 체이닝되어
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

  // 1) 로컬 TF-IDF 검색 — useAi 여부와 무관하게 항상 실행되는 무료/즉시 경로
  const competitionRaw = search(INDEX, query, ALL_DOCS, 15);
  let competitionItems: CompetitionResultItem[] = competitionRaw.map((m) => ({
    type: "competition",
    score: m.score,
    idea: m.item as Idea,
  }));

  const aiMeta: AiMeta = {
    used: useAi,
    shoppingAvailable: isShoppingConfigured(),
    patentAvailable: isPatentSearchConfigured(),
    kiprisQuery: null,
    shoppingQuery: null,
    report: null,
    warnings: [],
  };

  let productItems: ProductResultItem[] = [];
  let patentItems: PatentResultItem[] = [];

  if (useAi) {
    const gen = await generateExternalQueries(query);
    aiMeta.kiprisQuery = gen.kiprisQuery;
    aiMeta.shoppingQuery = gen.shoppingQuery;
    if (gen.warning) aiMeta.warnings.push(gen.warning);

    const [shopRes, patRes] = await Promise.allSettled([
      searchShopping(gen.shoppingQuery),
      searchPatents(gen.kiprisQuery),
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
    } else if (aiMeta.patentAvailable) {
      aiMeta.warnings.push("특허 검색을 불러오지 못했습니다.");
    }

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
  }

  aiMeta.warnings = [...new Set(aiMeta.warnings)];

  const response: SearchResponse = {
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

  return NextResponse.json(response);
}
