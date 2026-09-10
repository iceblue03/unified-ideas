/**
 * 순수 문자열 기반 유사도(문자 bigram Dice 계수).
 *
 * 유료 임베딩/LLM API를 쓰지 않고도 "이 아이디어랑 비슷한 과거 수상작이 있는가"를
 * 꽤 잘 걸러낼 수 있어서 기본 검색 경로로 삼는다. 한국어는 형태소 분석기 없이도
 * 문자 bigram 기반 비교가 실무적으로 잘 동작한다(띄어쓰기 차이에도 강함).
 *
 * AI API는 이 결과의 상위 후보에 대해서만, 사용자가 명시적으로 "AI 정밀 분석"을
 * 눌렀을 때만 선택적으로 사용한다 (app/api/ai-review).
 */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .trim();
}

function bigrams(text: string): Map<string, number> {
  const norm = normalize(text);
  const map = new Map<string, number>();
  if (norm.length < 2) {
    if (norm.length === 1) map.set(norm, 1);
    return map;
  }
  for (let i = 0; i < norm.length - 1; i++) {
    const gram = norm.slice(i, i + 2);
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }
  return map;
}

export function diceCoefficient(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;

  let intersection = 0;
  let totalA = 0;
  let totalB = 0;
  for (const v of ga.values()) totalA += v;
  for (const v of gb.values()) totalB += v;

  const [smaller, larger] = ga.size <= gb.size ? [ga, gb] : [gb, ga];
  for (const [gram, count] of smaller) {
    const other = larger.get(gram);
    if (other) intersection += Math.min(count, other);
  }

  return (2 * intersection) / (totalA + totalB);
}

export interface ScoredMatch<T> {
  item: T;
  score: number;
}

/**
 * query와 candidates[i].text 사이 유사도를 계산해 상위 topN만 반환.
 */
export function topMatches<T>(
  query: string,
  candidates: Array<{ text: string; item: T }>,
  topN = 10,
): ScoredMatch<T>[] {
  const scored = candidates.map((c) => ({ item: c.item, score: diceCoefficient(query, c.text) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
