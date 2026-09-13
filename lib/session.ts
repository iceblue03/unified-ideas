import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

/**
 * 구글 로그인은 검색을 막는 게이트가 아니라 "선택적 신원 식별"용이므로, NextAuth
 * 같은 인증 라이브러리(라우트 보호·미들웨어 기반 세션 갱신 등 여기선 필요 없는
 * 기능 위주) 대신 Next.js 공식 인증 가이드가 이런 DB 없는 무상태 케이스에 권장하는
 * 방식을 그대로 쓴다: jose로 서명한 JWT를 httpOnly 쿠키에 저장.
 */
export interface SessionPayload {
  email: string;
  name: string | null;
}

const COOKIE_NAME = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30일

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET이 설정되지 않았습니다.");
  return new TextEncoder().encode(secret);
}

export async function encryptSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecretKey());
}

export async function decryptSession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.email !== "string") return null;
    return { email: payload.email, name: typeof payload.name === "string" ? payload.name : null };
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return decryptSession(token);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_MAX_AGE_SECONDS = MAX_AGE_SECONDS;
