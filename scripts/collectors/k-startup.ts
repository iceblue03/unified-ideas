import type { Collector, Idea } from "../../lib/types";
import { makeId } from "../../lib/id";
import { K_STARTUP_META } from "../../lib/collector-meta";

const BASE = "https://www.challengek.org";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// k-startup.go.kr 자체엔 구조화된 역대 수상팀 아카이브가 없어, 같은 운영기관(창업진흥원)이 만든
// challengek.org의 "역대수상기업" 페이지를 대신 수집한다. Wix 사이트라 화면은 JS로 그려지지만,
// 페이지 HTML에 <script id="wix-warmup-data">로 그 페이지가 쓰는 모든 데이터 컬렉션이 순수 JSON으로
// 통째로 내장돼 있어(탭으로 나뉜 두 리그가 있어도 둘 다 한 페이지 요청에 같이 들어있는 경우가 많다)
// 헤드리스 브라우저 없이 정적 fetch만으로 파싱 가능하다.
//
// 연도별 URL 슬러그는 Wix가 페이지를 복제할 때마다 "복제-2018" 같은 임의 문자열을 붙여 매우
// 불규칙하다(하드코딩하면 사이트가 재배포될 때 깨짐). 대신 같은 페이지 HTML에 같이 내장되는
// 사이트 전체 라우터 맵(siteFeaturesConfigs.router.pagesMap: pageId -> {title, pageUriSEO})을
// 읽어 제목에 4자리 연도가 들어간 페이지를 전부 찾아내는 방식으로 연도 목록을 "발견"한다.

const EXCLUDE_TITLE_PATTERN = /진출팀|왕중왕전|통합본선|원본백업|올해의|대회주요성과|비즈매칭|사전등록/;
const YEAR_PATTERN = /(20\d{2})/;

interface PageCandidate {
  pageId: string;
  title: string;
  url: string;
  year: number;
}

function extractJsonAfter(html: string, marker: string): unknown | null {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const scriptStart = html.lastIndexOf("<script", idx);
  if (scriptStart === -1) return null;
  const tagEnd = html.indexOf(">", scriptStart);
  if (tagEnd === -1) return null;
  const scriptEnd = html.indexOf("</script>", idx);
  if (scriptEnd === -1) return null;
  const content = html.slice(tagEnd + 1, scriptEnd);
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function findPagesMap(html: string): Record<string, { pageId: string; title: string; pageUriSEO: string }> | null {
  const data = extractJsonAfter(html, '"pagesMap"') as
    | { siteFeaturesConfigs?: { router?: { pagesMap?: Record<string, { pageId: string; title: string; pageUriSEO: string }> } } }
    | null;
  return data?.siteFeaturesConfigs?.router?.pagesMap ?? null;
}

function toUrl(pageUriSEO: string): string {
  const segments = pageUriSEO.split("/").map(encodeURIComponent);
  return `${BASE}/${segments.join("/")}`;
}

interface WixField {
  displayName: string;
  systemField: boolean;
}
interface WixSchema {
  id: string;
  fields: Record<string, WixField>;
}
interface WixWarmupData {
  appsWarmupData?: {
    dataBinding?: {
      schemas: Record<string, WixSchema>;
      dataStore: {
        recordsByCollectionId: Record<string, Record<string, Record<string, unknown>>>;
      };
    };
  };
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`k-startup: HTTP ${res.status} on ${url}`);
  return { html: await res.text(), finalUrl: res.url };
}

function fieldKeyFor(schema: WixSchema, displayNameSubstr: string): string | null {
  for (const [key, f] of Object.entries(schema.fields)) {
    if (!f.systemField && f.displayName.includes(displayNameSubstr)) return key;
  }
  return null;
}

/** "link-yebicangeobrigeu-2022-title" -> displayName "예비창업리그 2022 (훈격)" 같은 시스템 필드에서
 * 라운드(리그) 이름을 뽑아낸다. 없으면 null. */
