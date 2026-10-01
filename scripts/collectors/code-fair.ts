import * as cheerio from "cheerio";
import type { Attachment, Collector, Idea } from "../../lib/types";
import { makeId } from "../../lib/id";
import { CODE_FAIR_META } from "../../lib/collector-meta";
import { ocrImage, terminateOcr } from "../../lib/ocr";

const BOARD_URL = "https://www.kcf.or.kr/84/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// 한국코드페어 공식 사이트는 대회 시즌이 끝나면 지난 시즌 아카이브 페이지를
// 통째로 갈아엎는 경향이 있어(2026년 9월 기준, 과거 '히스토리' 게시판은 이미
// 사라짐), 남아있는 유일한 공개 이력은 공지사항 게시판(/84)뿐이다.
// -> 매달 이 게시판을 훑어 "수상작/수상팀/결과 발표"류 공지를 우리 저장소에
//    영구 보관하는 방식으로 "우리 스스로 만드는 아카이브"를 쌓아나간다.
const RESULT_KEYWORDS = ["수상작", "수상팀", "수상 결과", "최종 결과", "시상", "심사 결과"];

function isResultPost(title: string): boolean {
  if (RESULT_KEYWORDS.some((kw) => title.includes(kw))) return true;
  if (/심사.*결과/.test(title)) return true;
  return false;
}

function parseListDate(rowText: string): string | null {
  const abs = rowText.match(/(20\d{2}-\d{2}-\d{2})/);
  if (abs) return abs[1];
  const rel = rowText.match(/(\d+)\s*일\s*전/);
  if (rel) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - parseInt(rel[1], 10));
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function inferYear(title: string, date: string | null, roundNum: string | null): number | null {
  const fromTitle = title.match(/(20\d{2})/)?.[1];
  if (fromTitle) return parseInt(fromTitle, 10);
  if (date) return parseInt(date.slice(0, 4), 10);
  if (roundNum) {
    const n = parseInt(roundNum, 10);
    if (Number.isFinite(n)) return n + 2018;
  }
  return null;
}

interface Post {
  idx: string;
  title: string;
  date: string | null;
}

async function fetchHtml(url: string): Promise<string> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429) {
      lastStatus = 429;
      await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`code-fair: HTTP ${res.status} on ${url}`);
    return res.text();
  }
  throw new Error(`code-fair: HTTP ${lastStatus} on ${url}`);
}

function parseListPage(html: string): Post[] {
  const $ = cheerio.load(html);
  const posts: Post[] = [];
  $("a.list_text_title").each((_, a) => {
    const href = $(a).attr("href") || "";
    const idx = href.match(/idx=(\d+)/)?.[1];
    const title = $(a).text().trim();
    if (!idx || !title) return;
    const row = $(a).closest("li, tr, .board_list, .list_row");
    const date = parseListDate(row.text() || $(a).parent().text());
    posts.push({ idx, title, date });
  });
  return posts;
}

interface PostBody {
  summary: string | null;
  attachments: Attachment[];
  writtenDate: string | null;
}

/**
 * kcf.or.kr(imweb 빌더)은 공지 본문을 .board_view > .board_txt_area(fr-view,
 * Froala 에디터)에 렌더링한다. <meta name="description">은 에디터 본문 앞부분을
 * 짧게 잘라 넣은 것이라 "수상작 발표" 공지처럼 본문이 표/이미지 위주면 거의
 * 의미 없는 텍스트만 남는다 — 그래서 og:description 대신 실제 본문 텍스트를
 * 우선 사용한다.
 *
 * 실제로 이 게시판은 "부문별 이미지를 확인하거나 첨부파일을 참조하라"는 식으로
 * 결과를 통째로 JPG(팀명 표)나 첨부파일로만 올리는 경우가 흔하다(2026년 시즌
 * "1차 서면심사 결과" 공지에서 확인). 이런 이미지 안에는 보통 "팀명"만 있고
 * "작품명" 컬럼은 없으므로, 이 수집기는 이미지/첨부파일 링크를 attachments로만
 * 보존하고 절대 그 안의 텍스트를 title/team으로 추측해 넣지 않는다 — 팀명을
 * 작품명으로 오인하는 사고를 피하기 위한 안전장치다. title은 항상 공지 제목
 * 그대로 유지한다.
 */
