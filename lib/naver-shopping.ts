import type { ShoppingProduct } from "./types";

/**
 * 네이버 검색 API - 쇼핑 (https://developers.naver.com)
 * 무료, 일 25,000회. NAVER_CLIENT_ID/NAVER_CLIENT_SECRET이 없으면 이 데이터소스는
 * 조용히 스킵된다 (throw하지 않음) — 다른 검색 경로(대회/특허)에 영향을 주지 않기 위함.
 */

export interface ShoppingSearchResult {
  ok: boolean;
  items: ShoppingProduct[];
  skipped?: boolean;
  error?: string;
}

interface NaverShopItem {
  productId?: string;
  title?: string;
  link?: string;
  image?: string;
  lprice?: string;
  hprice?: string;
  mallName?: string;
  brand?: string;
  maker?: string;
  category1?: string;
  category2?: string;
  category3?: string;
  category4?: string;
}

function stripHtml(text: string): string {
  return text
    .replace(/<\/?b>/gi, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function toNumberOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapItem(item: NaverShopItem): ShoppingProduct {
  const category = [item.category1, item.category2, item.category3, item.category4]
    .filter((c): c is string => !!c && c.trim().length > 0)
    .join(" > ");

  return {
    id: item.productId ?? item.link ?? crypto.randomUUID(),
    title: stripHtml(item.title ?? ""),
    link: item.link ?? "",
    image: item.image || null,
    lprice: toNumberOrNull(item.lprice),
    hprice: toNumberOrNull(item.hprice),
    mallName: item.mallName || null,
    brand: item.brand || null,
    maker: item.maker || null,
    category: category || null,
  };
}

export function isShoppingConfigured(): boolean {
  return !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}

export async function searchShopping(query: string, display = 10): Promise<ShoppingSearchResult> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: true, items: [], skipped: true };
  }

  const trimmed = query.trim();
  if (!trimmed) return { ok: true, items: [] };

  try {
    const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(trimmed)}&display=${display}&sort=sim`;
    const res = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, items: [], error: `네이버쇼핑 호출 실패: ${res.status} ${text}`.slice(0, 300) };
    }

    const data = (await res.json()) as { items?: NaverShopItem[] };
    const items = (data.items ?? []).map(mapItem);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) };
  }
}
