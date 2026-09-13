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

async function getAccessToken(clientId: string, clientSecret: string): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
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
    if (!res.ok) return null;

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;

    cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000 };
    return cachedToken.value;
  } catch {
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
      return { ok: false, items: [], error: "eBay 인증 토큰을 발급받지 못했습니다." };
    }

    const url = `${searchUrl()}?q=${encodeURIComponent(trimmed)}&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": process.env.EBAY_MARKETPLACE_ID || "EBAY_US",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, items: [], error: `eBay 검색 실패: ${res.status} ${text}`.slice(0, 300) };
    }

    const data = (await res.json()) as { itemSummaries?: EbayItemSummary[] };
    const items = (data.itemSummaries ?? []).map(mapItem);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) };
  }
}