async function fetchPostBody(idx: string): Promise<PostBody> {
  const url = `${BOARD_URL}?bmode=view&idx=${idx}&t=board`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const content = $(".board_txt_area").first();
  const bodyText = (content.text() || "").replace(/\s+\n/g, "\n").trim();
  const meta = $('meta[name="description"]').attr("content")?.trim() || null;
  const summary = bodyText.length > 0 ? bodyText : meta;

  const dateFromView =
    $(".board_date, .date, .write_date")
      .first()
      .text()
      .match(/(20\d{2}-\d{2}-\d{2})/)?.[1] ?? null;
  const writtenDate = dateFromView;

  const attachments: Attachment[] = [];
  content.find("img").each((_, img) => {
    const src = $(img).attr("src");
    if (!src) return;
    attachments.push({
      url: new URL(src, BOARD_URL).toString(),
      kind: "image",
      label: "공지 첨부 이미지 (결과표 등)",
    });
  });
  $(".file_area a, .bo_v_file a").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    attachments.push({
      url: new URL(href, BOARD_URL).toString(),
      kind: "file",
      label: $(a).text().trim() || "첨부파일",
    });
  });

  return {
    summary: summary && summary.length > 0 ? summary : null,
    attachments,
    writtenDate,
  };
}

// 라이브 사이트에서 지워진 "역대 수상작(히스토리)" 게시판(kcf.or.kr/history)을 Wayback Machine으로
// 한 번 더 백필한다. 게시글 본문이 스크린샷 이미지라 팀명까지는 못 긁지만, 연도/회차/부문 단위
// 항목은 실제 아카이브에서 복원 가능하다 (README/collector-meta.ts에 자세한 근거 정리됨).
const CDX_API =
  "https://web.archive.org/cdx/search/cdx?url=www.kcf.or.kr/history*&output=json&filter=statuscode:200";
const WAYBACK_MIN_LENGTH = 10_000; // 사이트가 "사이트 준비중"으로 바뀐 뒤의 캡처는 ~2KB로 확 줄어듦
const HISTORY_TITLE_PATTERN = /제\s*(\d+)\s*회\s*한국코드페어\s*(SW공모전|해커톤)\s*수상작(?:\s*\(([^)]+)\))?/;

type CdxRow = [string, string, string, string, string, string, string];

async function fetchWaybackCdx(): Promise<CdxRow[]> {
  let last = "code-fair: wayback CDX 요청 실패";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(CDX_API, { headers: { "User-Agent": UA } });
    if (res.ok) {
      const rows = (await res.json()) as CdxRow[];
      return rows.slice(1);
    }
    last = `code-fair: wayback CDX HTTP ${res.status}`;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(last);
}

const CARD_SKIP =
  /한국코드페어|소개합니다|축하|수상작을|디지털 세상|개선점|문제점|내부 사진|3차 작품|접수기간|과학기술정보통신부/;

function cleanLine(line: string): boolean {
  const hangul = line.match(/[가-힣]/g)?.length ?? 0;
  return hangul >= 2 && !/[|\\]{2,}/.test(line);
}

function usableTitle(line: string): boolean {
  if (line.length < 6 || line.length > 40) return false;
  if (/소개|기능|페이지|하겠습니다|축하|수상작|넘어선|구현한|기대합니다|불러오기|전체 모습|처럼$|하게 하여/.test(line)) return false;
  const weird = line.replace(/[가-힣A-Za-z0-9 \-·()/+]/g, "");
  if (weird.length > 0) return false;
  const hangul = line.match(/[가-힣]/g)?.length ?? 0;
  const latin = line.match(/[A-Za-z]/g)?.length ?? 0;
  return hangul >= 4 || (latin >= 4 && hangul >= 2);
}

/** 수상작 소개 카드(제목 / 팀 / 설명 포스터)에서 작품 단위 필드를 뽑는다. 표지 포스터면 null. */
function parseAwardCard(raw: string): { title: string; team: string | null; summary: string | null; award: string | null } | null {
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 2);
  if (!lines.some((l) => /수상|대상|금상|은상|동상/.test(l))) return null;

  const award =
    lines.find((l) => /^(대상|금상|은상|동상|장려상|최우수상|우수상)$/.test(l)) ??
    (raw.includes("대상") ? "대상" : null);

  const candidates = lines.filter((l) => !CARD_SKIP.test(l) && usableTitle(l));
  const title = candidates[0];
  if (!title) return null;

  const teamLine = lines.find(
    (l) => l !== title && l.length >= 2 && l.length <= 16 && cleanLine(l) && !CARD_SKIP.test(l) && !usableTitle(l),
  );
  const team = teamLine && !/[.요음임다]$/.test(teamLine) ? teamLine : null;
  const summary =
    lines
      .filter((l) => l.length >= 18 && l !== title && !CARD_SKIP.test(l) && cleanLine(l))
      .join("\n") || null;
  return { title, team, summary, award };
}

