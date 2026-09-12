import { callOpenRouter } from "./openrouter";
import { extractJson } from "./ai-json";
import { overlapTier } from "./score-thresholds";
import { CATEGORY_LABEL } from "./types";
import type { AiReport, AiTopMatchCard, CompetitionResultItem, UnifiedResultItem, Verdict } from "./types";

/**
 * AI 호출 #2: 대회/제품/특허를 뒤섞은 pool 전체를 하나의 관련성 기준으로 재평가하고,
 * "이미 존재함/일부 겹침/블루오션" 같은 구조화된 진단 리포트를 만든다.
 * - 전체 항목에는 relevance 점수만 받아 각 카테고리 탭 정렬에 쓴다 (토큰 절약).
 * - 가장 관련성 높은 최대 3개에 대해서만 한 줄 근거를 받아 헤드라인 리포트에 쓴다.
 */

export interface RankResult {
  pool: UnifiedResultItem[];
  report: AiReport | null;
  warning?: string;
}

const VERDICTS: Verdict[] = ["exists", "partial", "blue_ocean"];

function itemTitle(item: UnifiedResultItem): string {
  if (item.type === "competition") return item.idea.title;
  if (item.type === "product") return item.product.title;
  return item.patent.title;
}

function itemMeta(item: UnifiedResultItem): string {
  if (item.type === "competition") {
    const { competitionName, year, award } = item.idea;
    return [competitionName, year ? String(year) : null, award].filter(Boolean).join(" · ");
  }
  if (item.type === "product") {
    const { mallName, lprice } = item.product;
    const price = lprice != null ? `${lprice.toLocaleString()}원` : null;
    return [mallName, price].filter(Boolean).join(" · ");
  }
  const { applicationDate, applicantName } = item.patent;
  return [applicationDate ? `출원 ${applicationDate}` : null, applicantName].filter(Boolean).join(" · ");
}

function itemSummary(item: UnifiedResultItem): string | null {
  if (item.type === "competition") return item.idea.summary;
  if (item.type === "product") return item.product.category;
  return item.patent.registrationStatus;
}

function itemSourceUrl(item: UnifiedResultItem): string | null {
  if (item.type === "competition") return item.idea.sourceUrl;
  if (item.type === "product") return item.product.link;
  return item.patent.sourceUrl;
}

function buildPoolText(pool: UnifiedResultItem[]): string {
  return pool
    .map((item, i) => {
      const summary = itemSummary(item);
      return (
        `${i + 1}. [${CATEGORY_LABEL[item.type]}] ${itemTitle(item)} (${itemMeta(item)})` +
        (summary ? `\n   ${summary.slice(0, 150)}` : "")
      );
    })
    .join("\n");
}

function verdictFromScore(score: number): Verdict {
  const tier = overlapTier(score);
  if (tier === "high") return "exists";
  if (tier === "partial") return "partial";
  return "blue_ocean";
}

// 제품/특허 항목의 score는 실제 유사도가 아니라 외부 API 응답 순서 기반 pseudo-score
// (app/api/search/route.ts)라서, AI가 실제로 판단하지 못한 verdict를 추정할 때는
// 유사도 척도로 검증된 대회(TF-IDF) 점수만 근거로 삼는다.
function bestCompetitionScore(pool: UnifiedResultItem[]): number {
  return pool
    .filter((item): item is CompetitionResultItem => item.type === "competition")
    .reduce((max, item) => Math.max(max, item.score), 0);
}

function fallbackReport(pool: UnifiedResultItem[], rawText?: string): AiReport {
  return {
    verdict: verdictFromScore(bestCompetitionScore(pool)),
    summary: "",
    tags: [],
    topMatches: [],
    rawText,
  };
}

