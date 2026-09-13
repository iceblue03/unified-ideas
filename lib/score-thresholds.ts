/**
 * 겹침 정도를 3단계로 나누는 공용 기준선. TF-IDF 유사도(lib/similarity.ts)와
 * AI 관련도 점수 둘 다 이 기준을 공유해서, 카드 색상(app/components/ui.tsx)과
 * AI 진단 리포트의 verdict(lib/ai-rank.ts)가 서로 다른 기준으로 어긋나지 않게 한다.
 */
export const HIGH_OVERLAP_THRESHOLD = 0.45;
export const PARTIAL_OVERLAP_THRESHOLD = 0.28;

export type OverlapTier = "high" | "partial" | "low";

export function overlapTier(score: number): OverlapTier {
  if (score >= HIGH_OVERLAP_THRESHOLD) return "high";
  if (score >= PARTIAL_OVERLAP_THRESHOLD) return "partial";
  return "low";
}
