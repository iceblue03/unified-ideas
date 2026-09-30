import type { Metadata } from "next";
import { Noto_Sans_KR, Syne } from "next/font/google";
import "./globals.css";

const brand = Syne({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const sans = Noto_Sans_KR({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "아이디어 중복 체크",
  description: "국내 SW·창업 경진대회 역대 수상작과 내 아이디어가 얼마나 겹치는지 확인해보세요.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${brand.variable} ${sans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans text-foreground">{children}</body>
    </html>
  );
}
