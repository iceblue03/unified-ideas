import { callOpenRouter } from "./openrouter";
import { extractJson } from "./ai-json";

/**
 * AI 호출 #1: 사용자의 아이디어 설명 원문은 KIPRIS나 쇼핑 API에 그대로 넣기엔
 * 부적합하므로, 핵심 기술을 뽑아 KIPRIS 키워드를, 실제 유사 제품이 나올만한
 * 쇼핑 검색어를 각각 생성한다. 실패 시에는 사용자 원문(잘라서)으로 폴백해
 * 이 단계가 죽어도 KIPRIS/쇼핑 검색 자체는 계속 시도할 수 있게 한다.
 *
 * kiprisQuery는 예전엔 자연어 한 구절("라이다 기반 보행 보조 장치")을 그대로
 * KIPRIS word= 파라미터에 넘겼는데, KIPRIS는 AND(*)/OR(+)/NOT(!) 같은 불리언
 * 연산자로 조립된 검색식을 기대하지 지금부터는 사람이 읽는 자연어 구절이 아니라
 * 공백 없는 핵심 키워드 2~4개(kiprisKeywords)를 따로 받아, 실제 검색식 조립은
 * lib/kipris.ts에서 코드로 직접 한다(LLM이 KIPRIS 검색식 문법을 안정적으로
 * 낼 거라고 믿지 않는다).
 */
export interface GeneratedQueries {
  kiprisKeywords: string[];
  /** 핵심 사물의 동의어. 같은 AND에 넣지 않고 사물 자리만 바꿔 따로 검색한다. */
  kiprisAltKeywords: string[];
  shoppingQuery: string;
  /** 구체적인 영어 상품명부터. 앞의 검색이 0건이면 다음을 시도한다. */
  shoppingQueries: string[];
  warning?: string;
}

/**
 * AI 호출 자체가 실패했을 때 쓰는 폴백. 예전엔 원문 전체를 통짜 문장 그대로 하나의
 * "키워드"로 던졌는데, 그러면 lib/kipris.ts의 AND 검색이 자연어 어순·조사가 그대로
 * 낀 문장과 실제 특허 문서 표현을 거의 못 맞춰 항상 0건으로 귀결됐다(정확히 이 버그가
 * lib/kipris.ts 주석에 적힌 "예전 방식"의 근본 원인). 최소한 공백 기준으로 단어를
 * 쪼개 여러 키워드를 만들어주면, kipris.ts가 이미 갖고 있는 "키워드를 하나씩 줄여가며
 * 재시도" 로직이 정상적으로 동작할 여지가 생긴다.
 */
const FALLBACK_SKIP = new Set(["위한", "위해", "통한", "그리고", "있는", "하는", "ai"]);

function fallbackQueries(ideaText: string, warning: string): GeneratedQueries {
  const trimmed = ideaText.trim();
  const shoppingQuery = trimmed.slice(0, 60);
  const kiprisKeywords = trimmed
    .split(/\s+/)
    .map((w) => w.trim().replace(/(?:을|를|의|과|와)$/u, ""))
    .filter((w) => w.length > 1 && !FALLBACK_SKIP.has(w.toLowerCase()))
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
  return {
    kiprisKeywords: kiprisKeywords.length > 0 ? kiprisKeywords : shoppingQuery ? [shoppingQuery] : [],
    kiprisAltKeywords: [],
    shoppingQuery,
    shoppingQueries: shoppingQuery ? [shoppingQuery] : [],
    warning,
  };
}

function asKeywordList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((k): k is string => typeof k === "string")
    .map((k) => k.trim().replace(/\s+/g, ""))
    .filter((k) => k.length > 0)
    .slice(0, limit);
}

