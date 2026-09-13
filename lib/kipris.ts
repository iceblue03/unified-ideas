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

export async function searchPatents(query: string, numOfRows = 10): Promise<PatentSearchResult> {
  const serviceKey = process.env.KIPRIS_SERVICE_KEY;
  if (!serviceKey) {
    return { ok: true, items: [], skipped: true };
  }

  const trimmed = query.trim();
  if (!trimmed) return { ok: true, items: [] };

  try {
    const url =
      `${KIPRIS_ENDPOINT}?word=${encodeURIComponent(trimmed)}` +
      `&ServiceKey=${encodeURIComponent(serviceKey)}&pageNo=1&numOfRows=${numOfRows}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, items: [], error: `KIPRIS 호출 실패: ${res.status} ${text}`.slice(0, 300) };
    }

    const xml = await res.text();
    const parsed = parseKiprisXml(xml);
    if (!parsed.ok) return { ok: false, items: [], error: parsed.error };
    return { ok: true, items: parsed.items };
  } catch (e) {
    return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) };
  }
}
