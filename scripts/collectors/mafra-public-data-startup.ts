import type { Collector, Idea } from "../../lib/types";
import { makeId } from "../../lib/id";
import { MAFRA_PUBLIC_DATA_STARTUP_META } from "../../lib/collector-meta";

const LIST_PAGE_URL = "https://data.mafra.go.kr/contest/winnerListNew.do";
const API_URL = "https://data.mafra.go.kr/contest/getWinnerListPageNew.do";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

interface WinnerRecord {
  bbs_no: number;
  sj: string | null; // 경진대회명(회차), e.g. "제10회 농림축산식품부 공공데이터 활용 창업경진대회"
  field_prize: string | null; // "분야 / 포상", e.g. "제품 및 서비스 개발 / 대상"
  piece_nm: string | null; // 작품명
  team_info: string | null; // 팀/업체명
  main_content: string | null; // HTML 설명
  total_cnt: number;
}

interface ApiResponse {
  data: WinnerRecord[];
}

function stripHtml(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
  return text || null;
}

function parseYear(sj: string | null): number | null {
  if (!sj) return null;
  const m = sj.match(/(20\d{2})/);
  return m ? parseInt(m[1], 10) : null;
}

async function fetchAll(): Promise<WinnerRecord[]> {
  // rows를 넉넉히 크게 주면 서버가 한 번에 전체(현재 129건)를 돌려준다 — 실제 curl 테스트로 확인됨.
  const body = new URLSearchParams({
    s_search_type: "",
    s_search_name: "",
    cur_page: "1",
    rows: "1000",
  });
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });
  if (!res.ok) throw new Error(`mafra-public-data-startup: HTTP ${res.status}`);
  const json = (await res.json()) as ApiResponse;
  return json.data ?? [];
}

export const meta = MAFRA_PUBLIC_DATA_STARTUP_META;

export async function collect(): Promise<Idea[]> {
  const records = await fetchAll();
  const items = new Map<string, Idea>();

  for (const r of records) {
    const title = (r.piece_nm ?? "").trim();
    if (!title) continue;

    const round = r.sj ? r.sj.trim() : null;
    const year = parseYear(r.sj);
    const team = r.team_info ? r.team_info.trim() : null;

    let category: string | null = null;
    let award: string | null = null;
    if (r.field_prize) {
      const parts = r.field_prize.split("/").map((p) => p.trim());
      if (parts.length >= 2) {
        category = parts[0] || null;
        award = parts.slice(1).join(" / ") || null;
      } else {
        award = r.field_prize.trim() || null;
      }
    }

    const idea: Idea = {
      id: makeId(["mafra-public-data-startup", round, title, team]),
      competition: "mafra-public-data-startup",
      competitionName: "농림축산식품부 공공데이터 활용 창업경진대회",
      year,
      round,
      award,
      category,
      title,
      team,
      org: null,
      summary: stripHtml(r.main_content),
      sourceUrl: LIST_PAGE_URL,
    };
    items.set(idea.id, idea);
  }

  console.log(`  [mafra-public-data-startup] ${items.size}건 수집 (원본 ${records.length}건)`);
  return [...items.values()];
}

const collector: Collector = { meta, collect };
export default collector;
