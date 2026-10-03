import { ideaMentionsCane } from "./ai-query-gen";
import { textMentionsCaneLeak } from "./relevance";
import type { ShoppingProduct } from "./types";

/**
 * eBay Browse API (OAuth2 client-credentials 방식). 네이버쇼핑 검색 API가 서비스
 * 종료되어 이걸로 교체했다. https://developer.ebay.com 에서 발급받은 프로덕션 키셋
 * (App ID/Cert ID)이 필요 — 샌드박스 키만 있다면 EBAY_ENV=sandbox로 설정.
 *
 * Application access token(클라이언트 자격 증명 토큰)은 발급 후 보통 2시간 유효하므로
 * 만료 전까지 메모리에 캐시해 매 검색마다 새로 발급받지 않는다.
 */

export interface ShoppingSearchResult {
  ok: boolean;
  items: ShoppingProduct[];
  skipped?: boolean;
  error?: string;
  /** 결과가 나온 검색어. 전부 0건이면 첫 검색어 */
  queryUsed?: string | null;
  /** 실제로 시도한 검색어, 시도 순서 */
  queriesTried?: string[];
}

function isSandbox(): boolean {
  return process.env.EBAY_ENV === "sandbox";
}

function tokenUrl(): string {
  return isSandbox()
    ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
    : "https://api.ebay.com/identity/v1/oauth2/token";
}

function searchUrl(): string {
  return isSandbox()
    ? "https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search"
    : "https://api.ebay.com/buy/browse/v1/item_summary/search";
}

export function isShoppingConfigured(): boolean {
  return !!(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}

let cachedToken: { value: string; expiresAt: number } | null = null;
let tokenInflight: Promise<string | null> | null = null;

async function getAccessToken(clientId: string, clientSecret: string): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }
  if (tokenInflight) return tokenInflight;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  tokenInflight = requestAccessToken(basic).finally(() => {
    tokenInflight = null;
  });
  return tokenInflight;
}

/** 검색어 생성과 겹쳐 토큰을 미리 받는다. 이미 받은 토큰이나 진행 중인 발급이 있으면 재요청하지 않는다. */
export function prefetchEbayToken(): void {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return;
  void getAccessToken(clientId, clientSecret);
}

async function requestAccessToken(basic: string): Promise<string | null> {
  try {
    const res = await fetch(tokenUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basic}`,
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent("https://api.ebay.com/oauth/api_scope")}`,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[ebay] 토큰 발급 실패: ${res.status} ${text}`.slice(0, 300));
      return null;
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      console.warn("[ebay] 토큰 응답에 access_token이 없습니다.");
      return null;
    }

    cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000 };
    return cachedToken.value;
  } catch (e) {
    console.warn(`[ebay] 토큰 발급 중 오류: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

interface EbayItemSummary {
  itemId?: string;
  title?: string;
  itemWebUrl?: string;
  image?: { imageUrl?: string };
  price?: { value?: string; currency?: string };
  seller?: { username?: string };
  categories?: Array<{ categoryName?: string }>;
}

function mapItem(item: EbayItemSummary): ShoppingProduct {
  const priceValue = item.price?.value ? Number(item.price.value) : NaN;
  return {
    id: item.itemId ?? item.itemWebUrl ?? crypto.randomUUID(),
    title: item.title ?? "",
    link: item.itemWebUrl ?? "",
    image: item.image?.imageUrl || null,
    lprice: Number.isFinite(priceValue) ? priceValue : null,
    hprice: null,
    currency: item.price?.currency || null,
    mallName: item.seller?.username ? `eBay · ${item.seller.username}` : "eBay",
    brand: null,
    maker: null,
    category: item.categories?.[0]?.categoryName || null,
  };
}

/**
 * eBay Browse API의 q 검색은 "best match"(연관도) 정렬이라 모든 키워드가 다 들어간
 * 상품만 주는 게 아니라, 일부 키워드만 겹쳐도 점수를 매겨 끼워 넣는다 — 예를 들어
 * "drawing robot"으로 검색했는데 "robot"은 전혀 없고 "drawing"만 걸친 "Drawing Book"
 * 같은 상품이 섞여 나온다(실제 관측된 사례). eBay 쪽에 더 엄격한 매칭을 강제하는
 * 공식 불리언 연산자가 없으므로, 받아온 제목에 검색어의 의미 있는 단어가 전부(또는
 * 최소 과반수) 들어있는지 우리 쪽에서 직접 걸러낸다 — lib/kipris.ts의 isRelevant와
 * 같은 접근이다. 그래서 필터링으로 개수가 줄어드는 걸 감안해 API에는 limit보다 넉넉히
 * 요청한 뒤, 관련 있는 것만 골라 limit개로 자른다.
 */
function significantTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
}

function matchCount(title: string, tokens: string[]): number {
  const lower = title.toLowerCase();
  return tokens.filter((t) => lower.includes(t)).length;
}

/**
 * 먼저 모든 의미 있는 단어가 제목에 들어간 상품만 남기고, 그러면 하나도 안 남을 때만
 * "과반수 이상 일치"로 한 단계 완화한다 — 완전히 무관한 상품(일치 0~1개)이 섞여
 * 나오는 것만 막으면 되고, 짧은 검색어(단어 1~2개)에서 지나치게 0건이 되는 것도
 * 피해야 하기 때문이다.
 */
function filterRelevant(items: ShoppingProduct[], tokens: string[]): ShoppingProduct[] {
  if (tokens.length === 0) return items;
  const strict = items.filter((item) => matchCount(item.title, tokens) === tokens.length);
  if (strict.length > 0) return strict;
  const threshold = Math.ceil(tokens.length / 2);
  return items.filter((item) => matchCount(item.title, tokens) >= threshold);
}

export async function searchShopping(query: string, limit = 10): Promise<ShoppingSearchResult> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: true, items: [], skipped: true };
  }

  const trimmed = query.trim();
  if (!trimmed) return { ok: true, items: [] };

  try {
    const token = await getAccessToken(clientId, clientSecret);
    if (!token) {
      const error = "eBay 인증 토큰을 발급받지 못했습니다.";
      console.warn(`[ebay] ${error}`);
      return { ok: false, items: [], error };
    }

    const fetchLimit = Math.min(limit * 3, 50);
    const url = `${searchUrl()}?q=${encodeURIComponent(trimmed)}&limit=${fetchLimit}`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": process.env.EBAY_MARKETPLACE_ID || "EBAY_US",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const error = `eBay 검색 실패: ${res.status} ${text}`.slice(0, 300);
      console.warn(`[ebay] ${error}`);
      return { ok: false, items: [], error };
    }

    const data = (await res.json()) as { itemSummaries?: EbayItemSummary[] };
    const rawItems = (data.itemSummaries ?? []).map(mapItem);
    const tokens = significantTokens(trimmed);
    const items = filterRelevant(rawItems, tokens).slice(0, limit);
    const noiseCount = rawItems.length - items.length;
    console.log(
      `[ebay] query="${trimmed}" → ${rawItems.length}건 (관련 ${items.length}건${noiseCount > 0 ? `, 무관한 결과 ${noiseCount}건 제외` : ""})`,
    );
    return { ok: true, items, queryUsed: trimmed, queriesTried: [trimmed] };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn(`[ebay] 검색 중 오류: ${error}`);
    return { ok: false, items: [], error };
  }
}

