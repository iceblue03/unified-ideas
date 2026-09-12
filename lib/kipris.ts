import { XMLParser } from "fast-xml-parser";
import type { PatentItem } from "./types";

/**
 * KIPRIS Plus - 특허실용신안 정보 검색 서비스 (patUtiModInfoSearchSevice.getWordSearch)
 * https://plus.kipris.or.kr 가입 후 발급받은 ServiceKey로 호출하는 무료 API. XML 응답.
 *
 * 주의: 정확한 host/path/필드명은 실제 서비스키로 검증되지 않았다 (data.go.kr 공개 문서
 * 기준 추정). parseKiprisXml을 순수 함수로 분리해두었으니, 실제 응답 샘플이 생기면
 * 이 함수만 조정하면 된다. KIPRIS_SERVICE_KEY가 없으면 이 데이터소스는 조용히 스킵된다.
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
  applicationNumber?: string;
  applicantName?: string;
  applicationDate?: string;
  openNumber?: string;
  registerStatus?: string;
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

export function parseKiprisXml(xml: string): PatentItem[] {
  try {
    const doc = parser.parse(xml) as {
      response?: {
        body?: {
          items?: { item?: KiprisItem | KiprisItem[] };
        };
      };
    };
    const rawItems = asArray(doc.response?.body?.items?.item);

    return rawItems
      .map((item): PatentItem | null => {
        const title = textOf(item.inventionTitle);
        if (!title) return null;
        const applicationNumber = textOf(item.applicationNumber);
        return {
          id: applicationNumber ?? title,
          title,
          applicationNumber,
          applicantName: textOf(item.applicantName),
          applicationDate: textOf(item.applicationDate),
          publicationNumber: textOf(item.openNumber),
          registrationStatus: textOf(item.registerStatus),
          sourceUrl: null,
        };
      })
      .filter((item): item is PatentItem => item !== null);
  } catch {
    return [];
  }
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
    const items = parseKiprisXml(xml);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) };
  }
}
