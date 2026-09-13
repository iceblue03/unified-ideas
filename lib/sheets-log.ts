import { JWT } from "google-auth-library";

/**
 * 검색 로그를 사용자 본인 구글 드라이브의 구글 시트에 남긴다(전통적인 DB 대신).
 * 서비스 계정으로 Sheets v4 REST API를 직접 fetch로 호출한다 — googleapis
 * 패키지는 이 프로젝트가 의도적으로 가볍게 유지하는(런타임 의존성이 손에 꼽히는)
 * 방향과 맞지 않아 쓰지 않고, google-auth-library로 액세스 토큰만 받는다.
 *
 * 로그 기록은 app/api/search/route.ts에서 next/server의 after()로 응답 전송
 * 이후에 실행되므로, 여기서 발생하는 어떤 실패(레이트리밋, 인증 오류, 네트워크
 * 오류)도 절대 사용자 검색 응답을 막아서는 안 된다 — 그래서 이 파일의 함수들은
 * 실패해도 throw하지 않고 console.error만 남긴다.
 */

export interface SearchLogRow {
  timestamp: string;
  query: string;
  useAi: boolean;
  identity: string;
  loggedIn: boolean;
  competitionCount: number;
  productCount: number;
  patentCount: number;
  kiprisKeywords: string[] | null;
  kiprisQuery: string | null;
  kiprisItemCount: number | null;
  kiprisFallbackUsed: boolean;
  shoppingQuery: string | null;
  verdict: string;
  aiSummary: string;
  latencyMs: number;
  warnings: string;
}

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

let cachedClient: { jwt: JWT; expiresAt: number } | null = null;

// 서버리스 콜드 스타트로 인스턴스가 새로 뜨면 이 캐시도 자연히 초기화된다 — 매
// 요청마다 새 토큰을 받아오는 것보다는 낫지만, 완벽한 캐시 적중률은 기대하지
// 않는다. 이 프로젝트 규모에서는 받아들이는 트레이드오프다(README/AGENTS 참고
// 없이도 lib/ebay-shopping.ts의 cachedToken과 같은 패턴).
async function getAccessToken(): Promise<string | null> {
  if (cachedClient && cachedClient.expiresAt > Date.now() + 30_000) {
    const token = (await cachedClient.jwt.getAccessToken()).token;
    if (token) return token;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) return null;

  // Vercel 대시보드에 그대로 붙여넣으면 실제 개행이 유지되지만, .env.local처럼
  // 한 줄로 넣는 경우 "\n"이 리터럴 문자열로 들어오므로 둘 다 지원한다.
  const key = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;

  const jwt = new JWT({ email, key, scopes: [SHEETS_SCOPE] });
  const { token, res } = await jwt.getAccessToken();
  if (!token) return null;

  const expiresAt = Number(res?.data?.expires_in ?? 3600) * 1000 + Date.now();
  cachedClient = { jwt, expiresAt };
  return token;
}

const confirmedTabs = new Set<string>();

async function ensureMonthlySheetExists(token: string, spreadsheetId: string, tabName: string): Promise<void> {
  if (confirmedTabs.has(tabName)) return;

  const getRes = await fetch(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties.title`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!getRes.ok) throw new Error(`시트 목록 조회 실패: ${getRes.status}`);
  const data = (await getRes.json()) as { sheets?: Array<{ properties?: { title?: string } }> };
  const exists = (data.sheets ?? []).some((s) => s.properties?.title === tabName);

  if (!exists) {
    const addRes = await fetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
    });
    if (!addRes.ok) throw new Error(`시트 탭 생성 실패: ${addRes.status}`);

    const header = [
      "timestamp",
      "query",
      "useAi",
      "identity",
      "loggedIn",
      "competitionCount",
      "productCount",
      "patentCount",
      "kiprisKeywords",
      "kiprisQuery",
      "kiprisItemCount",
      "kiprisFallbackUsed",
      "shoppingQuery",
      "verdict",
      "aiSummary",
      "latencyMs",
      "warnings",
    ];
    await fetch(
      `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A1?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ values: [header] }),
      },
    );
  }

  confirmedTabs.add(tabName);
}

function rowToValues(row: SearchLogRow): (string | number | boolean)[] {
  return [
    row.timestamp,
    row.query,
    row.useAi,
    row.identity,
    row.loggedIn,
    row.competitionCount,
    row.productCount,
    row.patentCount,
    (row.kiprisKeywords ?? []).join(", "),
    row.kiprisQuery ?? "",
    row.kiprisItemCount ?? "",
    row.kiprisFallbackUsed,
    row.shoppingQuery ?? "",
    row.verdict,
    row.aiSummary,
    row.latencyMs,
    row.warnings,
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRY_DELAYS_MS = [300, 900];

async function appendSearchLog(row: SearchLogRow): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return;

  const token = await getAccessToken();
  if (!token) {
    console.error("[sheets-log] 액세스 토큰을 발급받지 못했습니다.");
    return;
  }

  const tabName = new Date(row.timestamp).toISOString().slice(0, 7); // "YYYY-MM"

  try {
    await ensureMonthlySheetExists(token, spreadsheetId, tabName);
  } catch (e) {
    console.error("[sheets-log] 탭 준비 실패:", e instanceof Error ? e.message : String(e));
    return;
  }

  const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(tabName)}!A:Q:append?valueInputOption=USER_ENTERED`;
  const body = JSON.stringify({ values: [rowToValues(row)] });

  // Sheets API는 분당 300회(프로젝트)/60회(사용자) 쓰기 제한이 있어, 순간적으로
  // 트래픽이 몰리면 429가 날 수 있다 — 짧은 지수 백오프로 최대 2회 재시도한다.
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body,
      });
      if (res.ok) return;
      if (res.status === 429 || res.status >= 500) {
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
      }
      const text = await res.text().catch(() => "");
      console.error(`[sheets-log] 기록 실패: ${res.status} ${text}`.slice(0, 300));
      return;
    } catch (e) {
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      console.error("[sheets-log] 기록 중 오류:", e instanceof Error ? e.message : String(e));
      return;
    }
  }
}

/**
 * 검색 로그를 기록하는 공개 진입점. 실제 저장 로직(구글 시트)은 이 함수 뒤에
 * 숨겨둬서, 나중에 Supabase/D1 같은 DB로 바꾸더라도 이 파일 내부만 교체하면
 * 되고 호출부(app/api/search/route.ts)는 바뀌지 않는다. 절대 throw하지 않는다.
 */
export async function logSearch(row: SearchLogRow): Promise<void> {
  try {
    await appendSearchLog(row);
  } catch (e) {
    console.error("[sheets-log] 예상치 못한 오류:", e instanceof Error ? e.message : String(e));
  }
}
