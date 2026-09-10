import ExcelJS from "exceljs";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import type { Collector, Idea } from "../../lib/types";
import { makeId } from "../../lib/id";
import { downloadLatestSeoulFile } from "../../lib/seoul-open-data";
import { PUBLIC_DATA_STARTUP_META } from "../../lib/collector-meta";

// 서울 열린데이터광장에 행정안전부가 올려둔 대회 결과 원본 파일.
// 최종(본선) 수상작과 예선기관(지역) 수상작을 함께 모은다.
const DATASETS = [
  { id: "OA-22583", note: "본선(왕중왕전 포함) 수상작" },
  { id: "OA-22582", note: "예선기관 수상작" },
] as const;

const COMPETITION = "public-data-startup";
const COMPETITION_NAME = "범정부 공공데이터 활용 창업경진대회";

function findCol(headers: string[], keywords: string[]): number {
  for (const kw of keywords) {
    const idx = headers.findIndex((h) => h && h.includes(kw));
    if (idx !== -1) return idx;
  }
  return -1;
}

function cellText(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && "richText" in (v as object)) {
    return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  }
  if (typeof v === "object" && "text" in (v as object)) {
    return String((v as { text: unknown }).text);
  }
  const s = String(v).trim();
  return s.length ? s : null;
}

async function parseWorkbook(filePath: string, note: string): Promise<Idea[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.worksheets[0];

  const headerRow = sheet.getRow(1).values as ExcelJS.CellValue[];
  const headers = headerRow.map((v) => cellText(v) ?? "");

  const col = {
    year: findCol(headers, ["수상연도", "연도"]),
    round: findCol(headers, ["회차"]),
    award: findCol(headers, ["수상내역", "수상", "훈격"]),
    team: findCol(headers, ["참가팀", "팀명", "업체명"]),
    title: findCol(headers, ["아이템", "서비스명", "작품명", "제목"]),
    summary: findCol(headers, ["서비스 내용", "내용", "설명"]),
    dataUsed: findCol(headers, ["활용 공공데이터", "공공데이터"]),
    org: findCol(headers, ["주최기관"]),
    category: findCol(headers, ["비고", "부문", "구분"]),
  };

  const items: Idea[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const values = row.values as ExcelJS.CellValue[];
    const get = (i: number) => (i >= 0 ? cellText(values[i]) : null);

    const title = get(col.title);
    if (!title) return;

    const yearRaw = get(col.year);
    const year = yearRaw ? parseInt(yearRaw.replace(/[^0-9]/g, ""), 10) : null;

    const dataUsed = get(col.dataUsed);
    const summaryParts = [get(col.summary), dataUsed ? `활용 데이터: ${dataUsed}` : null].filter(
      Boolean,
    );

    items.push({
      id: makeId([COMPETITION, year, title, get(col.team)]),
      competition: COMPETITION,
      competitionName: COMPETITION_NAME,
      year: Number.isFinite(year) ? year : null,
      round: get(col.round),
      award: get(col.award),
      category: [get(col.category), note].filter(Boolean).join(" / ") || null,
      title,
      team: get(col.team),
      org: get(col.org),
      summary: summaryParts.length ? summaryParts.join("\n") : null,
      sourceUrl: "https://data.go.kr/tcs/eds/ctm/selectContestDataList.do",
    });
  });

  return items;
}

export const meta = PUBLIC_DATA_STARTUP_META;

export async function collect(): Promise<Idea[]> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "seoul-open-data-"));
  const all: Idea[] = [];

  try {
    for (const ds of DATASETS) {
      const { filePath, title } = await downloadLatestSeoulFile(ds.id, tmpDir);
      const items = await parseWorkbook(filePath, ds.note);
      console.log(`  [public-data-startup] ${ds.id} (${title}): ${items.length} rows`);
      all.push(...items);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  // 본선/예선 파일에 같은 팀이 중복 등장할 수 있어 id 기준으로 제거
  const dedup = new Map<string, Idea>();
  for (const item of all) dedup.set(item.id, item);
  return [...dedup.values()];
}

const collector: Collector = { meta, collect };
export default collector;
