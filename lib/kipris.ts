import { XMLParser } from "fast-xml-parser";
import { boundedIncludes, ideaNouns, sharesIdeaFocusInTitle } from "./relevance";
import type { PatentItem } from "./types";

/**
 * KIPRIS Plus - 특허실용신안 정보 검색 서비스 (patUtiModInfoSearchSevice.getWordSearch)
 * https://plus.kipris.or.kr / 공공데이터포털에서 발급받은 ServiceKey로 호출하는 무료 API.
 * XML 응답. 아래 필드 매핑은 실제 서비스키로 라이브 호출해 확인한 실제 응답 스키마
 * 기준이다(추측이 아님) — response.header.successYN/resultCode로 성공 여부를 확인하고,
 * response.body.items.item[] 각 항목에 inventionTitle/applicantName/applicationDate/
 * applicationNumber/astrtCont(초록)/ipcNumber/registerStatus 등이 들어있다.
 */

const KIPRIS_ENDPOINT =
  "https://plus.kipris.or.kr/kipo-api/kipi/patUtiModInfoSearchSevice/getWordSearch";

export interface PatentSearchResult {
  ok: boolean;
  items: PatentItem[];
  skipped?: boolean;
  error?: string;
  /** 실제로 KIPRIS에 전송된 최종 word= 값 (연산자 조립 후) */
  queryUsed?: string;
  /** 전체 키워드 AND가 0건이라 다른 조합으로 재시도했는지 */
  fallbackUsed?: boolean;
  /** 최종적으로 사용한 키워드 개수. 0이면 한 단어까지 내려가지 않고 비운 것 */
  fallbackDepth?: number;
  /** 실제로 시도한 검색식 (사람이 읽는 "a*b" 형태), 시도 순서 */
  attempts?: string[];
}

/**
 * 특허 명세서에서 흔히 쓰이는 기능적 범용어. LLM이 지침을 무시하고 이런 단어만
 * 반환하면 AND 검색이 무의미하게 넓어지거나(단어 자체는 어디에나 있어 사실상
 * 필터링 효과가 없음) 좁아져 버리므로(범용어 하나가 껴서 AND 전체가 매칭 안 됨)
 * 검색식 조립 전에 제거한다. 전부 제거돼서 빈 배열이 되면 원본을 그대로 쓴다
 * (필터링 때문에 검색 자체가 불가능해지는 것보다는 낫다).
 */
const KIPRIS_STOPWORDS = new Set([
  "시스템",
  "장치",
  "방법",
  "장비",
  "플랫폼",
  "서비스",
  "기술",
  "솔루션",
  "기기",
  "모듈",
]);

function filterStopwords(keywords: string[]): string[] {
  const filtered = keywords.filter((k) => !KIPRIS_STOPWORDS.has(k));
  return filtered.length > 0 ? filtered : keywords;
}

/**
 * 아이디어의 사물이 아닌데 모델이 자주 바꿔 넣는 제품군.
 * 다른 핵심 키워드가 있으면 이 단어 하나만으로 검색하지 않는다.
 */
const SUBSTITUTE_PRODUCTS = new Set([
  "점자디스플레이",
  "점자단말기",
  "디스플레이",
  "모니터",
  "노트북",
  "키보드",
]);

const DROPPABLE_MODIFIERS = new Set([
  "인공지능",
  "ai",
  "스마트",
  "딥러닝",
  "머신러닝",
  "시각장애인",
  "장애인",
  "사용자",
  "보행자",
  "센서",
  "카메라",
  "iot",
]);

function isDroppableModifier(keyword: string): boolean {
  return DROPPABLE_MODIFIERS.has(keyword.toLowerCase());
}

/** 핵심 사물/기능이 앞에 오고, 수식어는 뒤로 보낸다. 폴백은 뒤에서부터 자른다. */
export function orderKiprisKeywords(keywords: string[]): string[] {
  const cleaned = filterStopwords(keywords.map((k) => k.trim()).filter(Boolean));
  const core = cleaned.filter((k) => !isDroppableModifier(k));
  const modifiers = cleaned.filter((k) => isDroppableModifier(k));
  return [...core, ...modifiers];
}

const MAX_KIPRIS_ATTEMPTS = 4;

