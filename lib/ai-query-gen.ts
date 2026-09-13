import { callOpenRouter } from "./openrouter";
import { extractJson } from "./ai-json";

/**
 * AI 호출 #1: 사용자의 아이디어 설명 원문은 KIPRIS나 쇼핑 API에 그대로 넣기엔
 * 부적합하므로, 핵심 기술을 뽑아 KIPRIS 키워드를, 실제 유사 제품이 나올만한
 * 쇼핑 검색어를 각각 생성한다. 실패 시에는 사용자 원문(잘라서)으로 폴백해
 * 이 단계가 죽어도 KIPRIS/쇼핑 검색 자체는 계속 시도할 수 있게 한다.
 */
export interface GeneratedQueries {
  kiprisQuery: string;
  shoppingQuery: string;
  warning?: string;
}

function fallbackQueries(ideaText: string, warning: string): GeneratedQueries {
  const fallback = ideaText.trim().slice(0, 60);
  return { kiprisQuery: fallback, shoppingQuery: fallback, warning };
}

export async function generateExternalQueries(ideaText: string): Promise<GeneratedQueries> {
  const prompt =
    `다음은 사용자가 구상 중인 아이디어입니다:\n"""\n${ideaText.slice(0, 1500)}\n"""\n\n` +
    `이 아이디어를 검색용 두 가지 검색어로 변환하세요.\n` +
    `1. kiprisQuery: 특허 검색(KIPRIS)에 쓸 검색어. 아이디어에 들어가는 핵심 기술/기능을 ` +
    `특허 명세서에 쓰일 법한 명사 위주 키워드로 표현하세요 (예: "라이다 기반 보행 보조 장치").\n` +
    `2. shoppingQuery: 쇼핑 검색 API에 쓸 검색어. 실제 소비자가 이 제품을 찾을 때 쓸 법한 ` +
    `자연스러운 상품명/카테고리 키워드로 표현하세요 (예: "시각장애인 스마트 지팡이").\n\n` +
    `다른 설명 없이 아래 스키마의 순수 JSON 객체 "하나만" 출력하세요.\n\n` +
    `{\n  "kiprisQuery": "...",\n  "shoppingQuery": "..."\n}`;

  const res = await callOpenRouter(prompt, 8_000);
  if (!res.ok) {
    return fallbackQueries(ideaText, res.error);
  }

  const jsonStr = extractJson(res.text);
  if (!jsonStr) {
    return fallbackQueries(ideaText, "검색어 생성 응답을 해석하지 못했습니다.");
  }

  try {
    const raw = JSON.parse(jsonStr) as { kiprisQuery?: unknown; shoppingQuery?: unknown };
    const kiprisQuery = typeof raw.kiprisQuery === "string" ? raw.kiprisQuery.trim().slice(0, 100) : "";
    const shoppingQuery = typeof raw.shoppingQuery === "string" ? raw.shoppingQuery.trim().slice(0, 100) : "";

    if (!kiprisQuery && !shoppingQuery) {
      return fallbackQueries(ideaText, "검색어 생성 응답이 비어 있습니다.");
    }

    const fallback = ideaText.trim().slice(0, 60);
    return {
      kiprisQuery: kiprisQuery || fallback,
      shoppingQuery: shoppingQuery || fallback,
    };
  } catch {
    return fallbackQueries(ideaText, "검색어 생성 응답을 해석하지 못했습니다.");
  }
}
