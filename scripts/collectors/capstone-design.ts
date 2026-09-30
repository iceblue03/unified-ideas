import * as cheerio from "cheerio";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import type { Collector, Idea } from "../../lib/types";
import { makeId } from "../../lib/id";
import { CAPSTONE_DESIGN_META } from "../../lib/collector-meta";
import { PdfRenderer } from "../../lib/pdf-render";
import { ocrImage, terminateOcr } from "../../lib/ocr";

// e2festa.kr는 SSL 인증서가 다른 도메인(storycosmos.com) 것으로 잘못 설정되어
// 있어(확인함) https로 접속하면 인증서 오류가 난다 — http로만 접속 가능하다.
const SITE = "http://e2festa.kr";
const AUTO_FILE = path.join(__dirname, "..", "..", "data", "auto", "capstone-design.json");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

async function loadCachedItemsForPdf(pdfUrl: string): Promise<Idea[] | null> {
  try {
    const raw = await fs.readFile(AUTO_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { items?: Idea[] };
    const subset = (parsed.items ?? []).filter((i) => i.sourceUrl === pdfUrl);
    if (subset.length > 0) return subset;
  } catch {
    /* no cache */
  }
  return null;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`capstone-design: HTTP ${res.status} on ${url}`);
  return res.text();
}

function sanitizeSchool(school: string | null): string | null {
  if (!school) return null;
  const s = school.trim();
  if (/급\s+대|대\(&\)|&\)/.test(s)) return null;
  if (s.length > 30 && /[&]{1,}/.test(s)) return null;
  if (!/대학교|대학|고등학교|학교|초등학교|전문대/.test(s)) return null;
  return s;
}

function sanitizeTeamName(team: string | null): string | null {
  if (!team) return null;
  const t = team.trim();
  if (looksLikeNoise(t)) return null;
  if (t.length > 50) return null;
  if (/[&]{2,}|급\s+대/.test(t)) return null;
  return t;
}

async function pdfFromNoticeUrl(noticeUrl: string): Promise<string | null> {
  const noticeHtml = await fetchHtml(noticeUrl);
  const $$ = cheerio.load(noticeHtml);
  let pdfUrl: string | null = null;
  $$("a").each((_, a) => {
    const href = $$(a).attr("href") || "";
    if (href.toLowerCase().endsWith(".pdf")) {
      pdfUrl = new URL(href, SITE).toString();
      return false;
    }
  });
  return pdfUrl;
}

