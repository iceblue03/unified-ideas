"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { SearchResponse, SearchStreamEvent } from "./api/search/route";
import type { Manifest } from "../lib/dataset";
import type { ResultCategory } from "../lib/types";
import { BackgroundBeams } from "@/components/ui/background-beams";
import { BentoGrid, BentoGridItem } from "@/components/ui/bento-grid";
import { FlipWords } from "@/components/ui/flip-words";
import { Button as MovingBorderButton } from "@/components/ui/moving-border";
import { Spotlight } from "@/components/ui/spotlight-new";
import { AiToggle } from "./components/AiToggle";
import { AiReportPanel } from "./components/AiReportPanel";
import { CategoryTabs } from "./components/CategoryTabs";
import { MatchCard, PatentCard, ProductCard } from "./components/ResultCards";
import { idleSearchRun, runningSearchRun, SearchProgress, type SearchRunState, type SearchStepId, type SearchStepPhase } from "./components/SearchProgress";
import { GoogleSignInButton, type GoogleUser } from "./components/GoogleSignInButton";
import { SearchIcon, Spinner, TierIcon } from "./components/ui";
import { cn } from "@/lib/utils";

const TIER_LABEL: Record<string, string> = {
  auto: "자동 수집",
  "semi-auto": "반자동 수집",
  manual: "수동 정리",
};

const TIER_ICON_BG: Record<string, string> = {
  auto: "bg-emerald-50 text-emerald-700",
  "semi-auto": "bg-amber-50 text-amber-700",
  manual: "bg-muted text-muted-foreground",
};

const EXAMPLE_IDEAS = [
  "시각장애인을 위한 AI 점자 안내 지팡이",
  "공공데이터를 활용한 안전 귀가 경로 추천 서비스",
  "반려동물 건강 이상징후를 감지하는 IoT 목걸이",
];

const FLIP_WORDS = ["대회 수상작", "유사 제품", "관련 특허"];