function asShoppingQueries(value: unknown, single: string): string[] {
  const fromList = Array.isArray(value)
    ? value
        .filter((k): k is string => typeof k === "string")
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
        .slice(0, 3)
    : [];
  const queries = fromList.length > 0 ? fromList : single ? [single] : [];
  const seen = new Set<string>();
  return queries.filter((q) => {
    const key = q.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generateExternalQueries(ideaText: string): Promise<GeneratedQueries> {
  const prompt =
    `다음은 사용자가 구상 중인 아이디어입니다:\n"""\n${ideaText.slice(0, 1500)}\n"""\n\n` +
    `이 아이디어를 검색용 정보로 변환하세요. 실제 검색 로그에서 확인한 규칙을 지키세요.\n` +
    `1. kiprisKeywords: 특허 제목에 이미 쓰이는 핵심 사물 명사 1개만. ` +
    `지팡이면 "안내지팡이"처럼 제목에 있는 말 그대로. 기능이나 기술을 붙여 새 단어를 만들지 마세요.\n` +
    `- 오답: "촉각점자", "점자디스플레이", "장애물감지", "인공지능", "스마트". ` +
    `이 말들은 사물과 AND로 묶으면 특허가 0건이 되거나 다른 제품이 나왔습니다.\n` +
    `2. kiprisAltKeywords: 그 사물의 다른 특허 명칭 1~2개. 예: ["흰지팡이", "점자지팡이"]. ` +
    `기능어는 넣지 마세요. 동의어만.\n` +
    `3. shoppingQueries: eBay 영어 상품명 정확히 3개. 서로 다른 상품을 가리켜야 합니다. ` +
    `각 2~4단어. 검색어에 AI를 넣지 마세요. 카탈로그 제목은 AI라고 적지 않아 0건이 됩니다.\n` +
    `예: ["smart cane", "electronic white cane", "blind walking stick"]. 한국어는 오답입니다.\n\n` +
    `다른 설명 없이 아래 스키마의 순수 JSON 객체 "하나만" 출력하세요.\n\n` +
    `{\n  "kiprisKeywords": ["..."],\n  "kiprisAltKeywords": ["...", "..."],\n  "shoppingQueries": ["...", "...", "..."]\n}`;

  const res = await callOpenRouter(prompt, 8_000);
  if (!res.ok) {
    return fallbackQueries(ideaText, res.error);
  }

  const jsonStr = extractJson(res.text);
  if (!jsonStr) {
    return fallbackQueries(ideaText, "검색어 생성 응답을 해석하지 못했습니다.");
  }

  try {
    const raw = JSON.parse(jsonStr) as {
      kiprisKeywords?: unknown;
      kiprisAltKeywords?: unknown;
      shoppingQuery?: unknown;
      shoppingQueries?: unknown;
    };
    const kiprisKeywords = asKeywordList(raw.kiprisKeywords, 3);
    const kiprisAltKeywords = asKeywordList(raw.kiprisAltKeywords, 2).filter((k) => !kiprisKeywords.includes(k));
    const singleShopping = typeof raw.shoppingQuery === "string" ? raw.shoppingQuery.trim().slice(0, 100) : "";
    const shoppingQueries = asShoppingQueries(raw.shoppingQueries, singleShopping).map((q) => q.slice(0, 100));
    const shoppingQuery = shoppingQueries[0] ?? "";

    if (kiprisKeywords.length === 0 && !shoppingQuery) {
      return fallbackQueries(ideaText, "검색어 생성 응답이 비어 있습니다.");
    }

    const fallback = ideaText.trim().slice(0, 60);
    const keywords = kiprisKeywords.length > 0 ? kiprisKeywords : fallback ? [fallback] : [];
    const queries = shoppingQueries.length > 0 ? shoppingQueries : fallback ? [fallback] : [];
    return {
      kiprisKeywords: keywords,
      kiprisAltKeywords,
      shoppingQuery: queries[0] ?? "",
      shoppingQueries: queries,
    };
  } catch {
    return fallbackQueries(ideaText, "검색어 생성 응답을 해석하지 못했습니다.");
  }
}
