import * as cheerio from "cheerio";
import type { Collector, Idea } from "../../lib/types";
import { makeId } from "../../lib/id";
import { YOUTH_STARTUP_META } from "../../lib/collector-meta";

const LIST_URL = "https://yeep.go.kr/cpthb/contestCaseList.do";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// YEEP은 청소년 비즈쿨 등 여러 대회의 우수사례를 한 게시판에서 공유한다.
// 우리가 원하는 것은 "대한민국 청소년 창업경진대회"뿐이라 이름으로 필터링한다.
const TARGET_CONTEST_NAME = "대한민국 청소년 창업경진대회";

async function fetchPage(page: number): Promise<string> {
  const body = new URLSearchParams({
    cpthbNo: "",
    exclnCaseNo: "",
    searchGroup: "",
    searchText: "",
    yearBySelect: "",
    sortBySelect: "",
    currentPage: String(page),
  });

  const res = await fetch(LIST_URL, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`youth-startup: HTTP ${res.status} on page ${page}`);
  return res.text();
}

interface PageResult {
  items: Idea[];
  /** 대회 필터와 무관하게, 이 페이지에 실제로 표시된 카드들의 식별 텍스트(중복/반복 페이지 감지용) */
  rawKeys: string[];
}

function parsePage(html: string): PageResult {
  const $ = cheerio.load(html);
  const items: Idea[] = [];
  const rawKeys: string[] = [];

  $("ul.thumb-list > li").each((_, li) => {
    const el = $(li);
    const fullTitle = el.find(".list-tit a").first().text().trim();
    if (!fullTitle) return;
    rawKeys.push(fullTitle);

    const award = el.find(".list-tit em").first().text().trim() || null;

    const fields: { contestName: string | null; team: string | null; summary: string | null } = {
      contestName: null,
      team: null,
      summary: null,
    };

    el.find("ul > li").each((__, row) => {
      const label = $(row).find("strong").first().text().trim();
      const span = $(row).find("span").first();
      if (label === "대회명") fields.contestName = span.text().trim() || null;
      else if (label === "동아리명")
        fields.team = $(row).clone().find("strong").remove().end().text().trim();
      else if (label === "아이템 개요")
        fields.summary = $(row).clone().find("strong").remove().end().text().trim();
    });

    const contestName = fields.contestName;
    const team = fields.team;
    const summary = fields.summary;

    if (!contestName || !contestName.includes(TARGET_CONTEST_NAME)) return;

    const yearMatch = contestName.match(/(20\d{2})/) || fullTitle.match(/(20\d{2})/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

    // fullTitle 형식: "YYYY 대회명(학교명)" -> 괄호 안이 학교명
    const orgMatch = fullTitle.match(/\(([^()]+)\)\s*$/);
    const org = orgMatch ? orgMatch[1].trim() : null;

    items.push({
      id: makeId(["youth-startup", year, team, summary]),
      competition: "youth-startup",
      competitionName: "대한민국 청소년 창업경진대회",
      year,
      round: null,
      award,
      category: null,
      title: summary || fullTitle,
      team,
      org,
      summary,
      sourceUrl: LIST_URL,
    });
  });

  return { items, rawKeys };
}

export const meta = YOUTH_STARTUP_META;

export async function collect(): Promise<Idea[]> {
  const seenItems = new Map<string, Idea>();
  const seenRawKeys = new Set<string>();
  let page = 1;
  const MAX_PAGES = 200; // safety cap

  while (page <= MAX_PAGES) {
    const html = await fetchPage(page);
    const { items, rawKeys } = parsePage(html);
    if (rawKeys.length === 0) break;

    // 범위를 벗어난 page 번호에 대해 사이트가 마지막 페이지 내용을 반복해서
    // 돌려줄 수 있어(esw-contest에서 확인된 동일 패턴), 종료 판단은 "대상 대회
    // 필터를 통과한 개수"가 아니라 "페이지에 실제로 나온 카드 전체"를 기준으로
    // 해야 한다 (한 페이지가 통째로 다른 대회 카드뿐이어도 다음 페이지엔 대상
    // 대회 카드가 또 나올 수 있기 때문).
    const rawBefore = seenRawKeys.size;
    for (const k of rawKeys) seenRawKeys.add(k);
    if (seenRawKeys.size === rawBefore) break;

    for (const item of items) seenItems.set(item.id, item);
    page += 1;
    await new Promise((r) => setTimeout(r, 300));
  }

  return [...seenItems.values()];
}

const collector: Collector = { meta, collect };
export default collector;