const SHOPPING_TOKEN_SKIP = new Set([
  "for",
  "the",
  "and",
  "with",
  "sale",
  "new",
  "from",
  "that",
  "this",
  "your",
  "위한",
  "통해",
  "있는",
  "하는",
  "그리고",
]);

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !SHOPPING_TOKEN_SKIP.has(token));
}

function tokensOverlap(left: string[], right: Set<string>): boolean {
  for (const token of left) {
    if (right.has(token)) return true;
    if (token.length < 3) continue;
    for (const other of right) {
      if (other.length >= 3 && (token.includes(other) || other.includes(token))) return true;
    }
  }
  return false;
}

/**
 * 제목이 사용자 아이디어와도, 지팡이가 아닌 쇼핑 검색어와도 안 겹치면 버린다.
 * 전부 걸러지면 다른 분야 목록을 남기지 않고 빈 배열을 돌려준다.
 */
export function filterProductsByIdeaOverlap(
  items: ShoppingProduct[],
  ideaText: string,
  queries: string[],
): ShoppingProduct[] {
  const ideaTokens = new Set(contentTokens(ideaText));
  const allowCane = ideaMentionsCane(ideaText);
  const queryTokens = new Set(
    queries.filter((query) => allowCane || !textMentionsCaneLeak(query)).flatMap(contentTokens),
  );
  return items.filter((item) => {
    if (!allowCane && textMentionsCaneLeak(item.title)) return false;
    const titleTokens = contentTokens(item.title);
    return tokensOverlap(titleTokens, ideaTokens) || tokensOverlap(titleTokens, queryTokens);
  });
}

/** 중복을 빼고 AI를 지운 뒤 최대 3개. 호출 순서와 무관하게 같은 입력이면 같은 목록이다. */
export function planShoppingQueries(queries: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const trimmed = query.replace(/\bAI\b/gi, " ").replace(/\s+/g, " ").trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique.slice(0, 3);
}

function productKey(title: string): string {
  const skip = new Set(["for", "the", "and", "with", "sale", "new", "us", "ffs"]);
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !skip.has(word))
    .slice(0, 4)
    .join(" ");
}

/**
 * 준비한 영어 검색어를 동시에 친다. 검색어마다 서로 다른 상품을 최대 4개만 합친다.
 * 한 검색어가 먼저 끝나도 나머지를 기다렸다가 합치므로, 벽시계 시간은 가장 느린 검색어에 가깝다.
 */
export async function searchShoppingQueries(
  queries: string[],
  limit = 10,
  ideaText = "",
): Promise<ShoppingSearchResult> {
  const planned = planShoppingQueries(queries);
  if (planned.length === 0) return { ok: true, items: [], queryUsed: null, queriesTried: [] };

  const results = await Promise.all(planned.map((query) => searchShopping(query, limit)));
  if (results.some((result) => result.skipped)) {
    const skipped = results.find((result) => result.skipped);
    return { ok: true, items: [], skipped: true, queryUsed: planned[0] ?? null, queriesTried: planned, error: skipped?.error };
  }

  const merged: ShoppingProduct[] = [];
  const titleSeen = new Set<string>();
  let lastError: string | undefined;
  let sawOk = false;
  for (const result of results) {
    if (!result.ok) {
      lastError = result.error;
      continue;
    }
    sawOk = true;
    let added = 0;
    for (const item of result.items) {
      if (added >= 4 || merged.length >= limit) break;
      const key = productKey(item.title);
      if (!key || titleSeen.has(key)) continue;
      titleSeen.add(key);
      merged.push(item);
      added += 1;
    }
  }

  const items = ideaText.trim() ? filterProductsByIdeaOverlap(merged, ideaText, planned) : merged;
  if (items.length > 0) {
    return { ok: true, items, queryUsed: planned[0] ?? null, queriesTried: planned };
  }
  if (!sawOk && lastError) {
    return { ok: false, items: [], error: lastError, queryUsed: planned[0] ?? null, queriesTried: planned };
  }
  return { ok: true, items: [], queryUsed: planned[0] ?? null, queriesTried: planned };
}
