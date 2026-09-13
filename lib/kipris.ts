import { XMLParser } from "fast-xml-parser";
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
  /** 전체 키워드 AND가 0건이라 키워드를 줄여 재시도했는지 */
  fallbackUsed?: boolean;
  /** 최종적으로 사용한 키워드 개수 (원래 개수보다 적으면 폴백이 적용된 것) */
  fallbackDepth?: number;
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
 * 구분할 수 없어서, 응답으로 온 각 항목의 제목/초록에 검색 키워드 중 하나라도
 * 실제로 포함돼 있는지 직접 확인한다 — 하나도 포함되지 않은 항목은 이 "가짜 성공"
 * 응답으로 간주해 버리고, 다음 폴백 단계(키워드 하나 줄이기)로 넘어간다.
 */
function isRelevant(item: PatentItem, keywords: string[]): boolean {
  const haystack = `${item.title} ${item.summary ?? ""}`;
  return keywords.some((k) => haystack.includes(k));
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

/** word= 하나로 실제 KIPRIS 호출을 한 번 수행한다 (재시도 루프에서 여러 번 호출됨). */
async function callKipris(
  word: string,
  serviceKey: string,
  numOfRows: number,
): Promise<{ ok: true; items: PatentItem[] } | { ok: false; error: string }> {
  const url =
    `${KIPRIS_ENDPOINT}?word=${encodeURIComponent(word)}` +
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
 * keywords 전체를 AND로 검색하고, 관련 있는 결과가 없으면(0건이거나, 응답은 왔지만
 * 위 isRelevant를 통과하는 항목이 하나도 없는 "가짜 성공") 마지막 키워드부터 하나씩
 * 줄여가며 재시도한다(예: [k1,k2,k3,k4] → k1*k2*k3*k4 → k1*k2*k3 → k1*k2 → k1).
 * 자연어 구절을 그대로 보내던 예전 방식은 실제 특허 문서(다른 어순·조사·복합명사)와
 * 거의 안 겹쳐 결과가 0건/타임아웃으로 나오는 근본 원인이었다 — 핵심 키워드를 AND로
 * 좁혀서 검색하고, 그래도 관련 결과가 없으면 범위를 넓혀가는 방식으로 바꿨다. OR(+)
 * 연산자는 KIPRIS가 %2B 인코딩을 실제로 어떻게 처리하는지 검증되기 전까지는 쓰지
 * 않는다.
 */
export async function searchPatents(keywords: string[], numOfRows = 10): Promise<PatentSearchResult> {
  const serviceKey = process.env.KIPRIS_SERVICE_KEY;
  if (!serviceKey) {
    return { ok: true, items: [], skipped: true };
  }

  const cleaned = filterStopwords(keywords.map((k) => k.trim()).filter(Boolean));
  if (cleaned.length === 0) return { ok: true, items: [] };

  for (let depth = cleaned.length; depth >= 1; depth--) {
    const attemptKeywords = cleaned.slice(0, depth);
    // readableQuery는 화면/로그 표시용(사람이 읽는 "키워드1*키워드2"), word는 실제
    // URL에 실리는 encodeURIComponent된 값 — 인코딩된 값을 그대로 표시하면
    // "%EB%B0%98..." 같은 읽을 수 없는 문자열이 UI에 노출된다.
    const readableQuery = attemptKeywords.join("*");
    const word = buildAndQuery(attemptKeywords);
    const result = await callKipris(word, serviceKey, numOfRows);

    if (!result.ok) {
      console.log(`[kipris] query="${readableQuery}" (depth ${depth}/${cleaned.length}) → error: ${result.error}`);
      return { ok: false, items: [], error: result.error, queryUsed: readableQuery };
    }

    const relevant = result.items.filter((item) => isRelevant(item, attemptKeywords));
    const noiseCount = result.items.length - relevant.length;
    console.log(
      `[kipris] query="${readableQuery}" (depth ${depth}/${cleaned.length}) → ${result.items.length}건 ` +
        `(관련 ${relevant.length}건${noiseCount > 0 ? `, 무관한 결과 ${noiseCount}건 제외` : ""})`,
    );

    if (relevant.length > 0 || depth === 1) {
      return {
        ok: true,
        items: relevant,
        queryUsed: readableQuery,
        fallbackUsed: depth < cleaned.length,
        fallbackDepth: depth,
      };
    }
  }

  // cleaned.length가 0이 아닌 이상 위 루프가 depth===1에서 항상 return하므로 도달하지 않음.
  return { ok: true, items: [] };
}
