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

/** 아이디어 본문이 지팡이·시각장애를 말할 때만 쇼핑/특허 검색어에 이 주제를 허용한다. */
const CANE_IDEA_RE = /지팡이|쉽자|시각\s*장애|visually\s+impaired|white\s+cane|\bcane\b|\bblind\b/i;
const CANE_QUERY_RE = /visually\s+impaired|white\s+cane|\bcane\b|\bblind\b/i;
const CANE_KEYWORD_RE = /지팡이|쉽자|시각\s*장애|visually\s*impaired|white\s*cane|cane|blind/i;

export function ideaMentionsCane(ideaText: string): boolean {
  return CANE_IDEA_RE.test(ideaText);
}

export function shoppingQueryMentionsCane(query: string): boolean {
  return CANE_QUERY_RE.test(query);
}

function keywordMentionsCane(keyword: string): boolean {
  return CANE_KEYWORD_RE.test(keyword);
}

function stripShoppingAi(query: string): string {
  return query.replace(/\bAI\b/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * 모델이 지팡이 예시를 모든 아이디어에 복사했을 때의 비-LLM 폴백.
 * 아이디어에 영어 토큰이 있으면 그 단어로, 없으면 아이디어 원문 조각으로 만든다.
 */
export function deriveNonCaneShoppingQueries(ideaText: string): string[] {
  const latin = (ideaText.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? [])
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && word.toLowerCase() !== "ai" && !shoppingQueryMentionsCane(word));
  if (latin.length > 0) {
    return [latin.slice(0, 5).join(" ")];
  }
  return fallbackQueries(ideaText, "").shoppingQueries.filter((query) => !shoppingQueryMentionsCane(query));
}

/**
 * 아이디어가 지팡이/시각장애가 아닌데 쇼핑 검색어에 cane·blind·visually impaired가 있으면 버린다.
 * 남은 검색어가 없으면 지팡이 템플릿이 아니라 아이디어에서 다시 뽑는다.
 */
export function guardShoppingQueries(ideaText: string, queries: string[]): string[] {
  const cleaned = queries.map(stripShoppingAi).filter((query) => query.length > 0);
  if (ideaMentionsCane(ideaText)) return cleaned;
  const kept = cleaned.filter((query) => !shoppingQueryMentionsCane(query));
  return kept.length > 0 ? kept : deriveNonCaneShoppingQueries(ideaText);
}

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

export function buildExternalQueryPrompt(ideaText: string): string {
  return (
    `다음은 사용자가 구상 중인 아이디어입니다:\n"""\n${ideaText.slice(0, 1500)}\n"""\n\n` +
    `검색어는 이 아이디어에서만 뽑으세요. 다른 제품군으로 바꾸지 마세요.\n` +
    `1. kiprisKeywords: 한국 특허 제목에 실제로 나올 핵심 사물 명사 1개. ` +
    `아이디어 문장에 이미 있는 단어를 우선하세요. 문장에 없는 합성어를 만들지 마세요. ` +
    `"레고를 분리해주는 채"의 오답은 "레고분리도구", "레고커터"이고, 검색 가능한 조각은 레고, 분리, 체입니다.\n` +
    `기능이나 기술(인공지능, 스마트, 감지)을 붙여 새 단어를 만들지 마세요.\n` +
    `2. kiprisAltKeywords: 그 사물의 실제 다른 명칭 1~2개. 지어낸 상품명이나 브랜드는 넣지 마세요.\n` +
    `3. shoppingQueries: eBay 영어 상품명 정확히 3개. 각 2~5단어. 모두 이 아이디어의 실제 제품이거나, ` +
    `그 일을 하려는 사람이 사는 가장 가까운 물리 제품이어야 합니다. ` +
    `순수 서비스면 그 서비스의 일(길찾기, 안전 등)에 해당하는 제품을 고르세요. 정해진 다른 분야로 도망가지 마세요. ` +
    `검색어에 AI를 넣지 마세요. 한국어 검색어는 오답입니다.\n` +
    `cane, blind, visually impaired, white cane, 지팡이는 아이디어 자체가 흰지팡이 또는 안내지팡이일 때만 쓰세요. ` +
    `그 경우에만 예: ["smart cane for visually impaired", "electronic white cane", "blind walking stick"]. ` +
    `지팡이가 아닌 아이디어에 이 예시를 복사하면 오답입니다.\n\n` +
    `다른 설명 없이 아래 스키마의 순수 JSON 객체 "하나만" 출력하세요.\n\n` +
    `{\n  "kiprisKeywords": ["..."],\n  "kiprisAltKeywords": ["...", "..."],\n  "shoppingQueries": ["...", "...", "..."]\n}`
  );
}

function buildCaneRetryPrompt(ideaText: string): string {
  return (
    `${buildExternalQueryPrompt(ideaText)}\n\n` +
    `이전 답은 이 아이디어에 없는 cane, blind, visually impaired, white cane을 넣어 규칙을 어겼습니다. ` +
    `지팡이, cane, blind, visually impaired, white cane을 넣지 말고 이 아이디어의 대상만 다시 출력하세요.`
  );
}

interface ParsedQueries {
  kiprisKeywords: string[];
  kiprisAltKeywords: string[];
  shoppingQueries: string[];
}

function parseModelQueries(jsonStr: string): ParsedQueries | null {
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
    const shoppingQueries = asShoppingQueries(raw.shoppingQueries, singleShopping).map((q) => stripShoppingAi(q).slice(0, 100)).filter(Boolean);
    if (kiprisKeywords.length === 0 && shoppingQueries.length === 0) return null;
    return { kiprisKeywords, kiprisAltKeywords, shoppingQueries };
  } catch {
    return null;
  }
}

