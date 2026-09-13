import { OAuth2Client } from "google-auth-library";

/**
 * Google Identity Services(GIS)가 클라이언트에서 발급한 ID 토큰을 서버에서
 * 검증한다. GIS의 ID 토큰 플로우는 클라이언트/서버 모두 Client ID만 있으면 되고
 * Client Secret이 필요 없다 — 로그인 전용이라 별도 비밀값 관리가 필요 없다.
 *
 * audience를 반드시 우리 Client ID로 고정해서 검증해야 한다 — 그렇지 않으면
 * 다른 구글 서비스용으로 발급된, 서명은 유효하지만 우리 앱을 위한 게 아닌
 * 토큰으로도 세션이 만들어지는 보안 문제가 생긴다.
 */
let client: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID가 설정되지 않았습니다.");
  if (!client) client = new OAuth2Client(clientId);
  return client;
}

export interface VerifiedGoogleUser {
  email: string;
  name: string | null;
}

/**
 * 검증에 실패하면(서명 불일치, audience 불일치, 만료 등) null을 반환한다 — 호출
 * 쪽에서 이 경우 반드시 401을 반환하고 세션을 만들지 않아야 한다(실패를 조용히
 * 넘기고 기본 세션을 만들면 안 됨).
 */
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleUser | null> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) return null;

  try {
    const ticket = await getClient().verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.email) return null;
    if (payload.email_verified === false) return null;
    return { email: payload.email, name: payload.name ?? null };
  } catch {
    return null;
  }
}
