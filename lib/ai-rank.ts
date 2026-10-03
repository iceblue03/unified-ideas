import { callOpenRouter } from "./openrouter";
import { extractJson } from "./ai-json";
import { ideaMentionsCane } from "./ai-query-gen";
import { sharesIdeaFocusInTitle, textMentionsCaneLeak } from "./relevance";
import { overlapTier } from "./score-thresholds";
import { CATEGORY_LABEL, formatMoney } from "./types";
import type { AiReport, AiTopMatchCard, UnifiedResultItem, Verdict } from "./types";

/**
 * AI 호출 #2: 대회·상품·특허를 최대 10건씩 내용을 읽고 아이디어와 겹치는지 설명한다.
 * 카드의 퍼센트는 이 함수가 바꾸지 않는다.
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
    const { mallName, lprice, currency } = item.product;
    const price = lprice != null ? formatMoney(lprice, currency) : null;
    return [mallName, price].filter(Boolean).join(" · ");
  }
  const { applicationDate, applicantName, registrationStatus } = item.patent;
  return [applicationDate ? `출원 ${applicationDate}` : null, applicantName, registrationStatus]
    .filter(Boolean)
    .join(" · ");
}

function itemSummary(item: UnifiedResultItem): string | null {
  if (item.type === "competition") return item.idea.summary;
  if (item.type === "product") return item.product.category;
  // 특허 초록(abstract) — 관련도 판단에 실제로 필요한 핵심 정보
  return item.patent.summary;
}

function itemSourceUrl(item: UnifiedResultItem): string | null {
  if (item.type === "competition") return item.idea.sourceUrl;
  if (item.type === "product") return item.product.link;
  return item.patent.sourceUrl;
}

function sectionText(label: string, items: UnifiedResultItem[], start: number): { text: string; next: number } {
  if (items.length === 0) return { text: `[${label}]\n없음`, next: start };
  const lines = items.map((item, i) => {
    const summary = itemSummary(item);
    return (
      `${start + i}. ${itemTitle(item)} (${itemMeta(item)})` + (summary ? `\n   ${summary.slice(0, 400)}` : "")
    );
  });
  return { text: `[${label} ${items.length}건]\n${lines.join("\n")}`, next: start + items.length };
}

function verdictFromScore(score: number): Verdict {
  const tier = overlapTier(score);
  if (tier === "high") return "exists";
  if (tier === "partial") return "partial";
  return "blue_ocean";
}

function bestPoolScore(pool: UnifiedResultItem[]): number {
  return pool.reduce((max, item) => Math.max(max, item.score), 0);
}

function fallbackReport(pool: UnifiedResultItem[], rawText?: string): AiReport {
  return {
    verdict: verdictFromScore(bestPoolScore(pool)),
    summary: "",
    tags: [],
    topMatches: [],
    rawText,
  };
}

/** 대회·특허는 사물 명사가 맞을 때만 근거가 된다. 제품은 지팡이 검색어가 샌 경우만 뺀다. */
export function itemSupportsIdea(idea: string, item: UnifiedResultItem): boolean {
  const title = itemTitle(item);
  if (item.type === "product") return ideaMentionsCane(idea) || !textMentionsCaneLeak(title);
  const summary = itemSummary(item) ?? "";
  return sharesIdeaFocusInTitle(idea, title, summary);
}

function citesTitle(summary: string, title: string): boolean {
  const snippet = title.trim().slice(0, 18);
  return snippet.length >= 4 && summary.includes(snippet);
}

function deniesOverlap(summary: string): boolean {
  return /블루오션|새로운 개념|겹치는 (?:사례|항목|후보).{0,16}없|유사(?:한)? (?:항목|사례|후보).{0,16}없|실질적으로 유사.{0,12}없/.test(
    summary,
  );
}

function groupedPoolText(pool: UnifiedResultItem[]): string {
  const competitions = pool.filter((item) => item.type === "competition");
  const products = pool.filter((item) => item.type === "product");
  const patents = pool.filter((item) => item.type === "patent");
  const competition = sectionText("대회 수상작", competitions, 1);
  const product = sectionText("판매 제품", products, competition.next);
  const patent = sectionText("특허", patents, product.next);
  return [competition.text, product.text, patent.text].join("\n\n");
}

