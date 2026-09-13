import * as cheerio from "cheerio";
import type { Attachment, Collector, Idea } from "../../lib/types";
import { makeId } from "../../lib/id";
import { ESW_CONTEST_META } from "../../lib/collector-meta";
import { ocrImage, terminateOcr } from "../../lib/ocr";

/**
 * OCR 결과에서 실제로 쓸만한 부분만 골라낸다. 이미지 상단의 큰 장식 타이틀
 * (그라데이션 배경 위 굵은 글씨, 로고, 사진)은 OCR 정확도가 낮아 거의 못 읽지만,
 * "작품개요"/"작품의 특징 및 장점" 아래 일반 문단 텍스트는 원문과 거의 동일하게
 * 나온다는 걸 실제 이미지로 확인했다. "작품개요"를 앵커로 그 이후만 취해서
 * 깨진 상단부가 summary에 섞여 들어가지 않게 한다.
 */
function extractUsableText(raw: string): string | null {
  const idx = raw.indexOf("작품개요");
  const text = (idx >= 0 ? raw.slice(idx) : raw).trim();
  return text.length > 10 ? text : null;
}

const ORIGIN = "https://www.eswcontest.or.kr";
const BASE = `${ORIGIN}/data/award.php`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

async function fetchPage(page: number): Promise<string> {
  const url = `${BASE}?page=${page}&code=award`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`esw-contest: HTTP ${res.status} on page ${page}`);
  return res.text();
}

interface DetailInfo {
  summary: string | null;
  attachments: Attachment[];
}

/**
 * 상세 페이지(award.php?ptype=view&idx=...)를 열어보면, 실제로는 "작품개요"·
 * "작품의 특징 및 장점" 같은 실제 설명 텍스트가 <p> 태그가 아니라 JPG 한 장으로
 * 통째로 게시되어 있다(브라우저로 직접 확인함, 2026년 기준 전 항목이 이 형식).
 * 이미지는 `<a href="javascript:bbsviewImg('award','<base64>','edit')">` 링크에
 * 담겨 있고, base64를 한 번 디코딩하면 다시 URL-encoded 경로가 나온다.
 * 이미지를 내려받아 OCR(lib/ocr.ts, tesseract.js)로 본문 텍스트를 뽑아 summary로
 * 쓴다 — 원본 이미지 URL도 attachments에 그대로 남겨서, OCR이 실패하거나 놓친
 * 부분은 사람이나 (app/api/search의 "숨겨진 데이터 진단" 경로에서) AI가
 * 필요시 원본을 직접 읽을 수 있게 한다.
 */
async function fetchDetail(url: string): Promise<DetailInfo> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return { summary: null, attachments: [] };
    const html = await res.text();
    const $ = cheerio.load(html);

    const attachments: Attachment[] = [];
    $('a[href^="javascript:bbsviewImg"]').each((_, a) => {
      const href = $(a).attr("href") || "";
      const m = href.match(/bbsviewImg\(\s*"[^"]*"\s*,\s*"([^"]+)"/);
      if (!m) return;
      try {
        const urlEncoded = Buffer.from(m[1], "base64").toString("utf-8");
        const relPath = decodeURIComponent(urlEncoded);
        attachments.push({
          url: new URL(relPath, ORIGIN).toString(),
          kind: "image",
          label: "작품 설명 이미지",
        });
      } catch {
        // 예상치 못한 인코딩이면 건너뛴다 (수집 전체를 막을 이유는 없음)
      }
    });

    let summary: string | null = null;
    if (attachments[0]) {
      const imgRes = await fetch(attachments[0].url, { headers: { "User-Agent": UA } });
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const raw = await ocrImage(buf);
        summary = raw ? extractUsableText(raw) : null;
      }
    }

    return { summary, attachments };
  } catch {
    return { summary: null, attachments: [] };
  }
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

  const items = [...seen.values()];

  // 목록 페이지만으로는 title/award/category까지만 나오고 실제 작품 설명은
  // 알 수 없다 (위 fetchDetail 주석 참고). 상세 페이지를 한 건씩 더 열어
  // 이미지를 OCR로 읽고, 원본 이미지 링크도 attachments에 남긴다.
  for (const item of items) {
    if (!item.sourceUrl) continue;
    const detail = await fetchDetail(item.sourceUrl);
    if (detail.attachments.length > 0) item.attachments = detail.attachments;
    if (detail.summary) item.summary = detail.summary;
    await new Promise((r) => setTimeout(r, 300));
  }

  await terminateOcr();
  return items;
}

const collector: Collector = { meta, collect };
export default collector;
