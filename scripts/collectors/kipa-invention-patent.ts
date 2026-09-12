import * as cheerio from "cheerio";
import type { Collector, Idea } from "../../lib/types";
import { makeId } from "../../lib/id";
import { KIPA_INVENTION_PATENT_META } from "../../lib/collector-meta";

const BASE = "https://www.kipa.org/kinpex";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

const AWARD_KEYWORD = /대통령상|국무총리상|장관상|금상|은상|동상|대상|최우수상|우수상|장려상/;

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`kipa-invention-patent: HTTP ${res.status} on ${url}`);
  return res.text();
}

async function discoverYears(): Promise<number[]> {
  try {
    const html = await fetchHtml(`${BASE}/prize_history_2025.jsp`);
    const $ = cheerio.load(html);
    const years = $("select#budget option")
      .map((_, o) => {
        const m = ($(o).attr("value") || "").match(/prize_history_(\d{4})\.jsp/);
        return m ? parseInt(m[1], 10) : null;
      })
      .get()
      .filter((y): y is number => y !== null);
    if (years.length > 0) return years.sort((a, b) => b - a);
  } catch {
    // fall through to static range below
  }
  const currentYear = 2026; // static fallback if the <select> can't be read
  const years: number[] = [];
  for (let y = currentYear; y >= 2006; y--) years.push(y);
  return years;
}

/**
 * table.prize_table의 헤더는 연도마다 컬럼 순서/의미가 다르고(예: 2022년은 순번/수상자(성명·소속·직위)/
 * 권리자/명칭/출원번호/등록번호/분야/상격/비고, 2010년은 구분/상명/상격/수상자(성명·소속·직위)/명칭/
 * 권리(출원·등록)/분야), rowspan·colspan이 섞인 2행 헤더라서 고정 인덱스로는 못 읽는다. 표준 HTML 테이블
 * 헤더 평탄화 알고리즘으로 각 컬럼의 실제 라벨을 계산해 라벨 텍스트 기준으로 값을 찾는다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenHeaderLabels($: cheerio.CheerioAPI, headerRows: any[]): string[] {
  const grid: string[][] = [];
  for (let rowIdx = 0; rowIdx < headerRows.length; rowIdx++) {
    if (!grid[rowIdx]) grid[rowIdx] = [];
    const cells = $(headerRows[rowIdx])
      .find("td,th")
      .toArray();
    let colIdx = 0;
    let cellPos = 0;
    while (cellPos < cells.length) {
      while (grid[rowIdx][colIdx] !== undefined) colIdx++;
      const cell = cells[cellPos];
      const text = $(cell).text().replace(/\s+/g, "").trim();
      const colspan = parseInt($(cell).attr("colspan") || "1", 10) || 1;
      const rowspan = parseInt($(cell).attr("rowspan") || "1", 10) || 1;
      for (let c = 0; c < colspan; c++) {
        for (let r = 0; r < rowspan; r++) {
          const targetRow = rowIdx + r;
          if (!grid[targetRow]) grid[targetRow] = [];
          const existing = grid[targetRow][colIdx + c];
          grid[targetRow][colIdx + c] = existing ? existing : text;
        }
      }
      colIdx += colspan;
      cellPos++;
    }
  }
  const lastRow = grid[grid.length - 1] || [];
  const firstRow = grid[0] || [];
  const numCols = Math.max(lastRow.length, firstRow.length);
  const labels: string[] = [];
  for (let c = 0; c < numCols; c++) labels[c] = lastRow[c] || firstRow[c] || "";
  return labels;
}

function findCols(labels: string[], keyword: string): number[] {
  return labels.reduce<number[]>((acc, l, i) => {
    if (l.includes(keyword)) acc.push(i);
    return acc;
  }, []);
}

function parseYearPage(html: string, year: number, url: string): Idea[] {
  const $ = cheerio.load(html);
  const table = $("table.prize_table").first();
  if (table.length === 0) return [];

  const allRows = table.find("tr").toArray();
  // 데이터 행은 첫 셀이 순번(숫자)인 행으로 판별하고, 그 전까지는 전부 헤더 행으로 취급한다.
  let headerRowCount = 0;
  for (const tr of allRows) {
    const firstCellText = $(tr).find("td,th").first().text().trim();
    if (/^\d+$/.test(firstCellText)) break;
    headerRowCount++;
  }
  if (headerRowCount === 0 || headerRowCount >= allRows.length) return [];

  const labels = flattenHeaderLabels($, allRows.slice(0, headerRowCount));
  const titleCols = findCols(labels, "발명");
  const orgCols = findCols(labels, "소속");
  const categoryCols = findCols(labels, "분야");
  const nameCols = findCols(labels, "성명").concat(findCols(labels, "성 명"));
  const awardLabelCols = labels.reduce<number[]>((acc, l, i) => {
    if (l.includes("상명") || l.includes("상격") || l.includes("비고")) acc.push(i);
    return acc;
  }, []);

  const items: Idea[] = [];
  for (const tr of allRows.slice(headerRowCount)) {
    const cells = $(tr)
      .find("td,th")
      .map((_, td) => $(td).text().trim())
      .get();
    if (cells.length === 0 || !/^\d+$/.test(cells[0])) continue;

    let title =
      titleCols.length > 0
        ? (cells[titleCols[0]] ?? "")
        : cells.reduce((longest, c) => (c.length > longest.length && !/^[\d-]+$/.test(c) ? c : longest), "");
    title = title.trim();
    if (!title || title === "-") continue;

    const org = orgCols.length > 0 ? (cells[orgCols[0]] || null) : null;
    const category = categoryCols.length > 0 ? (cells[categoryCols[0]] || null) : null;
    const name = nameCols.length > 0 ? (cells[nameCols[0]] || null) : null;

    const awardParts = new Set<string>();
    for (const c of awardLabelCols) {
      const v = (cells[c] || "").trim();
      if (v && v !== "-") awardParts.add(v);
    }
    for (const c of cells) {
      if (AWARD_KEYWORD.test(c)) awardParts.add(c.trim());
    }
    const award = awardParts.size > 0 ? [...awardParts].join(" · ") : null;

    items.push({
      id: makeId(["kipa-invention-patent", year, title, org]),
      competition: "kipa-invention-patent",
      competitionName: "대한민국발명특허대전",
      year,
      round: null,
      award,
      category,
      title,
      team: org ? null : (name && name !== "-" ? name : null),
      org: org && org !== "-" ? org : null,
      summary: null,
      sourceUrl: url,
    });
  }

  return items;
}

export const meta = KIPA_INVENTION_PATENT_META;

export async function collect(): Promise<Idea[]> {
  const years = await discoverYears();
  const seen = new Map<string, Idea>();

  for (const year of years) {
    const url = `${BASE}/prize_history_${year}.jsp`;
    try {
      const html = await fetchHtml(url);
      const items = parseYearPage(html, year, url);
      for (const item of items) seen.set(item.id, item);
      console.log(`  [kipa-invention-patent] ${year}: ${items.length} rows`);
    } catch (e) {
      console.error(`  [kipa-invention-patent] ${year} 수집 실패:`, e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  return [...seen.values()];
}

const collector: Collector = { meta, collect };
export default collector;