function finalizeQueries(ideaText: string, parsed: ParsedQueries): GeneratedQueries {
  let kiprisKeywords = parsed.kiprisKeywords;
  let kiprisAltKeywords = parsed.kiprisAltKeywords;
  let shoppingQueries = parsed.shoppingQueries;
  if (!ideaMentionsCane(ideaText)) {
    kiprisKeywords = kiprisKeywords.filter((keyword) => !keywordMentionsCane(keyword));
    kiprisAltKeywords = kiprisAltKeywords.filter((keyword) => !keywordMentionsCane(keyword));
    shoppingQueries = shoppingQueries.filter((query) => !shoppingQueryMentionsCane(query));
  }
  if (shoppingQueries.length === 0) shoppingQueries = deriveNonCaneShoppingQueries(ideaText);
  if (kiprisKeywords.length === 0) kiprisKeywords = fallbackQueries(ideaText, "").kiprisKeywords;
  return {
    kiprisKeywords,
    kiprisAltKeywords,
    shoppingQuery: shoppingQueries[0] ?? "",
    shoppingQueries,
  };
}

export async function generateExternalQueries(ideaText: string): Promise<GeneratedQueries> {
  const res = await callOpenRouter(buildExternalQueryPrompt(ideaText), 8_000);
  if (!res.ok) {
    return fallbackQueries(ideaText, res.error);
  }

  const jsonStr = extractJson(res.text);
  if (!jsonStr) {
    return fallbackQueries(ideaText, "검색어 생성 응답을 해석하지 못했습니다.");
  }

  let parsed = parseModelQueries(jsonStr);
  if (!parsed) {
    return fallbackQueries(ideaText, "검색어 생성 응답이 비어 있습니다.");
  }

  const caneLeak =
    !ideaMentionsCane(ideaText) &&
    parsed.shoppingQueries.length > 0 &&
    parsed.shoppingQueries.every(shoppingQueryMentionsCane);
  if (caneLeak) {
    const retry = await callOpenRouter(buildCaneRetryPrompt(ideaText), 8_000);
    if (retry.ok) {
      const retryJson = extractJson(retry.text);
      const retryParsed = retryJson ? parseModelQueries(retryJson) : null;
      if (retryParsed && retryParsed.shoppingQueries.some((query) => !shoppingQueryMentionsCane(query))) {
        parsed = retryParsed;
      }
    }
  }

  return finalizeQueries(ideaText, parsed);
}