export async function rankAndDiagnose(ideaText: string, pool: UnifiedResultItem[]): Promise<RankResult> {
  if (pool.length === 0) {
    return { pool, report: null, warning: "비교할 후보가 없습니다." };
  }

  const cited = pool.find((item) => itemSupportsIdea(ideaText, item));
  const prompt =
    `당신은 아이디어와 이미 검색된 사례를 내용으로 비교합니다. 점수를 매기거나 퍼센트를 만들지 마세요.\n\n` +
    `사용자 아이디어:\n"""\n${ideaText.slice(0, 1500)}\n"""\n\n` +
    `아래는 대회 수상작, 판매 제품, 특허를 각각 최대 10건 모은 것입니다. 제목과 설명을 읽고 판단하세요.\n` +
    `없는 묶음은 "없음"입니다.\n\n${groupedPoolText(pool)}\n\n` +
    `[반드시 지킬 것]\n` +
    `- 목록에 적힌 제목과 설명만 근거로 쓰세요. 없는 기술을 지어내지 마세요.\n` +
    `- 대회, 제품, 특허를 모두 보세요. 한 묶음만 보고 결론내지 마세요.\n` +
    `- 같은 사물이 제목이나 설명에 있으면 겹친다고 말하세요. ` +
    `예를 들어 아이디어가 점자 안내 지팡이이고 수상작이나 특허 제목에 점자 지팡이, 안내 지팡이, 흰지팡이가 있으면 그 항목을 근거로 쓰세요.\n` +
    `- 입력하면 결과가 나온다, 거래한다, 예약한다처럼 방식만 비슷하면 겹침이 아닙니다. ` +
    `버스 여행 추천은 손글씨 폰트가 아니고, 중고차 거래는 교재 교환이 아니고, 관광 앱의 자리 예약은 축제 대기줄 예약이 아닙니다.\n` +
    `- 목록 아래쪽의 다른 주제(임신 테스트, 가격 평가, 점자 번역 펜처럼 지팡이가 아닌 것)만 보고 ` +
    `전체가 새롭다고 쓰지 마세요.\n` +
    `- verdict는 exists(같은 목적의 사물이나 서비스가 목록에 있음), partial(일부 요소만 같음), ` +
    `blue_ocean(목록에서 같은 사물이나 기능을 찾을 수 없음) 중 하나입니다.\n` +
    `- summary는 2~3문장입니다. 겹치는 항목이 있으면 그 제목을 인용하고, 대회인지 제품인지 특허인지 말합니다.\n` +
    `- topMatches는 내용이 실제로 가까운 항목만 최대 3개입니다. 없으면 빈 배열입니다. 개수를 채우려고 넣지 마세요.\n\n` +
    `다른 설명 없이 JSON 객체 하나만 출력하세요. 문자열은 한국어로.\n\n` +
    `{\n` +
    `  "verdict": "exists" | "partial" | "blue_ocean",\n` +
    `  "summary": "2~3문장",\n` +
    `  "tags": ["짧은 키워드 3~5개"],\n` +
    `  "topMatches": [ { "index": 후보_번호, "reason": "그 항목의 어느 내용이 아이디어와 같은지 한 문장" } ]\n` +
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
      topMatches?: unknown;
    };

    let verdict = VERDICTS.includes(raw.verdict as Verdict) ? (raw.verdict as Verdict) : verdictFromScore(bestPoolScore(pool));
    let summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, 500) : "";
    if (cited && (verdict === "blue_ocean" || deniesOverlap(summary))) {
      verdict = "partial";
      if (!summary || deniesOverlap(summary)) {
        summary = `${itemTitle(cited)}의 제목이 아이디어와 같은 내용을 담고 있습니다. 이 항목은 ${CATEGORY_LABEL[cited.type]} 검색 결과에 있습니다.`;
      }
    }
    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 6)
      : [];

    const topMatches: AiTopMatchCard[] = [];
    if (Array.isArray(raw.topMatches)) {
      for (const entry of raw.topMatches) {
        if (topMatches.length >= 3) break;
        if (typeof entry !== "object" || entry === null) continue;
        const { index, reason } = entry as { index?: unknown; reason?: unknown };
        const idx = Number(index);
        if (!Number.isInteger(idx) || idx < 1 || idx > pool.length) continue;
        const item = pool[idx - 1];
        if (!itemSupportsIdea(ideaText, item)) continue;
        topMatches.push({
          type: item.type,
          title: itemTitle(item),
          meta: itemMeta(item),
          reason: typeof reason === "string" ? reason.trim().slice(0, 200) : "",
          similarity: item.score,
          sourceUrl: itemSourceUrl(item),
        });
      }
    }

    const supporters = pool.filter((item) => itemSupportsIdea(ideaText, item));
    const summaryCitesSupport = supporters.some((item) => citesTitle(summary, itemTitle(item)));
    const summaryCitesMiss = pool.some(
      (item) => !itemSupportsIdea(ideaText, item) && citesTitle(summary, itemTitle(item)),
    );
    if ((verdict === "exists" || verdict === "partial") && supporters.length === 0) {
      verdict = "blue_ocean";
      summary = "검색된 항목에서 이 아이디어와 같은 사물을 찾지 못했습니다.";
    } else if (summaryCitesMiss && !summaryCitesSupport && supporters[0]) {
      const evidence = supporters[0];
      verdict = "partial";
      summary = `${itemTitle(evidence)}의 제목이 아이디어와 같은 사물을 담고 있습니다. 이 항목은 ${CATEGORY_LABEL[evidence.type]} 검색 결과에 있습니다.`;
    }

    if (!summary && tags.length === 0 && topMatches.length === 0) {
      return { pool, report: fallbackReport(pool, res.text.trim()), warning: "AI 응답이 비어 있습니다." };
    }

    return { pool, report: { verdict, summary, tags, topMatches } };
  } catch {
    return { pool, report: fallbackReport(pool, res.text.trim()), warning: "AI 응답을 해석하지 못했습니다." };
  }
}
