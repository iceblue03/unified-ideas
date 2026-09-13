"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

export interface GoogleUser {
  email: string;
  name: string | null;
}

interface CredentialResponse {
  credential: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: { client_id: string; callback: (res: CredentialResponse) => void }): void;
          renderButton(el: HTMLElement, options: { type: string; size: string; text: string }): void;
        };
      };
    };
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/**
 * 로그인은 검색을 막는 게이트가 아니라 선택 사항이다 — 여기서 신원을 밝히지
 * 않아도 검색은 익명(anon_id 쿠키)으로 그대로 동작한다. 로그인하면 이후 검색
 * 로그의 identity 컬럼이 실제 이메일로 바뀐다.
 */
export function GoogleSignInButton({ onSignedIn }: { onSignedIn: (user: GoogleUser) => void }) {
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!CLIENT_ID || !buttonRef.current || !window.google) return;
    renderButton();
  });

  function renderButton() {
    if (!CLIENT_ID || !buttonRef.current || !window.google) return;
    window.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: async (res) => {
        try {
          const r = await fetch("/api/auth/google", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credential: res.credential }),
          });
          if (!r.ok) return;
          const user = (await r.json()) as GoogleUser;
          onSignedIn(user);
        } catch {
          // 로그인 실패는 조용히 무시 — 익명 검색은 계속 정상 동작해야 한다.
        }
      },
    });
    window.google.accounts.id.renderButton(buttonRef.current, { type: "standard", size: "medium", text: "signin" });
  }

  if (!CLIENT_ID) return null;

  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={renderButton} />
      <div ref={buttonRef} />
    </>
  );
}
