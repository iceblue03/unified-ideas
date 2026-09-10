import * as cheerio from "cheerio";
import type { Collector, Idea } from "../../lib/types";
import { makeId } from "../../lib/id";
import { ESW_CONTEST_META } from "../../lib/collector-meta";

const BASE = "https://www.eswcontest.or.kr/data/award.php";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

async function fetchPage(page: number): Promise<string> {
  const url = `${BASE}?page=${page}&code=award`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`esw-contest: HTTP ${res.status} on page ${page}`);
  return res.text();
}

function parsePage(html: string): Idea[] {
  const $ = cheerio.load(html);
  const items: Idea[] = [];

  $("table.bbs_con tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 6) return;

    const yearText = $(cells[1]).text().trim(); // "2025년"
    const category = $(cells[2]).text().trim() || null;
    const award = $(cells[3]).text().trim() || null;
    const link = $(cells[5]).find("a");
    const rawTitle = link.text().trim();
    const href = link.attr("href") || null;

    if (!rawTitle) return;

    // format is usually "프로젝트명(소속)"
    const m = rawTitle.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    const title = m ? m[1].trim() : rawTitle;
    const org = m ? m[2].trim() : null;

    const year = yearText ? parseInt(yearText.replace(/[^0-9]/g, ""), 10) : null;

    items.push({
      id: makeId(["esw-contest", year, title, org]),
      competition: "esw-contest",
      competitionName: "임베디드 소프트웨어 경진대회",
      year: Number.isFinite(year) ? year : null,
      round: null,
      award,
      category,
      title,
      team: null,
      org,
      summary: null,
      sourceUrl: href ? new URL(href, "https://www.eswcontest.or.kr").toString() : null,
    });
  });

  return items;
}

export const meta = ESW_CONTEST_META;

export async function collect(): Promise<Idea[]> {
  const seen = new Map<string, Idea>();
  let page = 1;
  const MAX_PAGES = 60; // safety cap (site currently has ~25 pages)

  while (page <= MAX_PAGES) {
    const html = await fetchPage(page);
    const items = parsePage(html);
    if (items.length === 0) break;

    // 범위를 벗어난 page 번호를 요청하면 사이트가 빈 결과 대신 1페이지 내용을
    // 다시 돌려주는 것으로 관측됨 -> "새 항목이 하나도 없으면" 종료 조건으로 판단.
    const before = seen.size;
    for (const item of items) seen.set(item.id, item);
    if (seen.size === before) break;

    page += 1;
    // be polite
    await new Promise((r) => setTimeout(r, 300));
  }

  return [...seen.values()];
}

const collector: Collector = { meta, collect };
export default collector;
