"use client";

import { useEffect, useState } from "react";
import type { SearchResponse } from "./api/search/route";
import type { Manifest } from "../lib/dataset";
import type { ResultCategory } from "../lib/types";
import { AiToggle } from "./components/AiToggle";
import { AiReportPanel } from "./components/AiReportPanel";
import { CategoryTabs } from "./components/CategoryTabs";
import { MatchCard, PatentCard, ProductCard } from "./components/ResultCards";
import { SearchIcon, Spinner, TierIcon } from "./components/ui";

const TIER_LABEL: Record<string, string> = {
  auto: "자동 수집",
  "semi-auto": "반자동 수집",
  manual: "수동 정리",
};

const TIER_ICON_BG: Record<string, string> = {
  auto: "bg-emerald-50 text-emerald-600",
  "semi-auto": "bg-amber-50 text-amber-600",
  manual: "bg-zinc-100 text-zinc-500",
};

const EXAMPLE_IDEAS = [
  "시각장애인을 위한 AI 점자 안내 지팡이",
  "공공데이터를 활용한 안전 귀가 경로 추천 서비스",
  "반려동물 건강 이상징후를 감지하는 IoT 목걸이",
];

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [useAi, setUseAi] = useState(true);
  const [activeCategory, setActiveCategory] = useState<ResultCategory>("competition");

  useEffect(() => {
    fetch("/api/manifest")
      .then((r) => r.json())
      .then(setManifest)
      .catch(() => {});
  }, []);

  const competitions = result?.manifest.competitions ?? manifest?.competitions ?? [];
  const totalItems = competitions.reduce((sum, c) => sum + c.count, 0);

  const shownCount = result ? result.results[activeCategory].length : 0;

  async function handleSearch() {
    setLoading(true);
    setError(null);
    setActiveCategory("competition");
    // 이전 검색의 AI 진단 리포트/결과 목록이 새 검색이 끝날 때까지(AI 켜짐 시 몇 초
    // 걸릴 수 있음) 화면에 남아 다른 아이디어에 대한 판단처럼 보이지 않도록 비운다.
    setResult(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, useAi }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "검색 중 오류가 발생했습니다");
        setResult(null);
      } else {
        setResult(data as SearchResponse);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "검색 중 오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-7 px-5 py-8 sm:py-10">
      <header className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white">
          <SearchIcon className="h-4 w-4" />
        </span>
        <h1 className="text-xl font-bold tracking-tight text-zinc-900">아이디어 중복 체크</h1>
      </header>

      <section className="group/search space-y-2">
        <div className="flex items-end gap-2 rounded-2xl border border-zinc-200/80 bg-white p-2.5 shadow-[0_1px_3px_rgba(24,24,27,0.06)] transition focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-500/10">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예) 시각장애인을 위한 AI 점자 안내 지팡이..."
            rows={3}
            maxLength={2000}
            className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400"
          />
          <button
            onClick={handleSearch}
            disabled={loading || query.trim().length < 2}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-zinc-900 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? <Spinner /> : <SearchIcon />}
            <span className="hidden sm:inline">검색</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <AiToggle checked={useAi} onChange={setUseAi} />
          {useAi && (
            <span className="text-[11px] font-medium text-zinc-400">
              대회·제품·특허를 한 번에 검색해요 (몇 초 더 걸릴 수 있어요)
            </span>
          )}
        </div>

        <div className="hidden flex-nowrap items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] group-focus-within/search:flex [&::-webkit-scrollbar]:hidden">
          {EXAMPLE_IDEAS.map((ex) => (
            <button
              key={ex}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setQuery(ex)}
              className="shrink-0 whitespace-nowrap rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
            >
              {ex}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between px-1">
          {error ? <p className="text-xs font-medium text-red-600">{error}</p> : <span />}
          <span className="text-[11px] font-medium text-zinc-400">{query.trim().length}/2000자</span>
        </div>
      </section>

      {loading && !result && (
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          <Spinner />
          {useAi ? "AI가 대회·제품·특허를 종합 분석 중입니다..." : "검색 중입니다..."}
        </p>
      )}

      {result && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-bold text-zinc-800">
              검색 결과 {shownCount}건
              <span className="ml-1.5 font-normal text-zinc-400">(전체 {result.totalIndexed.toLocaleString()}건 중)</span>
            </h2>
          </div>

          {result.aiMeta.report && <AiReportPanel report={result.aiMeta.report} />}

          {result.aiMeta.warnings.length > 0 && (
            <ul className="space-y-0.5">
              {result.aiMeta.warnings.map((w, i) => (
                <li key={i} className="text-xs font-medium text-zinc-400">
                  {w}
                </li>
              ))}
            </ul>
          )}

          {result.useAi && result.aiMeta.patentAvailable && result.aiMeta.kiprisQuery && (
            <p className="text-[11px] font-medium text-zinc-400">
              KIPRIS 검색어: <code className="text-zinc-500">{result.aiMeta.kiprisQuery}</code>
              {result.aiMeta.kiprisItemCount !== null && ` · ${result.aiMeta.kiprisItemCount}건`}
              {result.aiMeta.kiprisFallbackUsed && " (키워드를 줄여 재검색함)"}
            </p>
          )}

          <CategoryTabs
            active={activeCategory}
            onChange={setActiveCategory}
            competitionCount={result.results.competition.length}
            productCount={result.results.product.length}
            patentCount={result.results.patent.length}
            useAi={result.useAi}
            shoppingAvailable={result.aiMeta.shoppingAvailable}
            patentAvailable={result.aiMeta.patentAvailable}
          />

          {shownCount === 0 ? (
            <p className="text-sm text-zinc-500">
              {activeCategory === "competition" && "유사한 수상작을 찾지 못했습니다."}
              {activeCategory === "product" && "관련된 제품을 찾지 못했습니다."}
              {activeCategory === "patent" && "관련된 특허를 찾지 못했습니다."}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {activeCategory === "competition" &&
                result.results.competition.map((item, i) => <MatchCard key={item.idea.id} item={item} rank={i + 1} />)}
              {activeCategory === "product" &&
                result.results.product.map((item, i) => <ProductCard key={item.product.id} item={item} rank={i + 1} />)}
              {activeCategory === "patent" &&
                result.results.patent.map((item, i) => <PatentCard key={item.patent.id} item={item} rank={i + 1} />)}
            </ul>
          )}
        </section>
      )}

      <section className="mt-auto space-y-3 border-t border-zinc-200 pt-7">
        <h2 className="text-xs font-bold tracking-wide text-zinc-400 uppercase">
          수집 현황 (대회별) · 누적 {totalItems.toLocaleString()}건
        </h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {competitions.map((c) => (
            <li
              key={c.slug}
              className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200/70 bg-white px-3.5 py-2.5 text-[13px] shadow-[0_1px_2px_rgba(24,24,27,0.03)]"
            >
              <span className="truncate font-medium text-zinc-700">{c.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-medium text-zinc-400">{c.count.toLocaleString()}건</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${TIER_ICON_BG[c.tier]}`}
                >
                  <TierIcon tier={c.tier} />
                  {TIER_LABEL[c.tier]}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] leading-relaxed text-zinc-400">
          기본 검색(대회 탭)은 AI API를 전혀 사용하지 않는 단어 가중치(TF-IDF) 기반 유사도 방식입니다. &quot;AI
          검색&quot;을 켜면 한 번의 검색으로 KIPRIS 특허 검색과 쇼핑 API를 함께 조회하고, AI가 관련성 기준으로
          종합 진단 리포트를 만들어 보여줍니다.
        </p>
      </section>
    </main>
  );
}