/** 이것만 맞으면 거의 모든 특허가 통과한다. 더 구체적인 시도가 있으면 여기서 멈추지 않는다. */
const BROAD_KIPRIS_TERMS = new Set([
  "공공데이터",
  "오픈데이터",
  "정부데이터",
  "서비스",
  "시스템",
  "방법",
  "장치",
  "ai",
  "인공지능",
  "스마트",
]);

export function isBroadKiprisKeyword(keyword: string): boolean {
  return BROAD_KIPRIS_TERMS.has(keyword.toLowerCase());
}

function isCommonKiprisWord(keyword: string): boolean {
  return isBroadKiprisKeyword(keyword) || KIPRIS_STOPWORDS.has(keyword);
}

function pickAnchor(ordered: string[]): string | null {
  const specific = ordered.filter((k) => !isDroppableModifier(k) && !SUBSTITUTE_PRODUCTS.has(k));
  if (specific.length > 0) return specific[0];
  // 점자디스플레이처럼 다른 제품군만 남으면 한 단어 검색을 만들지 않는다.
  return null;
}

/**
 * 라이브 로그(2026-10-02, "AI 점자 안내 지팡이"): 안내지팡이*장애물감지*촉각점자,
 * 안내지팡이*장애물감지, 흰지팡이*장애물감지는 모두 10건이 왔지만 제목/초록 일치가 0건이었다.
 * 안내지팡이 한 단어만 맹인안내지팡이 등 실제 선행기술을 남겼다.
 * 그래서 AND를 먼저 치지 않고, 사물 명사와 그 동의어를 각각 한 단어로 검색한다.
 *
 * 모델이 아이디어에 없는 긴 합성어("레고분리도구")만 주면 그 문자열은 특허 제목에
 * 없어서 0건이 된다. 합성어가 아이디어 문장에 없으면, 문장과 겹치는 조각(레고)을
 * 합성어보다 먼저 시도한다.
 */
export function groundedKeywordSplits(keyword: string, ideaText: string): string[] {
  const trimmed = keyword.trim();
  if (trimmed.length <= 4 || isCommonKiprisWord(trimmed) || !ideaText.trim()) return [];
  const ideaNorm = ideaText.replace(/\s+/g, "");
  if (ideaNorm.includes(trimmed)) return [];

  const parts: string[] = [];
  let index = 0;
  while (index < trimmed.length) {
    let matched = "";
    for (let len = trimmed.length - index; len >= 2; len--) {
      const slice = trimmed.slice(index, index + len);
      if (slice === trimmed) continue;
      if (ideaNorm.includes(slice)) {
        matched = slice;
        break;
      }
    }
    if (!matched) {
      index += 1;
      continue;
    }
    if (!isCommonKiprisWord(matched) && !isDroppableModifier(matched) && !SUBSTITUTE_PRODUCTS.has(matched)) {
      parts.push(matched);
    }
    index += matched.length;
  }
  return parts;
}

export function planKiprisAttempts(keywords: string[], altKeywords: string[] = [], ideaText = ""): string[][] {
  const ordered = orderKiprisKeywords(keywords);
  if (ordered.length === 0) return [];

  const anchor = ordered.length === 1
    ? SUBSTITUTE_PRODUCTS.has(ordered[0])
      ? null
      : ordered[0]
    : pickAnchor(ordered);

  const specific: string[] = [];
  const invented: string[] = [];
  const broad: string[] = [];
  const seen = new Set<string>();
  const pushInto = (bucket: string[], word: string) => {
    const trimmed = word.trim();
    if (!trimmed || seen.has(trimmed) || SUBSTITUTE_PRODUCTS.has(trimmed) || isDroppableModifier(trimmed)) return;
    seen.add(trimmed);
    bucket.push(trimmed);
  };

  const consider = (word: string) => {
    const trimmed = word.trim();
    if (!trimmed) return;
    const splits = groundedKeywordSplits(trimmed, ideaText);
    if (splits.length > 0) {
      for (const part of splits) pushInto(specific, part);
      pushInto(invented, trimmed);
      return;
    }
    if (isBroadKiprisKeyword(trimmed)) {
      pushInto(broad, trimmed);
      return;
    }
    pushInto(specific, trimmed);
  };

  if (anchor) consider(anchor);
  for (const alt of altKeywords) consider(alt);
  for (const keyword of ordered) consider(keyword);

  return [...specific, ...invented, ...broad].slice(0, MAX_KIPRIS_ATTEMPTS).map((word) => [word]);
}