export async function rankAndDiagnose(ideaText: string, pool: UnifiedResultItem[]): Promise<RankResult> {
  if (pool.length === 0) {
    return { pool, report: null, warning: "비교할 후보가 없습니다." };
  }

  const prompt =
    `사용자가 다음과 같은 아이디어를 구상 중입니다:\n"""\n${ideaText.slice(0, 1500)}\n"""\n\n` +
    `아래는 대회 수상작 / 실제 판매 중인 제품 / 특허 출원 내역을 뒤섞어 나열한 후보 목록입니다 ` +
    `(번호 1~${pool.length}):\n\n${buildPoolText(pool)}\n\n` +
    `이 후보들과 사용자 아이디어를 비교 분석해서, 다른 설명이나 마크다운, 코드블록 표시 없이 아래 ` +
    `스키마의 순수 JSON 객체 "하나만" 출력하세요. 모든 문자열 값은 한국어로, 과장 없이 사실 기반으로 ` +
    `간결하게 작성하세요.\n\n` +
    `{\n` +
    `  "verdict": "exists" | "partial" | "blue_ocean",  // exists=이미 비슷한 사례가 있음, partial=일부만 겹침, blue_ocean=뚜렷하게 겹치는 사례 없음\n` +
    `  "summary": "위와 같이 판단한 근거를 1~3문장으로",\n` +
    `  "tags": ["아이디어를 요약하는 짧은 키워드 칩 3~5개, 각 4~10자"],\n` +
    `  "relevance": [ { "index": 후보_번호, "score": 0~1_사이_관련도 }, ... ],  // 후보 전체(1~${pool.length}) 각각에 대해 하나씩\n` +
    `  "topMatches": [ { "index": 후보_번호, "relevance": 0~1_사이_관련도, "reason": "이 후보가 왜 관련/유사한지 한 문장" }, ... ]  // 관련도가 가장 높은 후보 최대 3개, 관련도 높은 순, 뚜렷하게 관련된 후보가 없으면 빈 배열. relevance는 위 relevance 배열의 같은 인덱스 값과 일치해야 함\n` +
    `}`;

  const res = await callOpenRouter(prompt, 12_000);
  if (!res.ok) {
    return { pool, report: fallbackReport(pool), warning: res.error };
  }

  const jsonStr = extractJson(res.text);
  if (!jsonStr) {
    return { pool, report: fallbackReport(pool, res.text.trim()), warning: "AI 응답을 해석하지 못했습니다." };
  }

  try {
    const raw = JSON.parse(jsonStr) as {
      verdict?: unknown;
      summary?: unknown;
      tags?: unknown;
      relevance?: unknown;
      topMatches?: unknown;
    };

    const relevanceList = Array.isArray(raw.relevance) ? raw.relevance : [];
    for (const entry of relevanceList) {
      if (typeof entry !== "object" || entry === null) continue;
      const { index, score } = entry as { index?: unknown; score?: unknown };
      const idx = Number(index);
      const s = Number(score);
      if (Number.isInteger(idx) && idx >= 1 && idx <= pool.length && Number.isFinite(s)) {
        pool[idx - 1].aiScore = Math.max(0, Math.min(1, s));
      }
    }

    // verdict 폴백도 AI가 실제로 채점한(aiScore 존재) 항목만 근거로 삼는다 — 하나도
    // 없으면(relevance가 전부 비었으면) 대회 TF-IDF 점수로 다시 추정한다.
    const judgedScores = pool
      .map((item) => item.aiScore)
      .filter((s): s is number => s !== undefined);
    const bestScore = judgedScores.length > 0 ? Math.max(...judgedScores) : bestCompetitionScore(pool);
    const verdict = VERDICTS.includes(raw.verdict as Verdict) ? (raw.verdict as Verdict) : verdictFromScore(bestScore);

    const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, 500) : "";
    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 6)
      : [];

    const rawTopMatches = Array.isArray(raw.topMatches) ? raw.topMatches : [];
    const topMatches: AiTopMatchCard[] = [];
    for (const entry of rawTopMatches) {
      if (topMatches.length >= 3) break;
      if (typeof entry !== "object" || entry === null) continue;
      const { index, relevance, reason } = entry as { index?: unknown; relevance?: unknown; reason?: unknown };
      const idx = Number(index);
      if (!Number.isInteger(idx) || idx < 1 || idx > pool.length) continue;
      const item = pool[idx - 1];
      item.aiReason = typeof reason === "string" ? reason.trim().slice(0, 200) : "";

      // topMatches의 relevance가 relevance 배열 커버리지와 어긋나도(모델이 둘 중 하나만
      // 채운 경우) 이 항목의 헤드라인 카드는 non-AI pseudo-score로 대체되지 않도록,
      // 여기서 직접 받은 relevance를 최우선으로 쓰고 aiScore가 비어 있으면 채워준다.
      const rel = Number(relevance);
      const clampedRel = Number.isFinite(rel) ? Math.max(0, Math.min(1, rel)) : undefined;
      if (item.aiScore === undefined && clampedRel !== undefined) item.aiScore = clampedRel;

      topMatches.push({
        type: item.type,
        title: itemTitle(item),
        meta: itemMeta(item),
        reason: item.aiReason,
        similarity: item.aiScore ?? clampedRel ?? item.score,
        sourceUrl: itemSourceUrl(item),
      });
    }

    if (!summary && tags.length === 0 && topMatches.length === 0) {
      return { pool, report: fallbackReport(pool, res.text.trim()), warning: "AI 응답이 비어 있습니다." };
    }

    return { pool, report: { verdict, summary, tags, topMatches } };
  } catch {
    return { pool, report: fallbackReport(pool, res.text.trim()), warning: "AI 응답을 해석하지 못했습니다." };
  }
}
