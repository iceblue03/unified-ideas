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
  shoppingQuery: string;
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
function fallbackQueries(ideaText: string, warning: string): GeneratedQueries {
  const trimmed = ideaText.trim();
  const shoppingQuery = trimmed.slice(0, 60);
  const kiprisKeywords = trimmed
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1)
    .slice(0, 4);
  return {
    kiprisKeywords: kiprisKeywords.length > 0 ? kiprisKeywords : shoppingQuery ? [shoppingQuery] : [],
    shoppingQuery,
    warning,
  };
}

export async function generateExternalQueries(ideaText: string): Promise<GeneratedQueries> {
  const prompt =
    `다음은 사용자가 구상 중인 아이디어입니다:\n"""\n${ideaText.slice(0, 1500)}\n"""\n\n` +
    `이 아이디어를 검색용 정보 두 가지로 변환하세요.\n` +
    `1. kiprisKeywords: 특허 검색(KIPRIS)에 쓸 핵심 키워드 2~4개의 배열. 아이디어에 들어가는 ` +
    `핵심 기술/기능을 특허 명세서에 쓰일 법한 명사 위주로, 각 키워드는 공백 없는 단어 또는 ` +
    `복합명사 하나로 표현하세요 (예: "라이다 기반 보행 보조 장치" → ["라이다", "보행보조장치", ` +
    `"장애물감지"]). "시스템"/"장치"/"방법"처럼 너무 범용적인 단어만 단독으로 넣지 마세요.\n` +
    `2. shoppingQuery: 쇼핑 검색 API에 쓸 검색어. 실제 소비자가 이 제품을 찾을 때 쓸 법한 ` +
    `자연스러운 상품명/카테고리 키워드로 표현하세요 (예: "시각장애인 스마트 지팡이").\n\n` +
    `다른 설명 없이 아래 스키마의 순수 JSON 객체 "하나만" 출력하세요.\n\n` +
    `{\n  "kiprisKeywords": ["...", "..."],\n  "shoppingQuery": "..."\n}`;

  const res = await callOpenRouter(prompt, 8_000);
  if (!res.ok) {
    return fallbackQueries(ideaText, res.error);
  }

  const jsonStr = extractJson(res.text);
  if (!jsonStr) {
    return fallbackQueries(ideaText, "검색어 생성 응답을 해석하지 못했습니다.");
  }

  try {
    const raw = JSON.parse(jsonStr) as { kiprisKeywords?: unknown; shoppingQuery?: unknown };
    const kiprisKeywords = Array.isArray(raw.kiprisKeywords)
      ? raw.kiprisKeywords
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim().replace(/\s+/g, ""))
          .filter((k) => k.length > 0)
          .slice(0, 4)
      : [];
    const shoppingQuery = typeof raw.shoppingQuery === "string" ? raw.shoppingQuery.trim().slice(0, 100) : "";

    if (kiprisKeywords.length === 0 && !shoppingQuery) {
      return fallbackQueries(ideaText, "검색어 생성 응답이 비어 있습니다.");
    }

    const fallback = ideaText.trim().slice(0, 60);
    return {
      kiprisKeywords: kiprisKeywords.length > 0 ? kiprisKeywords : fallback ? [fallback] : [],
      shoppingQuery: shoppingQuery || fallback,
    };
  } catch {
    return fallbackQueries(ideaText, "검색어 생성 응답을 해석하지 못했습니다.");
  }
}