export default function Home() {
  const [query, setQuery] = useState("");
  const [run, setRun] = useState<SearchRunState>(idleSearchRun);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [useAi, setUseAi] = useState(true);
  const [activeCategory, setActiveCategory] = useState<ResultCategory>("competition");
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [fxReady, setFxReady] = useState(false);

  useEffect(() => {
    setFxReady(true);
  }, []);

  useEffect(() => {
    fetch("/api/manifest")
      .then((r) => r.json())
      .then(setManifest)
      .catch(() => {});
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setUser)
      .catch(() => {});
  }, []);

  function handleSignOut() {
    setUser(null);
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  }

  const competitions = result?.manifest.competitions ?? manifest?.competitions ?? [];
  const totalItems = competitions.reduce((sum, c) => sum + c.count, 0);

  const shownCount = result ? result.results[activeCategory].length : 0;
  const isSearching = run.status === "running";
  const canSearch = !isSearching && query.trim().length >= 2;
  // 검색이 시작되면(진행·결과·스트림 오류) 검색창을 상단 미니 바로 접는다.
  const isCompact = run.status !== "idle" || result !== null;

  function patchStep(id: SearchStepId, phase: SearchStepPhase) {
    setRun((prev) => ({ ...prev, steps: { ...prev.steps, [id]: phase } }));
  }

  async function handleSearch() {
    if (!canSearch) return;
    setRun(runningSearchRun(useAi));
    setError(null);
    setActiveCategory("competition");
    setResult(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, useAi }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "검색 중 오류가 발생했습니다");
        setRun(idleSearchRun());
        return;
      }
      if (!res.body) {
        setError("검색 중 오류가 발생했습니다");
        setRun(idleSearchRun());
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawTerminalEvent = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: SearchStreamEvent;
          try {
            event = JSON.parse(line);
          } catch {
            console.warn("검색 스트림 파싱 실패, 이 줄은 건너뜁니다:", line);
            continue;
          }
          switch (event.stage) {
            case "competition_started":
              patchStep("competition", "active");
              break;
            case "query_gen_started":
              patchStep("query_gen", "active");
              break;
            case "competition_done":
              patchStep("competition", "done");
              break;
            case "query_gen_done":
              patchStep("query_gen", "done");
              break;
            case "external_started":
              setRun((prev) => ({
                ...prev,
                steps: { ...prev.steps, shopping: "active", patent: "active" },
              }));
              break;
            case "shopping_done":
              patchStep("shopping", "done");
              break;
            case "patent_done":
              patchStep("patent", "done");
              break;
            case "external_search_done":
              setRun((prev) => ({
                ...prev,
                steps: { ...prev.steps, shopping: "done", patent: "done", ranking: "active" },
              }));
              break;
            case "ai_rank_done":
              break;
            case "complete":
              setResult(event.result);
              setRun((prev) => ({ ...prev, status: "done" }));
              sawTerminalEvent = true;
              break;
            case "error":
              setError(event.message);
              setRun(idleSearchRun());
              sawTerminalEvent = true;
              break;
          }
        }
      }

      if (!sawTerminalEvent) {
        setError("검색이 중단되었습니다. 다시 시도해주세요.");
        setRun((prev) => ({ ...prev, status: "stream_error" }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "검색 중 오류가 발생했습니다");
      setRun((prev) => ({ ...prev, status: "stream_error" }));
    }
  }

  function expandSearch() {
    setRun(idleSearchRun());
    setResult(null);
    setError(null);
  }

  return (
    <main className="relative flex min-h-full flex-1 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {fxReady && (
          <>
            <Spotlight />
            <BackgroundBeams className={cn("opacity-40", isCompact && "opacity-20")} />
          </>
        )}
      </div>

      <div
        className={cn(
          "relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 transition-[gap,padding] duration-500",
          isCompact ? "gap-5 py-4 sm:py-5" : "gap-8 py-8 sm:py-12",
        )}
      >
        <header className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={isCompact ? expandSearch : undefined}
            className={cn(
              "flex items-center gap-2.5 text-left",
              isCompact && "rounded-lg transition hover:opacity-80",
            )}
            title={isCompact ? "처음 화면으로" : undefined}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <SearchIcon className="h-4 w-4" />
            </span>
            <span className="font-[family-name:var(--font-brand)] text-sm font-bold tracking-tight text-foreground/70">
              Idea Check
            </span>
          </button>
          {user ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="text-xs font-medium text-muted-foreground transition hover:text-foreground hover:underline"
              title="로그아웃"
            >
              {user.name ?? user.email}
            </button>
          ) : (
            <GoogleSignInButton onSignedIn={setUser} />
          )}
        </header>

        <AnimatePresence initial={false}>
          {!isCompact && (
            <motion.section
              key="hero"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="relative space-y-5 pt-4 pb-2 text-center sm:pt-8">
                <h1 className="font-[family-name:var(--font-brand)] text-4xl leading-[1.15] font-extrabold tracking-tight text-foreground sm:text-5xl">
                  아이디어 중복 체크
                </h1>
                <div className="mx-auto flex max-w-xl flex-wrap items-center justify-center gap-x-1 text-base text-muted-foreground sm:text-lg">
                  <span>내 아이디어와</span>
                  {fxReady ? (
                    <FlipWords words={FLIP_WORDS} className="px-1 font-semibold text-sky-700 dark:text-sky-300" />
                  ) : (
                    <span className="px-1 font-semibold text-sky-700">{FLIP_WORDS[0]}</span>
                  )}
                  <span>겹침을 한눈에</span>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <motion.section layout transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="space-y-2">
          <motion.div
            layout
            className={cn(
              "border border-border/80 bg-card/90 shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur-md transition focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-500/10",
              isCompact ? "rounded-xl p-2" : "rounded-2xl p-3",
            )}
          >
            {isCompact ? (
              <div className="flex items-center gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearch();
                    }
                  }}
                  placeholder="아이디어를 입력하세요..."
                  maxLength={2000}
                  className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
                  aria-label="아이디어 입력"
                />
                <AiToggle checked={useAi} onChange={setUseAi} />
                <button
                  type="button"
                  disabled={!canSearch}
                  onClick={handleSearch}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSearching ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : <SearchIcon className="h-3.5 w-3.5" />}
                  검색
                </button>
              </div>
            ) : (
              <>
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSearch();
                    }
                  }}
                  placeholder="예) 시각장애인을 위한 AI 점자 안내 지팡이..."
                  rows={3}
                  maxLength={2000}
                  className="min-w-0 w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
                  aria-label="아이디어 입력"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
                  <AiToggle checked={useAi} onChange={setUseAi} />
                  <MovingBorderButton
                    borderRadius="0.75rem"
                    duration={3000}
                    disabled={!canSearch}
                    onClick={handleSearch}
                    containerClassName={
                      canSearch
                        ? "h-auto w-auto p-[1px] text-sm"
                        : "h-auto w-auto cursor-not-allowed p-[1px] text-sm opacity-45"
                    }
                    borderClassName="h-16 w-16 bg-[radial-gradient(#0ea5e9_40%,transparent_60%)] opacity-[0.8]"
                    className="border-border bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground antialiased backdrop-blur-xl"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {isSearching ? <Spinner /> : <SearchIcon />}
                      검색
                    </span>
                  </MovingBorderButton>
                </div>
              </>
            )}
          </motion.div>

          <AnimatePresence initial={false}>
            {!isCompact && (
              <motion.div
                key="search-extras"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-3 overflow-hidden"
              >
                {useAi && (
                  <p className="px-1 text-center text-[11px] font-medium text-muted-foreground">
                    대회·제품·특허를 한 번에 검색해요 · Ctrl/⌘+Enter로 실행
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {EXAMPLE_IDEAS.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => setQuery(ex)}
                      className="shrink-0 rounded-full border border-dashed border-border bg-card/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between px-1">
            {error ? (
              <p className="flex items-center gap-2 text-xs font-medium text-rose-600" role="alert">
                {error}
                {run.status === "stream_error" && (
                  <button type="button" onClick={handleSearch} className="underline hover:text-rose-700">
                    다시 시도
                  </button>
                )}
              </p>
            ) : (
              <span />
            )}
            {!isCompact && (
              <span className="text-[11px] font-medium text-muted-foreground">{query.trim().length}/2000자</span>
            )}
          </div>
        </motion.section>

        {isSearching && !result && (
          useAi ? (
            <SearchProgress run={run} />
          ) : (
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              검색 중입니다...
            </p>
          )
        )}

        {result && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="font-[family-name:var(--font-brand)] text-lg font-bold text-foreground">
                검색 결과 {shownCount}건
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  (전체 {result.totalIndexed.toLocaleString()}건 중)
                </span>
              </h2>
            </div>

            {result.aiMeta.report && <AiReportPanel report={result.aiMeta.report} />}

            {result.aiMeta.warnings.length > 0 && (
              <ul className="space-y-0.5 rounded-xl border border-amber-200/70 bg-amber-50/50 px-3 py-2">
                {result.aiMeta.warnings.map((w, i) => (
                  <li key={i} className="text-xs font-medium text-amber-800/80">
                    {w}
                  </li>
                ))}
              </ul>
            )}

            {result.useAi && (result.aiMeta.kiprisKeywords?.length || result.aiMeta.shoppingQuery) && (
              <div className="space-y-0.5 text-[11px] font-medium text-muted-foreground">
                {result.aiMeta.kiprisKeywords && result.aiMeta.kiprisKeywords.length > 0 && (
                  <p>
                    특허 키워드:{" "}
                    <code className="text-foreground/70">{result.aiMeta.kiprisKeywords.join(", ")}</code>
                  </p>
                )}
                {result.aiMeta.kiprisAltKeywords && result.aiMeta.kiprisAltKeywords.length > 0 && (
                  <p>
                    동의어:{" "}
                    <code className="text-foreground/70">{result.aiMeta.kiprisAltKeywords.join(", ")}</code>
                  </p>
                )}
                {result.aiMeta.patentAvailable && result.aiMeta.kiprisQuery && (
                  <p>
                    KIPRIS 검색어: <code className="text-foreground/70">{result.aiMeta.kiprisQuery}</code>
                    {result.aiMeta.kiprisItemCount !== null && ` · ${result.aiMeta.kiprisItemCount}건`}
                    {result.aiMeta.kiprisFallbackUsed && " (다른 키워드 조합으로 재검색함)"}
                  </p>
                )}
                {result.aiMeta.shoppingAvailable && result.aiMeta.shoppingQueries && result.aiMeta.shoppingQueries.length > 0 && (
                  <p>
                    상품 검색어:{" "}
                    <code className="text-foreground/70">{result.aiMeta.shoppingQueries.join(" → ")}</code>
                    {result.aiMeta.shoppingItemCount !== null && ` · ${result.aiMeta.shoppingItemCount}건`}
                  </p>
                )}
              </div>
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
              <div className="rounded-2xl border border-dashed border-border bg-card/50 px-5 py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  {activeCategory === "competition" && "유사한 수상작을 찾지 못했습니다."}
                  {activeCategory === "product" &&
                    (result.aiMeta.shoppingAvailable && result.aiMeta.shoppingItemCount === null
                      ? "제품 검색에 실패했습니다. 잠시 후 다시 시도해주세요."
                      : "관련된 제품을 찾지 못했습니다.")}
                  {activeCategory === "patent" &&
                    (result.aiMeta.patentAvailable && result.aiMeta.kiprisItemCount === null
                      ? "특허 검색에 실패했습니다. 잠시 후 다시 시도해주세요."
                      : "관련된 특허를 찾지 못했습니다.")}
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {activeCategory === "competition" &&
                  result.results.competition.map((item, i) => (
                    <MatchCard key={item.idea.id} item={item} rank={i + 1} />
                  ))}
                {activeCategory === "product" &&
                  result.results.product.map((item, i) => (
                    <ProductCard key={item.product.id} item={item} rank={i + 1} />
                  ))}
                {activeCategory === "patent" &&
                  result.results.patent.map((item, i) => (
                    <PatentCard key={item.patent.id} item={item} rank={i + 1} />
                  ))}
              </ul>
            )}
          </motion.section>
        )}

        <section className={cn("mt-auto space-y-4 border-t border-border/70", isCompact ? "pt-6" : "pt-8")}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-[family-name:var(--font-brand)] text-sm font-bold text-foreground">수집 현황</h2>
            <p className="text-xs text-muted-foreground">누적 {totalItems.toLocaleString()}건 · 대회별</p>
          </div>
          <BentoGrid className="mx-0 max-w-none gap-3 md:auto-rows-auto md:grid-cols-2">
            {competitions.map((c) => (
              <BentoGridItem
                key={c.slug}
                className="!space-y-0 rounded-xl border-border/80 bg-card/80 p-3.5 shadow-none hover:shadow-md"
                title={
                  <span className="flex items-center justify-between gap-2 text-[13px] font-semibold text-foreground">
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 font-medium text-muted-foreground">{c.count.toLocaleString()}건</span>
                  </span>
                }
                description={
                  <span
                    className={`mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${TIER_ICON_BG[c.tier]}`}
                  >
                    <TierIcon tier={c.tier} />
                    {TIER_LABEL[c.tier]}
                  </span>
                }
              />
            ))}
          </BentoGrid>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            기본 검색(대회 탭)은 AI API를 전혀 사용하지 않는 단어 가중치(TF-IDF) 기반 유사도 방식입니다. &quot;AI
            검색&quot;을 켜면 한 번의 검색으로 KIPRIS 특허 검색과 쇼핑 API를 함께 조회하고, AI가 관련성 기준으로
            종합 진단 리포트를 만들어 보여줍니다.
          </p>
        </section>
      </div>
    </main>
  );
}
