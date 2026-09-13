import * as cheerio from "cheerio";
import type { Attachment, Collector, Idea } from "../../lib/types";
import { makeId } from "../../lib/id";
import { YOUTH_STARTUP_META } from "../../lib/collector-meta";

const LIST_URL = "https://yeep.go.kr/cpthb/contestCaseList.do";
const DETAIL_URL = "https://yeep.go.kr/cpthb/contestCaseDetail.do";
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

interface DetailKey {
  exclnCaseNo: string;
  cpthbNo: string;
}

interface PageResult {
  items: Idea[];
  /** 대회 필터와 무관하게, 이 페이지에 실제로 표시된 카드들의 식별 텍스트(중복/반복 페이지 감지용) */
  rawKeys: string[];
  /** item.id -> 상세페이지 조회용 키 (목록 카드에는 없는, 상세 설명을 더 긁어오기 위함) */
  detailKeys: Map<string, DetailKey>;
}

function parsePage(html: string): PageResult {
  const $ = cheerio.load(html);
  const items: Idea[] = [];
  const rawKeys: string[] = [];
  const detailKeys = new Map<string, DetailKey>();

  $("ul.thumb-list > li").each((_, li) => {
    const el = $(li);
    const titleLink = el.find(".list-tit a").first();
    const fullTitle = titleLink.text().trim();
    if (!fullTitle) return;
    rawKeys.push(fullTitle);

    // 카드의 "javascript:goDetail('63', '127')" 형태 onclick에서 상세페이지 키를 뽑는다.
    const onclick = titleLink.attr("onclick") || "";
    const detailMatch = onclick.match(/goDetail\(\s*'(\d+)'\s*,\s*'(\d+)'\s*\)/);

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

    const id = makeId(["youth-startup", year, team, summary]);
    if (detailMatch) detailKeys.set(id, { exclnCaseNo: detailMatch[1], cpthbNo: detailMatch[2] });

    items.push({
      id,
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

  return { items, rawKeys, detailKeys };
}

interface DetailInfo {
  summary: string | null;
  attachments: Attachment[];
}

/**
 * 목록 카드의 "아이템 개요"는 한 줄짜리 슬로건 수준이라 검색에 쓰기엔 얕다.
 * 실제로는 각 카드마다 별도 상세페이지(POST contestCaseDetail.do)가 있고,
 * 그 안에 "동아리소개"/"아이디어 개요"/"창업전략" 세 섹션이 이미지로 들어있다 —
 * 그런데 이 이미지들은 스캔본이 아니라 카드뉴스 형태 그래픽이라, 실제 설명
 * 문구가 <img alt="..."> 안에 고스란히 평문으로 들어있다(브라우저로 직접
 * 확인함). OCR 없이 alt 텍스트만 읽어도 훨씬 풍부한 summary를 얻을 수 있다.
 */
async function fetchDetail(key: DetailKey): Promise<DetailInfo> {
  try {
    const res = await fetch(DETAIL_URL, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ exclnCaseNo: key.exclnCaseNo, cpthbNo: key.cpthbNo }),
    });
    if (!res.ok) return { summary: null, attachments: [] };
    const html = await res.text();
    const $ = cheerio.load(html);

    const sections: string[] = [];
    const attachments: Attachment[] = [];

    $(".notice-content .notice-title").each((_, titleEl) => {
      const label = $(titleEl).text().trim();
      const img = $(titleEl).nextAll(".notice-img").first().find("img").first();
      const text = (img.attr("alt") || "").replace(/\r\n/g, "\n").trim();
      if (text) sections.push(label ? `[${label}]\n${text}` : text);
      const src = img.attr("src");
      if (src) {
        attachments.push({
          url: new URL(src, DETAIL_URL).toString(),
          kind: "image",
          label: label || "소개 이미지",
        });
      }
    });

    return { summary: sections.length ? sections.join("\n\n") : null, attachments };
  } catch {
    return { summary: null, attachments: [] };
  }
}

export const meta = YOUTH_STARTUP_META;

export async function collect(): Promise<Idea[]> {
  const seenItems = new Map<string, Idea>();
  const seenRawKeys = new Set<string>();
  const seenDetailKeys = new Map<string, DetailKey>();
  let page = 1;
  const MAX_PAGES = 200; // safety cap

  while (page <= MAX_PAGES) {
    const html = await fetchPage(page);
    const { items, rawKeys, detailKeys } = parsePage(html);
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
    for (const [id, key] of detailKeys) seenDetailKeys.set(id, key);
    page += 1;
    await new Promise((r) => setTimeout(r, 300));
  }

  const items = [...seenItems.values()];

  // 목록만으로는 한 줄 슬로건 수준의 summary만 나온다 (fetchDetail 주석 참고).
  // 카드별 상세페이지를 한 번씩 더 열어 훨씬 풍부한 설명으로 보강한다.
  for (const item of items) {
    const key = seenDetailKeys.get(item.id);
    if (!key) continue;
    const detail = await fetchDetail(key);
    if (detail.summary) item.summary = detail.summary;
    if (detail.attachments.length > 0) item.attachments = detail.attachments;
    await new Promise((r) => setTimeout(r, 300));
  }

  return items;
}

const collector: Collector = { meta, collect };
export default collector;