/**
 * keywords를 KIPRIS의 AND 연산자(*)로 조립한다. 토큰을 각각 encodeURIComponent한
 * 뒤 인코딩되지 않는 리터럴 "*"로 이어붙인다 — "*"/"!"/"("/")"는 encodeURIComponent가
 * 원래 이스케이프하지 않는 문자라 전체를 한 번에 인코딩해도 결과는 같지만, 토큰
 * 단위로 인코딩해야 나중에 "+"(OR) 등 다른 연산자를 실험할 때도 같은 패턴을 쓸 수
 * 있다. OR(+)은 KIPRIS가 실제로 %2B를 리터럴 "+"로 디코딩하는지 라이브 검증 전까지는
 * 자동 폴백 경로에 넣지 않는다 — 대신 아래처럼 키워드 개수를 줄여가며 AND로 재시도한다.
 */
function buildAndQuery(keywords: string[]): string {
  return keywords.map((k) => encodeURIComponent(k)).join("*");
}

/**
 * 라이브 호출로 실제 확인한 KIPRIS의 중요한 결함: word=A*B*C처럼 여러 키워드를
 * AND로 묶었을 때 실질적인 교집합이 작거나 없으면, 0건을 정직하게 반환하는 대신
 * successYN=Y·resultCode=00(정상)인 채로 검색어와 전혀 무관한 "일반적인" 특허
 * 목록(totalCount는 그럴듯한 양수)을 돌려주는 경우가 실제로 관측됐다(예:
 * "딸기*우주선" → 딸기/우주선과 무관한 상표등록 광고·CCTV 시스템 특허 111건).
 * API 메타데이터(successYN/resultCode/totalCount)만으로는 이 상황을 정상 매칭과
 * 구분할 수 없어서, 응답으로 온 각 항목의 제목/초록에 이번 검색식의 키워드가
 * 모두 들어 있는지만 남긴다. 하나라도 빠지면 가짜 성공으로 보고 다음 검색식으로 넘어간다.
 *
 * 라이브 호출로 실제 확인한 또 다른 결함(이건 KIPRIS가 아니라 이 필터 자체의 버그):
 * ai-query-gen.ts는 kiprisKeywords 각각을 "공백 없는 단어"로 강제한다(예: "드로잉로봇").
 * 그런데 실제 특허 제목/초록은 정상적인 띄어쓰기로 "드로잉 로봇"처럼 쓰여 있어서, 이
 * 함수가 공백을 그대로 둔 채 부분 문자열 비교를 하면 KIPRIS가 정확히 맞는 특허를
 * 돌려줘도("드로잉 로봇"이라는 제목의 특허) 매번 무관한 결과로 오판해 버려진다 —
 * 검색 자체는 정상 동작하는데 이 필터가 진짜 결과까지 다 걸러내 버리는 것과 같다.
 * 양쪽 문자열에서 공백을 제거하고 비교해 이 오탐을 없앤다.
 */
function keywordMatches(text: string, keyword: string, ideaText: string): boolean {
  const norm = keyword.trim();
  if (!norm) return false;
  // "레고"가 "레고라페닙" "오레고닌"에 끼는 부분 문자열은 같은 사물이 아니다.
  if (boundedIncludes(text, norm)) return true;
  // 긴 합성어가 제목에 그대로 없으면, 아이디어와 겹치는 조각이 모두 있을 때만 살린다.
  // 서비스·시스템처럼 어디서나 나오는 말만 겹치면 버린다.
  const parts = groundedKeywordSplits(keyword, ideaText).filter((part) => !isCommonKiprisWord(part));
  if (parts.length === 0) return false;
  return parts.every((part) => boundedIncludes(text, part));
}

export function patentIsRelevant(item: PatentItem, keywords: string[], ideaText = ""): boolean {
  const raw = `${item.title} ${item.summary ?? ""}`;
  // AND로 보낸 키워드가 제목/초록에 모두 있어야 한다. 하나만 겹치는 항목을
  // 통과시키면, 넓은 단어 하나가 점자 디스플레이처럼 다른 제품군을 통째로 살린다.
  if (!keywords.every((keyword) => keywordMatches(raw, keyword, ideaText))) return false;
  if (!ideaText.trim() || ideaNouns(ideaText).length === 0) return true;
  return sharesIdeaFocusInTitle(ideaText, item.title, item.summary ?? "");
}

