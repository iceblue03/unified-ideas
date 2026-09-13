import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "../../../../lib/session";

// page.tsx는 클라이언트 컴포넌트라 httpOnly 세션 쿠키를 직접 읽을 수 없으므로,
// 마운트 시 이 엔드포인트로 로그인 상태를 복원한다.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  return NextResponse.json(session ?? null);
}
