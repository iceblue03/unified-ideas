/**
 * 검색 결과에 올릴 만한 항목인지 가른다.
 * TF-IDF는 "분리", "서비스", "공공데이터"처럼 어디서나 나오는 말에 점수를 주고,
 * 특허 필터는 "레고"가 "레고라페닙"에 끼는 부분 문자열도 통과시켰다.
 * 여기서는 아이디어의 사물 명사가 경계에 맞게 들어 있는지만 본다.
 */

const GENERIC = new Set([
  "서비스",
  "시스템",
  "플랫폼",
  "장치",
  "방법",
  "기술",
  "솔루션",
  "기기",
  "모듈",
  "장비",
  "추천",
  "활용",
  "기반",
  "자동",
  "인공지능",
  "스마트",
  "데이터",
  "공공데이터",
  "오픈데이터",
  "앱",
  "어플",
  "제공",
  "사용",
  "사용자",
  "위한",
  "통해",
  "분석",
  "정보",
  "맞춤",
  "개발",
  "제작",
  "이용",
  "기능",
  "환경",
  "문제",
  "해결",
  "웨어러블",
  "센서",
  "iot",
  "ai",
  "프로그램",
  "어플리케이션",
  "애플리케이션",
  "모바일",
  "온라인",
  "실시간",
  "통합",
  "관리",
  "지원",
  "예방",
  "안전",
  "건강",
  "노인",
  "학생",
  "학교",
  "지역",
  "공공",
  "중고",
  "반려동물",
  "시각장애",
  "시각장애인",
  "장애인",
  "시간",
  "기반의",
  "사람",
  "우리",
  "이것",
  "그것",
]);

/** 짧은 사물 명사만 맞을 때 같이 요구하는 동작. 이것만으로는 항목을 남기지 않는다. */
const FUNCTIONS = new Set([
  "분리",
  "감지",
  "측정",
  "교환",
  "예약",
  "안내",
  "알림",
  "예측",
  "건조",
  "분쇄",
  "변환",
  "생성",
  "인식",
  "모니터링",
  "급여",
  "급이",
  "공급",
  "검색",
  "입력",
  "진단",
  "방지",
  "처리",
  "수거",
  "세척",
  "탐지",
  "환기",
]);

const ENDING =
  /(?:해주는|해준다|합니다|입니다|하면|하는|되는|있는|없는|통한|위한|끼리|에서|으로|에게|부터|까지|처럼|하며|하고|이다|해서|하여|한|된|할|음|임|춰|을|를|가|은|는|의|과|와|도|로|에)$/u;

/** 지팡이가 아닌 아이디어에 붙으면 다른 제품군으로 샌 검색어·상품명. */
export const CANE_LEAK_RE =
  /visually\s+impaired|white\s+cane|\bcane\b|\bblinds?\b|blindness|mobility\s+(?:aid|guide)|guide\s+device|walking\s+stick|mobilityaid|mobilityguide|안내지팡이|흰\s*지팡이|쉽자/i;

const SUFFIX =
  /^(?:형|용|식|기|화|성|적|들|과|와|의|을|를|이|가|은|는|도|에|로|으로|에서|및|등|만|까지|부터)/u;

const COMPOUND_TAIL = /^(?:사고|방지|예방|감지|위험|처리|수거|분쇄|건조|측정|센서|장치|기기|시스템|통)/u;

const VERBISH = new Set([
  "하는",
  "되는",
  "있는",
  "없는",
  "위한",
  "통한",
  "주는",
  "해준",
  "맞춰",
  "같은",
  "하여",
  "해서",
  "해준다",
  "해주는",
  "바꿔",
  "바꾸",
]);

export function stemToken(token: string): string {
  let cur = token.toLowerCase();
  for (let i = 0; i < 3; i++) {
    const next = cur.replace(ENDING, "");
    if (next === cur) break;
    // 귀가·경로처럼 조사와 같은 글자로 끝나는 두 글자 명사는 그대로 둔다.
    if (next.length < 2) {
      if ([...cur].length <= 2) break;
      return "";
    }
    cur = next;
  }
  return cur.length >= 2 ? cur : "";
}

export function contentStems(text: string): string[] {
  const seen = new Set<string>();
  const stems: string[] = [];
  for (const token of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 2 || VERBISH.has(token)) continue;
    const stem = stemToken(token);
    if (stem.length < 2 || GENERIC.has(stem) || seen.has(stem)) continue;
    seen.add(stem);
    stems.push(stem);
  }
  return stems;
}

export function ideaNouns(ideaText: string): string[] {
  return contentStems(ideaText).filter((stem) => !FUNCTIONS.has(stem));
}

export function ideaFunctions(ideaText: string): string[] {
  return contentStems(ideaText).filter((stem) => FUNCTIONS.has(stem));
}

function boundaryHit(original: string, needle: string): boolean {
  let from = 0;
  while (from <= original.length - needle.length) {
    const at = original.indexOf(needle, from);
    if (at < 0) return false;
    const prev = at === 0 ? "" : (original[at - 1] ?? "");
    const rest = original.slice(at + needle.length);
    const next = rest[0] ?? "";
    const prevOk = !prev || !/\p{L}/u.test(prev);
    const nextOk = !next || !/\p{L}/u.test(next) || SUFFIX.test(rest) || COMPOUND_TAIL.test(rest);
    if (prevOk && (nextOk || [...needle].length >= 3)) return true;
    from = at + 1;
  }
  return false;
}