export interface PatentAttemptOutcome {
  index: number;
  keywords: string[];
  readableQuery: string;
  ok: boolean;
  error?: string;
  relevant: PatentItem[];
}

/**
 * 동시 호출 결과 중 무엇을 남길지 고른다.
 * 구체적인 시도가 비어 있지 않으면 그것을 쓰고, 넓은 단어(공공데이터 등)는
 * 구체적인 시도가 아예 없을 때만 채택한다. API 오류와 0건은 구분한다.
 */
function isBroadAttempt(outcome: PatentAttemptOutcome): boolean {
  return outcome.keywords.length > 0 && outcome.keywords.every(isBroadKiprisKeyword);
}

export function selectPatentAttempt(outcomes: PatentAttemptOutcome[]): {
  chosen: PatentAttemptOutcome | null;
  error: string | null;
} {
  const specific = outcomes.filter((outcome) => !isBroadAttempt(outcome));
  const specificHits = specific.filter((outcome) => outcome.ok && outcome.relevant.length > 0);
  if (specificHits.length > 0) return { chosen: specificHits[0], error: null };
  if (specific.some((outcome) => outcome.ok)) return { chosen: null, error: null };

  const specificError = specific.find((outcome) => !outcome.ok);
  if (specificError) return { chosen: null, error: specificError.error ?? "KIPRIS 오류" };

  const broadHits = outcomes.filter((outcome) => isBroadAttempt(outcome) && outcome.ok && outcome.relevant.length > 0);
  if (broadHits.length > 0) return { chosen: broadHits[0], error: null };

  const firstError = outcomes.find((outcome) => !outcome.ok);
  if (firstError) return { chosen: null, error: firstError.error ?? "KIPRIS 오류" };
  return { chosen: null, error: null };
}

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
});

interface KiprisItem {
  inventionTitle?: string;
  applicantName?: string;
  applicationDate?: string;
  applicationNumber?: string;
  astrtCont?: string;
  ipcNumber?: string;
  registerStatus?: string;
}

