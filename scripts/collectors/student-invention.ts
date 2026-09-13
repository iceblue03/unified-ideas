import * as cheerio from "cheerio";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import type { Collector, Idea } from "../../lib/types";
import { makeId } from "../../lib/id";
import { STUDENT_INVENTION_META } from "../../lib/collector-meta";
import { PdfRenderer } from "../../lib/pdf-render";
import { ocrImage, terminateOcr } from "../../lib/ocr";

const LIST_URL = "https://www.ip-edu.net/home/kor/education/material/work/index.do?menuPos=84";
const DOWNLOAD_URL = "https://www.ip-edu.net/fileDownload.do";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

interface BookletRef {
  filename: string;
  downname: string;
  year: number | null;
}

/** "발명창의력대회 수상작품집" 슬라이드에서 학생발명전시회 항목 중 가장 최신 연도를 찾는다. */
async function findLatestBooklet(): Promise<BookletRef | null> {
  const res = await fetch(LIST_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`student-invention: HTTP ${res.status} on ${LIST_URL}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  let best: BookletRef | null = null;
  $("a[onclick*='cmmn_file_down']").each((_, a) => {
    const onclick = $(a).attr("onclick") || "";
    const m = onclick.match(/cmmn_file_down\('([^']+)'\s*,\s*'([^']+)'\)/);
    if (!m) return;
    const [, filename, downname] = m;
    if (!filename.includes("학생발명전시회") || !filename.includes("수상")) return;
    // 연도는 파일명이 아니라 같은 <a> 안의 캡션(.img_tit3, 예: "...수상작품집(2026년)")에 있다.
    const caption = $(a).find(".img_tit3").text();
    const yearMatch = caption.match(/(20\d{2})년/) || filename.match(/(20\d{2})년/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
    if (!best || (year ?? 0) > (best.year ?? 0)) best = { filename, downname, year };
  });
  return best;
}

async function downloadBooklet(ref: BookletRef, destPath: string): Promise<void> {
  const res = await fetch(DOWNLOAD_URL, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ filename: ref.filename, downname: ref.downname }),
  });
  if (!res.ok) throw new Error(`student-invention: PDF 다운로드 실패 HTTP ${res.status}`);
  await fs.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
}

interface TableRow {
  page: number;
  name: string | null;
  school: string | null;
  grade: string | null;
  region: string | null;
  title: string;
}

/** 출품명(title)으로 보기엔 너무 짧거나 텍스트가 아닌(숫자/기호뿐인) 조각인지 판별 */
function looksLikeJunkTitle(s: string): boolean {
  const letters = s.replace(/[^가-힣A-Za-z]/g, "");
  return letters.length < 4;
}

/**
 * "수상작 목록" 표는 OCR 시 컬럼 사이 여러 칸 공백이 대체로 보존된다(확인함).
 * 구분자(_, 、, | 등 OCR이 표 경계선을 문자로 잘못 읽은 것들)를 공백으로 정리한
 * 뒤 2칸 이상 공백 기준으로 쪼갠다.
 *
 * 컬럼이 5개 미만으로 뭉개졌다는 건 그 줄의 OCR 자체가 신뢰하기 어렵다는 뜻이라
 * (실제로 name과 title에 같은 깨진 문자열이 중복으로 들어가는 사고를 겪음), 어설프게
 * 다 채우려 하지 않고 이름/학교/학년 정도만 최선을 다해 살리고 title이 애매하면
 * (name과 같은 값이거나 숫자/기호뿐이면) 그 행 자체를 버린다 — 이 프로젝트 전반에서
 * 지켜온 "불확실하면 틀린 값보다 없는 값" 원칙.
 */
function parseTableLine(line: string): TableRow | null {
  const normalized = line.replace(/[_、|]/g, " ").trim();
  const m = normalized.match(/^(\d{1,3})\s+(.*)$/);
  if (!m) return null;
  const page = parseInt(m[1], 10);
  const rest = m[2];

  const parts = rest.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  if (parts.length >= 5) {
    const [name, school, grade, region, ...titleParts] = parts;
    const title = titleParts.join(" ");
    if (looksLikeJunkTitle(title)) return null;
    return { page, name, school, grade, region, title };
  }

  // 컬럼이 5개 미만이면 어느 조각이 이름이고 어느 조각이 제목인지 확신할 수 없다.
  // 마지막 조각을 title 후보로만 보되, name과 같은 값이거나 title답지 않으면 버린다.
  const titleCandidate = parts[parts.length - 1];
  if (parts.length < 2 || looksLikeJunkTitle(titleCandidate) || titleCandidate === parts[0]) return null;
  return {
    page,
    name: parts[0] ?? null,
    school: parts.length >= 3 ? (parts[1] ?? null) : null,
    grade: parts.find((p) => /\d학년|^-$/.test(p)) ?? null,
    region: null,
    title: titleCandidate,
  };
}

const AWARD_TIERS = ["대통령상", "국무총리상", "금상", "은상", "동상", "특별상", "장려상"];

function extractAward(raw: string): string | null {
  const ministryMatch = raw.match(/[가-힣]{2,10}(?:부|처|청|원|공단|협회)장?[관장]상/);
  if (ministryMatch) return ministryMatch[0];
  for (const tier of AWARD_TIERS) {
    if (raw.includes(tier)) return tier;
  }
  return null;
}

function extractDetailBody(raw: string): string | null {
  const anchors = ["발명동기", "발명내용", "용도 및 효과", "용도및효과"];
  const positions = anchors.map((a) => raw.indexOf(a)).filter((i) => i >= 0);
  if (positions.length === 0) return null;
  const text = raw.slice(Math.min(...positions)).trim();
  return text.length > 15 ? text : null;
}

export const meta = STUDENT_INVENTION_META;

export async function collect(): Promise<Idea[]> {
  const ref = await findLatestBooklet();
  if (!ref) {
    console.warn("[student-invention] 수상작품집 PDF를 찾지 못함 — 이번 실행은 건너뜀");
    return [];
  }
  console.log(`[student-invention] PDF 발견: ${ref.filename} (${ref.year ?? "연도 미상"})`);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "student-invention-"));
  const pdfPath = path.join(tmpDir, "booklet.pdf");
  const items: Idea[] = [];

  try {
    await downloadBooklet(ref, pdfPath);

    const renderer = new PdfRenderer(pdfPath);
    const numPages = await renderer.open();
    console.log(`[student-invention] PDF 페이지 수: ${numPages}`);

    const tableRows = new Map<number, TableRow>();
    const details = new Map<number, { award: string | null; body: string | null }>();

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const buf = await renderer.renderPage(pageNum, 2.2);
      const raw = (await ocrImage(buf)) ?? "";

      // 표 헤더("페이지 이름 학교 학년 지역 출품명")는 파란 배경 위 글자라 OCR로 거의 안
      // 읽히지만(확인함), "수상작 목록"이라는 상단 타이틀 문구는 표 페이지마다 안정적으로
      // 읽힌다 — 이걸로 표 페이지만 골라 parseTableLine을 적용한다. 처음엔 페이지 종류를
      // 구분하지 않고 모든 페이지의 모든 줄에 시도했는데, 그러면 개별 작품 상세 페이지의
      // 본문 문단 안에 있는 숫자(예: 인용된 수치)가 "페이지번호"로 오인되어 그 문단 일부가
      // 엉뚱한 페이지 번호의 표 항목(title/name)으로 뒤섞여 들어가는 사고가 실제로 발생했다.
      const isDetailPage = raw.includes("발명동기") || raw.includes("발명내용");
      // "수상작품집"이라는 책 제목이 매 페이지 상단에 러닝헤더로 반복될 수 있어(미확인) "수상작"
      // 포함 여부만으로는 부족하다 — 상세 페이지 마커가 없는 경우에만 표 페이지로 취급한다.
      if (raw.includes("수상작") && !isDetailPage) {
        for (const line of raw.split("\n")) {
          const row = parseTableLine(line);
          if (row && row.title) tableRows.set(row.page, row);
        }
      }
      if (isDetailPage) {
        details.set(pageNum, { award: extractAward(raw), body: extractDetailBody(raw) });
      }

      if (pageNum % 20 === 0) {
        console.log(`[student-invention] ${pageNum}/${numPages} 페이지 처리, 표 ${tableRows.size}행, 상세 ${details.size}건`);
      }
    }

    await renderer.close();

    for (const [page, row] of tableRows) {
      const detail = details.get(page);
      items.push({
        id: makeId(["student-invention", ref.year, page, row.name, row.title]),
        competition: "student-invention",
        competitionName: "대한민국학생발명전시회",
        year: ref.year,
        round: null,
        award: detail?.award ?? null,
        category: [row.grade, row.region].filter(Boolean).join(" / ") || null,
        title: row.title,
        team: row.name,
        org: row.school,
        summary: detail?.body ?? null,
        sourceUrl: LIST_URL,
        attachments: [{ url: LIST_URL, kind: "file", label: `${ref.filename} (원본 PDF, 사이트에서 다운로드)` }],
      });
    }
  } finally {
    await terminateOcr();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  return items;
}

const collector: Collector = { meta, collect };
export default collector;