export function boundedIncludes(text: string, stem: string): boolean {
  const needle = stem.toLowerCase().replace(/\s+/g, "");
  if (!needle) return false;
  const original = text.toLowerCase();
  if (boundaryHit(original, needle)) return true;
  // 띄어쓰기 없는 긴 합성어(실내공기질, 음식물쓰레기)만 붙여 쓴 형태를 허용한다.
  // 두 글자 명사는 붙이면 레고라페닙·오레고닌까지 통과한다.
  if ([...needle].length < 3) return false;
  return original.replace(/\s+/g, "").includes(needle);
}

function documentFrequency(noun: string, corpus: string[]): number {
  let count = 0;
  for (const text of corpus) {
    if (boundedIncludes(text, noun)) count += 1;
  }
  return count;
}

/**
 * 코퍼스에 실제로 있는 사물 명사 중 드문 것을 고른다.
 * 길이 3 이상인 명사가 코퍼스에 하나도 없으면 더 짧은 말(축제, 폰트)로 대체하지 않는다.
 * "대기줄"이 없으면 "축제" 알림을 대기열 예약으로 보여 주지 않기 위해서다.
 */
export function chooseAnchorNouns(ideaText: string, corpus: string[]): string[] {
  const nouns = ideaNouns(ideaText);
  if (nouns.length === 0) return [];
  const counted = nouns.map((noun) => ({ noun, len: [...noun].length, df: documentFrequency(noun, corpus) }));
  const lengths = [...new Set(counted.map((entry) => entry.len))].sort((a, b) => b - a);
  let skippedSpecific = false;
  for (const len of lengths) {
    const tier = counted.filter((entry) => entry.len === len && entry.df > 0);
    if (tier.length === 0) {
      if (len >= 3) skippedSpecific = true;
      continue;
    }
    const minDf = Math.min(...tier.map((entry) => entry.df));
    // "대기줄"이 제목에 없으면 "축제"처럼 훨씬 흔한 짧은 말로 바꾸지 않는다.
    // "급식기"가 없어도 "사료"처럼 드문 짧은 말은 남긴다.
    if (skippedSpecific && minDf > 40) return [];
    const ceiling = Math.max(minDf * 2, minDf + 5);
    return tier.filter((entry) => entry.df <= ceiling).map((entry) => entry.noun);
  }
  return [];
}

export function sharesIdeaFocus(ideaText: string, text: string, anchors?: string[]): boolean {
  return focusMatch(ideaText, text, text, anchors);
}

/** 사물 명사는 제목에 있어야 한다. 설명에만 있으면 다른 작품의 요약이 섞인 카드를 올린다. */
export function sharesIdeaFocusInTitle(
  ideaText: string,
  title: string,
  body = "",
  anchors?: string[],
): boolean {
  return focusMatch(ideaText, title, `${title}\n${body}`, anchors);
}

function focusMatch(ideaText: string, nounText: string, functionText: string, anchors?: string[]): boolean {
  const nouns = anchors ?? ideaNouns(ideaText);
  if (nouns.length === 0) return true;
  const maxLen = Math.max(...nouns.map((noun) => [...noun].length));
  const tier = nouns.filter((noun) => [...noun].length === maxLen);
  if (!tier.some((noun) => boundedIncludes(nounText, noun))) return false;
  const short = tier.every((noun) => [...noun].length <= 2);
  const functions = ideaFunctions(ideaText);
  if (short && functions.length > 0) return functions.some((fn) => boundedIncludes(functionText, fn));
  return true;
}

/** 모델이 아이디어에 없는 영어 합성어(petfeeder, guide)를 특허 키워드로 냈는지. */
export function keywordGroundedInIdea(ideaText: string, keyword: string): boolean {
  const trimmed = keyword.trim();
  if (!trimmed) return false;
  if (CANE_LEAK_RE.test(trimmed) && !CANE_LEAK_RE.test(ideaText) && !/지팡이|시각\s*장애/u.test(ideaText)) return false;
  if (boundedIncludes(ideaText, trimmed)) return true;
  const compactIdea = ideaText.replace(/\s+/g, "");
  const compactKeyword = trimmed.replace(/\s+/g, "");
  return compactKeyword.length >= 2 && compactIdea.includes(compactKeyword);
}

export function fallbackKiprisKeywords(ideaText: string): string[] {
  const nouns = ideaNouns(ideaText);
  if (nouns.length > 0) return nouns.slice(0, 3);
  return ideaFunctions(ideaText).slice(0, 2);
}

export function groundKiprisTerms(
  ideaText: string,
  keywords: string[],
  altKeywords: string[],
): { kiprisKeywords: string[]; kiprisAltKeywords: string[] } {
  const grounded = keywords.filter((keyword) => keywordGroundedInIdea(ideaText, keyword));
  const groundedAlt = altKeywords.filter(
    (keyword) => keywordGroundedInIdea(ideaText, keyword) && !grounded.includes(keyword),
  );
  return {
    kiprisKeywords: grounded.length > 0 ? grounded : fallbackKiprisKeywords(ideaText),
    kiprisAltKeywords: groundedAlt,
  };
}

export function textMentionsCaneLeak(text: string): boolean {
  return CANE_LEAK_RE.test(text);
}