/** 홈·구 사이트·공지 목록에서 디렉토리북 PDF URL을 모은다. */
async function findDirectoryBookUrls(): Promise<{ url: string; year: number | null }[]> {
  const found = new Map<string, number | null>();
  const entryPages = [`${SITE}/`, "http://e2festa.kr/main/main.php"];

  for (const entry of entryPages) {
    const html = await fetchHtml(entry);
    const $ = cheerio.load(html);
    const noticeHrefs: string[] = [];
    $("a").each((_, a) => {
      const text = $(a).text();
      if (text.includes("디렉토리북")) {
        const href = $(a).attr("href");
        if (href) noticeHrefs.push(new URL(href, entry).toString());
      }
      const href = $(a).attr("href") || "";
      if (href.toLowerCase().endsWith(".pdf") && text.includes("디렉토리")) {
        const pdf = new URL(href, entry).toString();
        const ym = pdf.match(/(20\d{2})/);
        found.set(pdf, ym ? parseInt(ym[1], 10) : null);
      }
    });
    for (const noticeUrl of noticeHrefs) {
      const pdf = await pdfFromNoticeUrl(noticeUrl);
      if (pdf) {
        const ym = pdf.match(/(20\d{2})/);
        found.set(pdf, ym ? parseInt(ym[1], 10) : null);
      }
    }
  }

  for (let page = 1; page <= 8; page++) {
    const listHtml = await fetchHtml(`${SITE}/05/01.php?mode=list_ok&page=${page}`);
    const $ = cheerio.load(listHtml);
    const noticeHrefs: string[] = [];
    $("a").each((_, a) => {
      const text = $(a).text();
      if (!text.includes("디렉토리북")) return;
      const onclick = $(a).attr("onclick") || "";
      const uid = onclick.match(/view\(\s*'(\d+)'/)?.[1];
      if (uid) noticeHrefs.push(`${SITE}/05/01.php?mode=view&uid=${uid}`);
    });
    for (const noticeUrl of noticeHrefs) {
      const pdf = await pdfFromNoticeUrl(noticeUrl);
      if (pdf) {
        const ym = pdf.match(/(20\d{2})/);
        found.set(pdf, ym ? parseInt(ym[1], 10) : null);
      }
    }
  }

  return [...found.entries()].map(([url, year]) => ({ url, year }));
}

interface PageFields {
  title: string | null;
  hashtags: string | null;
  body: string | null;
  team: string | null;
  members: string[];
  school: string | null;
}

/**
 * 좌(본문)/우(학교·팀 정보) 2단 레이아웃을 통째로 OCR하면 두 컬럼의 줄이
 * y좌표 기준으로 뒤섞여 나온다(직접 확인함) — 그래서 컬럼을 나눠 각각 OCR한다.
 */
function parseLeftColumn(raw: string): { title: string | null; hashtags: string | null; body: string | null } {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const hashtagIdx = lines.findIndex((l) => /[#*][가-힣A-Za-z0-9]/.test(l) && l.length < 80);
  // 해시태그 줄 바로 위 줄들 중 마지막 1~2줄을 제목 후보로 본다.
  // 영문 부제(있다면)가 OCR 정확도가 더 높아 우선 사용한다.
  let title: string | null = null;
  if (hashtagIdx > 0) {
    const candidates = lines.slice(Math.max(0, hashtagIdx - 2), hashtagIdx);
    const englishLine = candidates.find((l) => /^[A-Za-z][A-Za-z0-9 ,'\-:()]{9,}$/.test(l));
    title = englishLine ?? candidates[candidates.length - 1] ?? null;
  }

  const hashtags = hashtagIdx >= 0 ? lines[hashtagIdx] : null;
  const bodyLines = hashtagIdx >= 0 ? lines.slice(hashtagIdx + 1) : lines;
  const body = bodyLines.filter((l) => l.length >= 8).join("\n") || null;

  return { title, hashtags, body };
}

/** 팀 사진 등 이미지 영역에서 새어든 한두 글자짜리 OCR 노이즈 줄인지 판별 */
function looksLikeNoise(line: string): boolean {
  const cleaned = line.replace(/^[^가-힣A-Za-z0-9]+/, "").trim();
  return cleaned.length < 2;
}

function parseRightColumn(raw: string): { team: string | null; members: string[]; school: string | null } {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const teamIdx = lines.findIndex((l) => l.includes("팀명"));
  let team: string | null = null;
  if (teamIdx >= 0) {
    // "팀명"과 같은 줄에 팀명이 붙어 나올 때와, 사진 영역 노이즈 한두 줄을 사이에 두고
    // 다음 줄(들)에 나올 때를 모두 고려한다 — "팀명" 바로 다음 줄을 무조건 믿지 않는다.
    const sameLine = lines[teamIdx].replace(/.*팀명/, "").trim();
    if (!looksLikeNoise(sameLine)) {
      team = sameLine;
    } else {
      for (let i = teamIdx + 1; i < Math.min(lines.length, teamIdx + 4); i++) {
        const candidate = lines[i];
        if (candidate.includes("팀원")) break;
        if (!looksLikeNoise(candidate)) {
          team = candidate.replace(/^[^가-힣A-Za-z0-9]+/, "").trim();
          break;
        }
      }
    }
  }

  // 팀원 줄 앞에 사진 영역 노이즈 한 글자가 붙어 나오는 경우가 있어(예: "는  이강휘 (...)")
  // 줄 전체가 그 패턴과 정확히 일치하길 요구하지 않고, 줄 안에서 "이름(학과)" 부분만 추출한다.
  const members: string[] = [];
  for (const l of lines) {
    const m = l.match(/([가-힣]{2,4}\s*\([^)]{2,20}\))/);
    if (m) members.push(m[1].replace(/\s+/g, " ").trim());
  }

  // 학교명은 "팀명" 라벨보다 위쪽에 나온다. 그 아래(특히 맨 아래 푸터)까지 검색 범위를
  // 넓히면 페이지 하단의 "OO대학교 컨소시엄"(주관 대학, 이 팀의 소속 학교가 아님) 같은
  // 문구를 잘못 학교명으로 집어올 수 있어 검색 범위를 팀명 라벨 이전으로 제한한다.
  const beforeTeam = (teamIdx >= 0 ? lines.slice(0, teamIdx) : lines).join(" ");
  const schoolMatch = beforeTeam.match(/[가-힣]{2,10}대학교(?:\([^)]{1,10}\))?/);
  const school = schoolMatch ? schoolMatch[0] : null;

  return { team, members, school };
}

async function ocrPageColumns(renderer: PdfRenderer, pageNum: number): Promise<PageFields> {
  const { width, height } = await renderer.renderPageWithSize(pageNum, 2.0);
  const splitX = width * 0.56;
  const [leftBuf, rightBuf] = await Promise.all([
    renderer.cropLast(0, 0, splitX, height),
    renderer.cropLast(splitX, 0, width - splitX, height),
  ]);
  const [leftText, rightText] = await Promise.all([ocrImage(leftBuf), ocrImage(rightBuf)]);

  const left = parseLeftColumn(leftText ?? "");
  const right = parseRightColumn(rightText ?? "");
  return { ...left, ...right };
}

async function ocrPdfToItems(pdfUrl: string, yearHint: number | null): Promise<Idea[]> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "capstone-design-"));
  const pdfPath = path.join(tmpDir, "directorybook.pdf");
  const items: Idea[] = [];

  try {
    const res = await fetch(pdfUrl, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`capstone-design: PDF 다운로드 실패 HTTP ${res.status}`);
    await fs.writeFile(pdfPath, Buffer.from(await res.arrayBuffer()));

    const yearMatch = pdfUrl.match(/(20\d{2})/);
    const year = yearHint ?? (yearMatch ? parseInt(yearMatch[1], 10) : null);

    const renderer = new PdfRenderer(pdfPath);
    const numPages = await renderer.open();
    console.log(`[capstone-design] PDF ${pdfUrl} — ${numPages}페이지`);

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const fields = await ocrPageColumns(renderer, pageNum);
      const team = sanitizeTeamName(fields.team);
      if (!team && fields.members.length === 0) continue;

      const title = fields.title ?? `창의적종합설계경진대회 참가작 (p.${pageNum})`;
      items.push({
        id: makeId(["capstone-design", year, pageNum, team]),
        competition: "capstone-design",
        competitionName: "창의적종합설계경진대회",
        year,
        round: null,
        award: null,
        category: fields.hashtags,
        title,
        team,
        org: sanitizeSchool(fields.school),
        summary: [fields.body, fields.members.length ? `팀원: ${fields.members.join(", ")}` : null]
          .filter(Boolean)
          .join("\n\n") || null,
        sourceUrl: pdfUrl,
        attachments: [{ url: pdfUrl, kind: "file", label: "출품작 온라인 디렉토리북 PDF" }],
      });

      if (pageNum % 10 === 0) console.log(`[capstone-design] ${pageNum}/${numPages} 페이지 처리, ${items.length}건 발견`);
    }

    await renderer.close();
  } finally {
    await terminateOcr();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  return items;
}

export const meta = CAPSTONE_DESIGN_META;

export async function collect(): Promise<Idea[]> {
  const pdfs = await findDirectoryBookUrls();
  if (pdfs.length === 0) {
    console.warn("[capstone-design] 디렉토리북 PDF 링크를 찾지 못함 — 이번 실행은 건너뜀");
    return [];
  }
  console.log(`[capstone-design] 디렉토리북 PDF ${pdfs.length}개 발견`);

  const byId = new Map<string, Idea>();
  for (const { url, year } of pdfs) {
    const cached = await loadCachedItemsForPdf(url);
    if (cached) {
      console.log(`[capstone-design] ${url} — 캐시 ${cached.length}건 재사용`);
      for (const it of cached) byId.set(it.id, it);
      continue;
    }
    const items = await ocrPdfToItems(url, year);
    for (const it of items) byId.set(it.id, it);
  }

  return [...byId.values()];
}

const collector: Collector = { meta, collect };
export default collector;
