import { NextRequest, NextResponse } from "next/server";
import { verifyGoogleIdToken } from "../../../../lib/google-auth";
import { encryptSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "../../../../lib/session";

export async function POST(req: NextRequest) {
  let body: { credential?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const credential = typeof body.credential === "string" ? body.credential : null;
  if (!credential) {
    return NextResponse.json({ error: "credential이 필요합니다" }, { status: 400 });
  }

  // audience(우리 Client ID) 검증에 실패하면(다른 서비스용 토큰, 서명 불일치,
  // 만료 등) 반드시 여기서 끝내야 한다 — 실패를 넘기고 세션을 만들면 안 된다.
  const user = await verifyGoogleIdToken(credential);
  if (!user) {
    return NextResponse.json({ error: "구글 로그인 검증에 실패했습니다" }, { status: 401 });
  }

  const token = await encryptSession({ email: user.email, name: user.name });
  const response = NextResponse.json({ email: user.email, name: user.name });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
