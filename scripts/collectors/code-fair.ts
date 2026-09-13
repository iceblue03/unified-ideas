import * as cheerio from "cheerio";
import type { Attachment, Collector, Idea } from "../../lib/types";
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

interface PostBody {
  summary: string | null;
  attachments: Attachment[];
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

  return { summary: summary && summary.length > 0 ? summary : null, attachments };
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
      summary: body.summary,
      attachments: body.attachments,
      sourceUrl,
    });

    await new Promise((r) => setTimeout(r, 300));
  }

  return items;
}

const collector: Collector = { meta, collect };
export default collector;