interface KiprisResponse {
  response?: {
    header?: {
      successYN?: string;
      resultCode?: string;
      resultMsg?: string;
    };
    body?: {
      items?: { item?: KiprisItem | KiprisItem[] };
    };
  };
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | null {
  if (value == null) return null;
  const s = typeof value === "string" ? value : String(value);
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseKiprisXml(xml: string): { ok: true; items: PatentItem[] } | { ok: false; error: string } {
  let doc: KiprisResponse;
  try {
    doc = parser.parse(xml) as KiprisResponse;
  } catch {
    return { ok: false, error: "KIPRIS 응답을 해석하지 못했습니다." };
  }

  const header = doc.response?.header;
  if (header && header.successYN !== "Y") {
    return { ok: false, error: `KIPRIS 오류: ${header.resultMsg ?? header.resultCode ?? "알 수 없는 오류"}` };
  }

  const rawItems = asArray(doc.response?.body?.items?.item);
  const items = rawItems
    .map((item): PatentItem | null => {
      const title = textOf(item.inventionTitle);
      if (!title) return null;
      const applicationNumber = textOf(item.applicationNumber);
      return {
        id: applicationNumber ?? title,
        title,
        summary: textOf(item.astrtCont),
        applicationNumber,
        applicantName: textOf(item.applicantName),
        applicationDate: textOf(item.applicationDate),
        registrationStatus: textOf(item.registerStatus),
        ipcNumber: textOf(item.ipcNumber),
        sourceUrl: null,
      };
    })
    .filter((item): item is PatentItem => item !== null);

  return { ok: true, items };
}

export function isPatentSearchConfigured(): boolean {
  return !!process.env.KIPRIS_SERVICE_KEY;
}

/**
 * word= 하나로 실제 KIPRIS 호출을 한 번 수행한다 (재시도 루프에서 여러 번 호출됨).
 *
 * word는 buildAndQuery()가 이미 각 키워드를 encodeURIComponent한 뒤 "*"로 이어붙인
 * 값이다(예: "%EB%93%9C...%EB%B4%87") — 여기서 다시 encodeURIComponent(word)를 하면
 * 그 결과의 "%" 자체가 "%25"로 한 번 더 인코딩되는 이중 인코딩 버그가 된다. 그러면
 * KIPRIS는 word를 다른 문자열로 오인해, 검색어와 전혀 무관한 특허를 successYN=Y로
 * 돌려준다(라이브 호출로 실제 확인: "드로잉로봇" 검색이 PCM 인코딩 변환장치 같은
 * 완전 무관한 특허를 반환했다) — 위 isRelevant가 걸러내는 "가짜 성공"과 증상은
 * 같지만 원인은 API가 아니라 이 이중 인코딩이었다. word는 이미 인코딩된 값이므로
 * 그대로 이어붙인다.
 */
async function callKipris(
  word: string,
  serviceKey: string,
  numOfRows: number,
): Promise<{ ok: true; items: PatentItem[] } | { ok: false; error: string }> {
  const url =
    `${KIPRIS_ENDPOINT}?word=${word}` +
    `&ServiceKey=${encodeURIComponent(serviceKey)}&pageNo=1&numOfRows=${numOfRows}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `KIPRIS 호출 실패: ${res.status} ${text}`.slice(0, 300) };
    }
    const xml = await res.text();
    return parseKiprisXml(xml);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * planKiprisAttempts()가 만든 검색식을 동시에 친다. 벽시계 시간은 가장 느린
 * 한 번의 호출에 가깝다. 구체적인 키워드의 관련 결과가 있으면 그것을 고르고,
 * 공공데이터 같은 넓은 단어는 그게 유일한 시도일 때만 남긴다.
 * 호출이 실패하면 ok:false, 호출은 됐는데 관련 결과가 없으면 ok:true·빈 목록이다.
 * OR(+) 연산자는 KIPRIS가 %2B 인코딩을 실제로 어떻게 처리하는지 검증되기 전까지는 쓰지 않는다.
 */
export async function searchPatents(
  keywords: string[],
  numOfRows = 10,
  altKeywords: string[] = [],
  ideaText = "",
): Promise<PatentSearchResult> {
  const serviceKey = process.env.KIPRIS_SERVICE_KEY;
  if (!serviceKey) {
    return { ok: true, items: [], skipped: true };
  }

  const attempts = planKiprisAttempts(keywords, altKeywords, ideaText);
  if (attempts.length === 0) return { ok: true, items: [] };

  const readableAttempts = attempts.map((group) => group.join("*"));
  const outcomes = await Promise.all(
    attempts.map(async (attemptKeywords, index): Promise<PatentAttemptOutcome> => {
      const readableQuery = readableAttempts[index];
      const word = buildAndQuery(attemptKeywords);
      const result = await callKipris(word, serviceKey, numOfRows);
      if (!result.ok) {
        console.log(`[kipris] query="${readableQuery}" (${index + 1}/${attempts.length}) → error: ${result.error}`);
        return { index, keywords: attemptKeywords, readableQuery, ok: false, error: result.error, relevant: [] };
      }
      const relevant = result.items.filter((item) => patentIsRelevant(item, attemptKeywords, ideaText));
      const noiseCount = result.items.length - relevant.length;
      console.log(
        `[kipris] query="${readableQuery}" (${index + 1}/${attempts.length}) → ${result.items.length}건 ` +
          `(관련 ${relevant.length}건${noiseCount > 0 ? `, 무관한 결과 ${noiseCount}건 제외` : ""})`,
      );
      return { index, keywords: attemptKeywords, readableQuery, ok: true, relevant };
    }),
  );

  const selected = selectPatentAttempt(outcomes);
  if (selected.error) {
    const failed = outcomes.find((outcome) => !outcome.ok);
    return {
      ok: false,
      items: [],
      error: selected.error,
      queryUsed: failed?.readableQuery ?? readableAttempts[0],
      attempts: readableAttempts,
    };
  }
  if (selected.chosen) {
    return {
      ok: true,
      items: selected.chosen.relevant,
      queryUsed: selected.chosen.readableQuery,
      fallbackUsed: selected.chosen.index > 0,
      fallbackDepth: selected.chosen.keywords.length,
      attempts: readableAttempts,
    };
  }

  return {
    ok: true,
    items: [],
    queryUsed: readableAttempts[0],
    fallbackUsed: attempts.length > 1,
    fallbackDepth: 0,
    attempts: readableAttempts,
  };
}
