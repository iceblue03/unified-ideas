import type { Idea } from "./types";

export interface CollectionRunStats {
  freshCount: number;
  mergedCount: number;
  summaryFilled: number;
  summaryRatio: number;
  maxYear: number | null;
}

export function statsForItems(items: Idea[]): Omit<CollectionRunStats, "freshCount" | "mergedCount"> & { count: number } {
  const count = items.length;
  const summaryFilled = items.filter((i) => (i.summary ?? "").trim().length >= 20).length;
  const years = items.map((i) => i.year).filter((y): y is number => y != null);
  const maxYear = years.length > 0 ? Math.max(...years) : null;
  return {
    count,
    summaryFilled,
    summaryRatio: count > 0 ? summaryFilled / count : 0,
    maxYear,
  };
}

/** 목록을 매 실행마다 긁어야 하는 수집기 — fresh가 0이면 파서/사이트 문제로 본다. */
export const LIST_FETCH_SLUGS = new Set([
  "esw-contest",
  "public-data-startup",
  "youth-startup",
  "code-fair",
  "kipa-invention-patent",
  "mafra-public-data-startup",
  "student-invention",
  "k-startup",
]);

export function evaluateCollectionQuality(
  slug: string,
  tier: string,
  freshCount: number,
  existingCount: number,
  thrownError?: string,
): string | undefined {
  if (thrownError) return thrownError;

  if (tier === "manual") return undefined;

  if (freshCount === 0 && existingCount === 0) {
    return "수집 결과 0건이며 누적 데이터도 없습니다.";
  }

  if (LIST_FETCH_SLUGS.has(slug) && freshCount === 0 && existingCount > 0) {
    return "이번 실행에서 목록 수집 0건 — HTML/API 파서 또는 원본 사이트 오류 가능성";
  }

  return undefined;
}
