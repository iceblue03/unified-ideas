import * as cheerio from "cheerio";
import type { Collector, Idea } from "../../lib/types";
import { makeId } from "../../lib/id";
import { CODE_FAIR_META } from "../../lib/collector-meta";

const BOARD_URL = "https://www.kcf.or.kr/84/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// 한국코드페어 공식 사이트는 대회 시즌이 끝나면 지난 시즌 아카이브 페이지를
// 통째로 갈아엎는 경향이 있어(2026년 9월 기준, 과거 '히스토리' 게시판은 이미
// 사라짐), 남아있는 유일한 공개 이력은 공지사항 게시판(/84)뿐이다.
// -> 매달 이 게시판을 훑어 "수상작/수상팀/결과 발표"류 공지를 우리 저장소에
//    영구 보관하는 방식으로 "우리 스스로 만드는 아카이브"를 쌓아나간다.
const RESULT_KEYWORDS = ["수상작", "수상팀", "수상 결과", "최종 결과", "시상"];

interface Post {
  idx: string;
  title: string;
  date: string | null;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`code-fair: HTTP ${res.status} on ${url}`);
  return res.text();
}

function parseListPage(html: string): Post[] {
  const $ = cheerio.load(html);
  const posts: Post[] = [];
  $("a.list_text_title").each((_, a) => {
    const href = $(a).attr("href") || "";
    const idx = href.match(/idx=(\d+)/)?.[1];
    const title = $(a).text().trim();
    if (!idx || !title) return;
    posts.push({ idx, title, date: null });
  });
  return posts;
}

async function fetchPostBody(idx: string): Promise<string | null> {
  const url = `${BOARD_URL}?bmode=view&idx=${idx}&t=board`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const meta = $('meta[name="description"]').attr("content");
  if (meta && meta.trim().length > 0) return meta.trim();
  // fallback: visible content area text
  const bodyText = $(".board_view, .conArea, .article_view").first().text().trim();
  return bodyText.length ? bodyText : null;
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

  const resultPosts = [...seen.values()].filter((p) =>
    RESULT_KEYWORDS.some((kw) => p.title.includes(kw)),
  );

  const items: Idea[] = [];
  for (const post of resultPosts) {
    const body = await fetchPostBody(post.idx);
    const roundMatch = post.title.match(/제\s*(\d+)\s*회/);
    const sourceUrl = `${BOARD_URL}?bmode=view&idx=${post.idx}&t=board`;

    items.push({
      id: makeId(["code-fair", post.idx]),
      competition: "code-fair",
      competitionName: "코드페어 (SW공모전·해커톤)",
      year: null,
      round: roundMatch ? `${roundMatch[1]}회` : null,
      award: null,
      category: post.title.includes("해커톤") ? "해커톤" : "SW공모전",
      title: post.title,
      team: null,
      org: null,
      summary: body,
      sourceUrl,
    });

    await new Promise((r) => setTimeout(r, 300));
  }

  return items;
}

const collector: Collector = { meta, collect };
export default collector;
