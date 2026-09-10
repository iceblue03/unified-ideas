/**
 * 무료 검색 랭킹 엔진 (임베딩/LLM 없이 동작).
 *
 * 예전 버전은 순수 문자 bigram Dice 계수만 썼는데, 흔한 단어("시각장애인" 등)가
 * 들어간 제목이면 실제 핵심 아이디어(예: "키오스크")가 안 겹쳐도 점수가 높게
 * 나오는 문제가 있었다. 이번 버전은:
 *
 * 1) 단어 단위로 토큰화하고, 코퍼스 전체에서의 등장 빈도로 IDF를 계산해
 *    흔한 단어는 자동으로 덜 중요하게, 희귀한(구별력 있는) 단어는 더 중요하게 취급한다.
 * 2) 제목(title) 필드에 더 큰 가중치를 주고 요약/분류(body) 필드도 함께 채점한다
 *    (BM25F와 비슷한 방식).
 * 3) 한국어는 띄어쓰기 없이 명사가 붙는 경우가 많아("시각장애인" 안에 "장애인"이
 *    포함) 완전히 같은 토큰이 아니어도 부분 문자열로 겹치면 절반 정도의 가중치를 준다.
 * 4) 위 방식이 통 안 맞는 경우를 대비해 문자 bigram Dice 유사도를 아주 작은
 *    비중으로 섞어 최후의 안전망으로 둔다.
 *
 * AI API는 여기서 전혀 쓰지 않는다 — 이 랭커로 1차로 걸러낸 상위 후보에 대해서만
 * app/api/ai-review가 선택적으로 LLM을 호출한다.
 */

const STOPWORDS = new Set([
  "위한",
  "위해",
  "통한",
  "그리고",
  "그러나",
  "하지만",
  "등등",
  "경우",
  "때문",
  "대한",
  "관련",
  "있는",
  "하는",
  "합니다",
  "입니다",
]);

const TITLE_FIELD_BOOST = 3;
const BODY_FIELD_BOOST = 1;
const SUBSTRING_PARTIAL_RATIO = 0.5;
const BIGRAM_SAFETY_NET_WEIGHT = 0.12;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function bigramSet(text: string): Map<string, number> {
  const norm = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const map = new Map<string, number>();
  for (let i = 0; i < norm.length - 1; i++) {
    const g = norm.slice(i, i + 2);
    map.set(g, (map.get(g) ?? 0) + 1);
  }
  return map;
}

function diceCoefficient(a: string, b: string): number {
  const ga = bigramSet(a);
  const gb = bigramSet(b);
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

/** 쿼리 토큰 q가 문서 토큰들과 정확히 같지 않아도 부분 문자열로 포함되는지 확인 */
function hasPartialOverlap(q: string, docTokens: string[]): boolean {
  return docTokens.some((t) => t.length >= 2 && (t.includes(q) || q.includes(t)));
}

interface IndexedDoc<T> {
  item: T;
  titleTokens: string[];
  bodyTokens: string[];
  titleText: string;
  bodyText: string;
}

export interface SearchIndex<T> {
  docs: IndexedDoc<T>[];
  idf: Map<string, number>;
}

export function buildIndex<T>(
  docs: Array<{ item: T; title: string; body: string }>,
): SearchIndex<T> {
  const indexed: IndexedDoc<T>[] = docs.map((d) => ({
    item: d.item,
    titleTokens: tokenize(d.title),
    bodyTokens: tokenize(d.body),
    titleText: d.title,
    bodyText: d.body,
  }));

  const df = new Map<string, number>();
  for (const d of indexed) {
    const uniq = new Set([...d.titleTokens, ...d.bodyTokens]);
    for (const t of uniq) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const N = indexed.length || 1;
  const idf = new Map<string, number>();
  for (const [t, f] of df) {
    // BM25 스타일 idf. 아주 흔한 단어는 음수에 가까워질 수 있어 작은 값으로 바닥을 둔다.
    idf.set(t, Math.max(0.05, Math.log(1 + (N - f + 0.5) / (f + 0.5))));
  }

  return { docs: indexed, idf };
}

function idfOf<T>(index: SearchIndex<T>, token: string): number {
  return index.idf.get(token) ?? Math.log(1 + index.docs.length);
}

function countOf(token: string, tokens: string[]): number {
  let c = 0;
  for (const t of tokens) if (t === token) c++;
  return c;
}

export interface ScoredMatch<T> {
  item: T;
  score: number;
}

/**
 * subset(전체 또는 특정 대회로 필터링한 문서 목록)에서 query와 가장 비슷한
 * 문서 top N을 반환한다. score는 대략 0~1 범위로 정규화된 상대 점수다.
 */
export function search<T>(
  index: SearchIndex<T>,
  query: string,
  subset: IndexedDoc<T>[],
  topN: number,
): ScoredMatch<T>[] {
  const queryTokens = [...new Set(tokenize(query))];

  // 이 쿼리가 모든 토큰을 제목에서 정확히 맞췄을 때 나올 수 있는 최대 점수.
  // 문서별 점수를 여기에 대비시켜 0~1 근처로 정규화한다.
  const maxPossible =
    queryTokens.reduce((sum, q) => sum + idfOf(index, q), 0) * TITLE_FIELD_BOOST || 1;

  const scored = subset.map((doc) => {
    let tfidfScore = 0;
    for (const q of queryTokens) {
      const weight = idfOf(index, q);
      const titleCount = countOf(q, doc.titleTokens);
      const bodyCount = countOf(q, doc.bodyTokens);

      if (titleCount > 0 || bodyCount > 0) {
        tfidfScore += weight * (titleCount * TITLE_FIELD_BOOST + bodyCount * BODY_FIELD_BOOST);
      } else if (hasPartialOverlap(q, doc.titleTokens)) {
        tfidfScore += weight * TITLE_FIELD_BOOST * SUBSTRING_PARTIAL_RATIO;
      } else if (hasPartialOverlap(q, doc.bodyTokens)) {
        tfidfScore += weight * BODY_FIELD_BOOST * SUBSTRING_PARTIAL_RATIO;
      }
    }

    const normalizedTfidf = Math.min(1, tfidfScore / maxPossible);
    const bigramFallback = diceCoefficient(query, `${doc.titleText} ${doc.bodyText}`);
    const score = normalizedTfidf * (1 - BIGRAM_SAFETY_NET_WEIGHT) + bigramFallback * BIGRAM_SAFETY_NET_WEIGHT;

    return { item: doc.item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

export function getDocs<T>(index: SearchIndex<T>): IndexedDoc<T>[] {
  return index.docs;
}