function roundFromLinkField(schema: WixSchema): string | null {
  for (const [key, f] of Object.entries(schema.fields)) {
    if (f.systemField && key.startsWith("link-")) {
      const cleaned = f.displayName.replace(/\(.*?\)/g, "").replace(/\d{4}/g, "").trim();
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function collectPageCandidates(pagesMap: Record<string, { pageId: string; title: string; pageUriSEO: string }>): PageCandidate[] {
  const candidates: PageCandidate[] = [];
  for (const info of Object.values(pagesMap)) {
    if (EXCLUDE_TITLE_PATTERN.test(info.title)) continue;
    if (info.pageUriSEO === "blank") continue; // Wix 내부 라우팅 placeholder, 실제 콘텐츠 없음
    const m = info.title.match(YEAR_PATTERN);
    if (!m) continue;
    candidates.push({
      pageId: info.pageId,
      title: info.title,
      url: toUrl(info.pageUriSEO),
      year: parseInt(m[1], 10),
    });
  }
  // 연도 오름차순으로 처리해서, 나중에 collectionId 중복 제거 시 "가짜" 리다이렉트 사본(예: 2023
  // 페이지가 실제로는 2022 데이터로 리다이렉트되는 경우)보다 진짜 연도가 먼저 처리되게 한다.
  candidates.sort((a, b) => a.year - b.year);
  return candidates;
}

// 알려진 한계: Wix가 페이지를 복제해서 만든 히스토리 때문에, 일부 연도 쌍(예: 2023/2024)의 페이지가
// 내부적으로 같은 데이터 컬렉션 id를 공유하는 경우가 있다(사이트 자체의 연도 라우팅이 꼬여 있음).
// processedCollectionIds로 같은 컬렉션이 두 번 들어가는 것은 막지만, 그 컬렉션이 정말 어느 연도
// 소속인지는 먼저 도달한 페이지의 연도를 신뢰할 수밖에 없다 — 소수 항목의 year가 실제와 ±1년
// 어긋날 수 있다는 뜻이다. award/title/team 등 핵심 필드는 영향받지 않는다.
export const meta = K_STARTUP_META;

export async function collect(): Promise<Idea[]> {
  const { html: seedHtml } = await fetchHtml(`${BASE}/2022`);
  const pagesMap = findPagesMap(seedHtml);
  if (!pagesMap) throw new Error("k-startup: pagesMap을 찾지 못했습니다 (사이트 구조 변경 가능성)");

  const candidates = collectPageCandidates(pagesMap);
  console.log(`  [k-startup] 연도 후보 ${candidates.length}개 발견`);

  const processedCollectionIds = new Set<string>();
  const items = new Map<string, Idea>();

  for (const candidate of candidates) {
    let html: string;
    try {
      const fetched = await fetchHtml(candidate.url);
      html = fetched.html;
    } catch (e) {
      console.error(`  [k-startup] ${candidate.title} (${candidate.url}) 요청 실패:`, e instanceof Error ? e.message : e);
      continue;
    }

    const warmup = extractJsonAfter(html, '"wix-warmup-data"') as WixWarmupData | null;
    const db = warmup?.appsWarmupData?.dataBinding;
    if (!db) {
      console.error(`  [k-startup] ${candidate.title}: wix-warmup-data를 찾지 못함`);
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }

    const collectionIds = Object.keys(db.dataStore.recordsByCollectionId);
    const unprocessed = collectionIds.filter((id) => !processedCollectionIds.has(id));

    // 2개 컬렉션이 있는데 링크 필드로 라운드를 특정할 수 없는 쪽이 있으면, 나머지 하나가
    // "예비창업리그"로 식별됐을 때 다른 하나를 "창업리그"로 간주한다(둘 중 하나로 소거).
    const roundByCollection = new Map<string, string | null>();
    for (const id of unprocessed) {
      const schema = db.schemas[id];
      roundByCollection.set(id, schema ? roundFromLinkField(schema) : null);
    }
    if (unprocessed.length === 2) {
      const [a, b] = unprocessed;
      if (roundByCollection.get(a) && !roundByCollection.get(b)) {
        roundByCollection.set(b, roundByCollection.get(a)?.includes("예비") ? "창업리그" : "예비창업리그");
      } else if (roundByCollection.get(b) && !roundByCollection.get(a)) {
        roundByCollection.set(a, roundByCollection.get(b)?.includes("예비") ? "창업리그" : "예비창업리그");
      }
    } else if (unprocessed.length === 1 && !roundByCollection.get(unprocessed[0])) {
      if (candidate.title.includes("창업리그")) roundByCollection.set(unprocessed[0], "창업리그");
    }

    for (const collectionId of unprocessed) {
      processedCollectionIds.add(collectionId);
      const schema = db.schemas[collectionId];
      const records = db.dataStore.recordsByCollectionId[collectionId];
      if (!schema || !records) continue;

      const awardKey = fieldKeyFor(schema, "훈격");
      const repKey = fieldKeyFor(schema, "대표자");
      const itemKey = fieldKeyFor(schema, "아이템");
      const teamKey = fieldKeyFor(schema, "팀명");
      const round = roundByCollection.get(collectionId) ?? null;

      let count = 0;
      for (const record of Object.values(records)) {
        const title = (itemKey ? record[itemKey] : null) as string | null | undefined;
        if (!title || !title.trim()) continue;
        const team = (teamKey ? record[teamKey] : null) as string | null | undefined;
        const award = (awardKey ? record[awardKey] : null) as string | null | undefined;
        const rep = (repKey ? record[repKey] : null) as string | null | undefined;

        const idea: Idea = {
          id: makeId(["k-startup", candidate.year, round, title, team]),
          competition: "k-startup",
          competitionName: "도전! K-스타트업",
          year: candidate.year,
          round,
          award: award && award.trim() ? award.trim() : null,
          category: null,
          title: title.trim(),
          team: team && team.trim() ? team.trim() : (rep && rep.trim() ? rep.trim() : null),
          org: null,
          summary: null,
          sourceUrl: candidate.url,
        };
        items.set(idea.id, idea);
        count++;
      }
      console.log(`  [k-startup] ${candidate.title} / ${round ?? "구분없음"}: ${count}건`);
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  return [...items.values()];
}

const collector: Collector = { meta, collect };
export default collector;