interface HistoryCapture {
  idx: string;
  timestamp: string;
  original: string;
  length: number;
}

function pickBestCaptures(rows: CdxRow[]): HistoryCapture[] {
  const byIdx = new Map<string, HistoryCapture[]>();
  for (const [, timestamp, original, , , , lengthStr] of rows) {
    const idxMatch = original.match(/idx=(\d+)/);
    if (!idxMatch) continue; // 목록 페이지(?page=N) 등은 개별 게시글이 아니므로 건너뜀
    const idx = idxMatch[1];
    const capture = { idx, timestamp, original, length: parseInt(lengthStr, 10) || 0 };
    const list = byIdx.get(idx) ?? [];
    list.push(capture);
    byIdx.set(idx, list);
  }

  const best: HistoryCapture[] = [];
  for (const captures of byIdx.values()) {
    // 실제 콘텐츠가 있는(=바이트 수가 큰) 캡처 중 가장 최신인 것을 고른다. 전부 placeholder
    // 크기뿐이면 그 idx는 복원 불가로 보고 건너뛴다.
    const valid = captures.filter((c) => c.length >= WAYBACK_MIN_LENGTH);
    if (valid.length === 0) continue;
    valid.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    best.push(valid[0]);
  }
  return best;
}

async function collectHistoryBackfill(): Promise<Idea[]> {
  const rows = await fetchWaybackCdx();
  const captures = pickBestCaptures(rows);
  console.log(`  [code-fair] wayback 히스토리 게시판: 복원 가능한 게시글 ${captures.length}건 발견`);

  const items: Idea[] = [];
  let patternMiss = 0;
  for (const capture of captures) {
    await new Promise((r) => setTimeout(r, 2500));
    const fetchUrl = `https://web.archive.org/web/${capture.timestamp}id_/${capture.original}`;
    const humanUrl = `https://web.archive.org/web/${capture.timestamp}/${capture.original}`;
    let html: string;
    try {
      html = await fetchHtml(fetchUrl);
    } catch (e) {
      console.error(`  [code-fair] wayback idx=${capture.idx} 요청 실패:`, e instanceof Error ? e.message : e);
      continue;
    }

    const $ = cheerio.load(html);
    const rawTitle = $("title").text().trim();
    const titleMatch = rawTitle.match(HISTORY_TITLE_PATTERN);
    const summary = $('meta[name="description"]').attr("content")?.trim() || null;

    if (!titleMatch) {
      patternMiss += 1;
      console.warn(`  [code-fair] wayback idx=${capture.idx}: 제목 패턴 불일치 — 원문 제목으로 저장 ("${rawTitle}")`);
      items.push({
        id: makeId(["code-fair", "history", capture.idx]),
        competition: "code-fair",
        competitionName: "코드페어 (SW공모전·해커톤)",
        year: inferYear(rawTitle, null, null),
        round: null,
        award: null,
        category: rawTitle.includes("해커톤") ? "해커톤" : "SW공모전",
        title: rawTitle || `한국코드페어 히스토리 게시글 ${capture.idx}`,
        team: null,
        org: null,
        summary,
        sourceUrl: humanUrl,
      });
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }

    const round = titleMatch[1];
    const categoryBase = titleMatch[2];
    const division = titleMatch[3] ?? null;
    const year = parseInt(round, 10) + 2018; // 제3회=2021, 제5회=2023, 제6회=2024
    const category = division ? `${categoryBase} ${division}` : categoryBase;

    const imageUrls = new Set<string>();
    $("img").each((_, img) => {
      const src = $(img).attr("src") || "";
      if (!src.includes("cdn.imweb.me/upload/")) return;
      imageUrls.add(src.startsWith("http") ? src : new URL(src, "https://cdn.imweb.me").toString());
    });

    let cards = 0;
    for (const imageUrl of imageUrls) {
      try {
        const imgRes = await fetch(imageUrl, { headers: { "User-Agent": UA } });
        if (!imgRes.ok) continue;
        const buf = Buffer.from(await imgRes.arrayBuffer());
        if (buf.length < 40_000) continue;
        const text = await ocrImage(buf);
        const card = text ? parseAwardCard(text) : null;
        if (!card) continue;
        cards += 1;
        items.push({
          id: makeId(["code-fair", "card", year, card.title, division]),
          competition: "code-fair",
          competitionName: "코드페어 (SW공모전·해커톤)",
          year,
          round: `${round}회`,
          award: card.award,
          category,
          title: card.title,
          team: card.team,
          org: null,
          summary: card.summary,
          attachments: [{ url: imageUrl, kind: "image", label: "수상작 소개 카드" }],
          sourceUrl: humanUrl,
        });
      } catch (e) {
        console.error(`  [code-fair] 카드 OCR 실패 idx=${capture.idx}:`, e instanceof Error ? e.message : e);
      }
    }

    if (cards === 0) {
      const title = division
        ? `제${round}회 한국코드페어 ${categoryBase} 수상작 (${division})`
        : `제${round}회 한국코드페어 ${categoryBase} 수상작`;
      items.push({
        id: makeId(["code-fair", "history", capture.idx]),
        competition: "code-fair",
        competitionName: "코드페어 (SW공모전·해커톤)",
        year,
        round: `${round}회`,
        award: null,
        category,
        title,
        team: null,
        org: null,
        summary,
        sourceUrl: humanUrl,
      });
    } else {
      console.log(`  [code-fair] wayback idx=${capture.idx}: 수상작 카드 ${cards}건`);
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  if (patternMiss > 0) {
    console.log(`  [code-fair] wayback 제목 패턴 불일치 ${patternMiss}건 (원문 제목으로 저장)`);
  }
  return items;
}

export const meta = CODE_FAIR_META;

export async function collect(): Promise<Idea[]> {
  const seen = new Map<string, Post>();
  let page = 1;
  const MAX_PAGES = 50;

  while (page <= MAX_PAGES) {
    const html = await fetchHtml(`${BOARD_URL}?page=${page}`);
    const posts = parseListPage(html);
    if (posts.length === 0) break;

    const before = seen.size;
    for (const p of posts) seen.set(p.idx, p);
    const after = seen.size;

    // 사이트가 마지막 페이지 이후로 같은 페이지를 반복해서 보여주는 경우가
    // 있어서(관측됨), 새로운 글이 하나도 없으면 그만 순회한다.
    if (after === before) break;

    page += 1;
    await new Promise((r) => setTimeout(r, 300));
  }

  const resultPosts = [...seen.values()].filter((p) => isResultPost(p.title));
  console.log(`  [code-fair] 결과 관련 공지 ${resultPosts.length}건 (전체 게시글 ${seen.size}건)`);

  const items: Idea[] = [];
  for (const post of resultPosts) {
    const body = await fetchPostBody(post.idx);
    const roundMatch = post.title.match(/제\s*(\d+)\s*회/);
    const roundNum = roundMatch?.[1] ?? null;
    const writtenDate = post.date ?? body.writtenDate;
    const sourceUrl = `${BOARD_URL}?bmode=view&idx=${post.idx}&t=board`;

    items.push({
      id: makeId(["code-fair", post.idx]),
      competition: "code-fair",
      competitionName: "코드페어 (SW공모전·해커톤)",
      year: inferYear(post.title, writtenDate, roundNum),
      round: roundNum ? `${roundNum}회` : null,
      award: null,
      category: post.title.includes("해커톤") ? "해커톤" : "SW공모전",
      title: post.title,
      team: null,
      org: null,
      summary: body.summary,
      attachments: body.attachments,
      sourceUrl,
    });

    await new Promise((r) => setTimeout(r, 300));
  }

  let historyItems: Idea[] = [];
  try {
    historyItems = await collectHistoryBackfill();
  } catch (e) {
    console.error("  [code-fair] wayback 백필 실패 (라이브 수집 결과는 유지):", e instanceof Error ? e.message : e);
  }

  await terminateOcr();
  return [...items, ...historyItems];
}

const collector: Collector = { meta, collect };
export default collector;
