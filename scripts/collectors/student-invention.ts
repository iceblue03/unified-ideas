import * as cheerio from "cheerio";
import type { Collector, Idea } from "../../lib/types";
import { makeId } from "../../lib/id";
import { STUDENT_INVENTION_META } from "../../lib/collector-meta";

const BASE = "https://www.ip-edu.net/home/kor/award/festival2024/exhibition";
const LIST_URL = `${BASE}/inc/list.ajax`;
const DETAIL_URL = `${BASE}/edit.do`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// tabPos2: 1=역대대통령상 전시관, 2=우수상격 전시관, 3=동상 및 장려상수상작 전시관, 4=전국교원발명경진대회 수상작 전시관
const TIERS: Array<{ tabPos2: number; category: string }> = [
  { tabPos2: 1, category: "대통령상" },
  { tabPos2: 2, category: "우수상격" },
  { tabPos2: 3, category: "동상 및 장려상" },
  { tabPos2: 4, category: "전국교원발명경진대회" },
];

// 사이트의 연도 선택 콤보박스가 2021~2026을 제공하는 것으로 확인됨(자세한 건
// lib/collector-meta.ts의 STUDENT_INVENTION_META 참고).
const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];
const MAX_PAGES_PER_TIER = 30;

interface ListItem {
  idx: string;
  title: string;
  award: string | null;
}

async function fetchList(tabPos2: number, year: number, pageIndex: number): Promise<ListItem[]> {
  const form = new FormData();
  form.set("menuPos", "1");
  form.set("tabPos", "1");
  form.set("tabPos2", String(tabPos2));
  form.set("searchValue1", String(year));
  form.set("searchValue3", "");
  form.set("searchValue10", "");
  form.set("idx", "");
  form.set("pageIndex", String(pageIndex));

  const res = await fetch(LIST_URL, { method: "POST", headers: { "User-Agent": UA }, body: form });
  if (!res.ok) throw new Error(`student-invention: HTTP ${res.status} on list.ajax (tabPos2=${tabPos2}, year=${year}, page=${pageIndex})`);
  const html = await res.text();

  const $ = cheerio.load(html);
  const items: ListItem[] = [];
  $("li").each((_, li) => {
    const title = $(li).find(".text_box .title").first().text().trim();
    if (!title) return;
    const idxMatch = $(li).find("a[onclick*='fn_edit']").attr("onclick")?.match(/fn_edit\('(\d+)'\)/);
    const idx = idxMatch ? idxMatch[1] : null;
    if (!idx) return;
    const awardText = $(li).find(".info_list li").first().text().replace(/\s+/g, " ").trim();
    const award = awardText ? awardText.split(" - ")[0].trim() : null;
    items.push({ idx, title, award: award || null });
  });
  return items;
}

interface DetailInfo {
  team: string | null;
  org: string | null;
  summary: string | null;
}

async function fetchDetail(idx: string): Promise<DetailInfo> {
  const url = `${DETAIL_URL}?menuPos=1&tabPos=1&idx=${idx}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`student-invention: HTTP ${res.status} on edit.do idx=${idx}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const labelValue = (labelText: string): string | null => {
    let value: string | null = null;
    $(".tit").each((_, el) => {
      if ($(el).text().trim() !== labelText) return;
      const clone = $(el).parent().clone();
      clone.find(".tit").remove();
      const v = clone.text().trim();
      if (v) value = v;
    });
    return value;
  };

  const team = labelValue("수상자");
  const org = labelValue("학교");

  const textBlocks: string[] = [];
  $(".text_list .box").each((_, box) => {
    const label = $(box).find(".title").first().text().trim();
    const text = $(box).find(".text").first().text().trim();
    if (text && (label === "발명동기" || label === "발명내용" || label === "용도 및 효과")) {
      textBlocks.push(text);
    }
  });

  return { team, org, summary: textBlocks.length ? textBlocks.join("\n\n") : null };
}

const DETAIL_CONCURRENCY = 5;

/** 연도×부문마다 게시물이 수백 건이라, 항목당 상세 조회(edit.do)를 완전 순차로 돌리면
 * 월간 GitHub Actions 잡의 시간 제한을 넘길 수 있다 — 가벼운 동시성으로 처리한다. */
async function fetchDetailsConcurrently(listItems: ListItem[]): Promise<Map<string, DetailInfo>> {
  const result = new Map<string, DetailInfo>();
  for (let i = 0; i < listItems.length; i += DETAIL_CONCURRENCY) {
    const batch = listItems.slice(i, i + DETAIL_CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (li) => {
        try {
          return [li.idx, await fetchDetail(li.idx)] as const;
        } catch (e) {
          console.error(`  [student-invention] idx=${li.idx} 상세 조회 실패:`, e instanceof Error ? e.message : e);
          return [li.idx, { team: null, org: null, summary: null } as DetailInfo] as const;
        }
      }),
    );
    for (const [idx, detail] of settled) result.set(idx, detail);
  }
  return result;
}

export const meta = STUDENT_INVENTION_META;

export async function collect(): Promise<Idea[]> {
  const items = new Map<string, Idea>();

  for (const year of YEARS) {
    for (const tier of TIERS) {
      let page = 1;
      let tierCount = 0;
      while (page <= MAX_PAGES_PER_TIER) {
        let listItems: ListItem[];
        try {
          listItems = await fetchList(tier.tabPos2, year, page);
        } catch (e) {
          console.error(`  [student-invention] ${year}/${tier.category} p${page} 요청 실패:`, e instanceof Error ? e.message : e);
          break;
        }
        if (listItems.length === 0) break;

        const details = await fetchDetailsConcurrently(listItems);
        for (const li of listItems) {
          const detail = details.get(li.idx) ?? { team: null, org: null, summary: null };
          const idea: Idea = {
            id: makeId(["student-invention", year, tier.category, li.title, detail.team]),
            competition: "student-invention",
            competitionName: "대한민국학생발명전시회",
            year,
            round: null,
            award: li.award,
            category: tier.category,
            title: li.title,
            team: detail.team,
            org: detail.org,
            summary: detail.summary,
            sourceUrl: `${DETAIL_URL}?menuPos=1&tabPos=1&idx=${li.idx}`,
          };
          items.set(idea.id, idea);
          tierCount++;
        }

        page += 1;
        await new Promise((r) => setTimeout(r, 300));
      }
      if (tierCount > 0) console.log(`  [student-invention] ${year}년 ${tier.category}: ${tierCount}건`);
    }
  }

  return [...items.values()];
}

const collector: Collector = { meta, collect };
export default collector;
