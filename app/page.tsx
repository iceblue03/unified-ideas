"use client";

import { useEffect, useMemo, useState } from "react";
import type { SearchResponse, SearchMatch } from "./api/search/route";
import type { AiReviewResult } from "./api/ai-review/route";
import type { Manifest } from "../lib/dataset";

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

const NOVELTY_META: Record<
  AiReviewResult["noveltyLevel"],
  { label: string; tone: "emerald" | "amber" | "red" }
> = {
  high: { label: "참신도 높음", tone: "emerald" },
  medium: { label: "참신도 보통", tone: "amber" },
  low: { label: "참신도 낮음", tone: "red" },
};

const EXAMPLE_IDEAS = [
  "시각장애인을 위한 AI 점자 안내 지팡이",
  "공공데이터를 활용한 안전 귀가 경로 추천 서비스",
  "반려동물 건강 이상징후를 감지하는 IoT 목걸이",
];

type Tone = "neutral" | "gold" | "silver" | "bronze" | "emerald" | "amber" | "red" | "violet" | "blue" | "indigo";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-zinc-200 bg-zinc-100/80 text-zinc-600",
  gold: "border-amber-200 bg-amber-50 text-amber-700",
  silver: "border-zinc-300 bg-zinc-100 text-zinc-700",
  bronze: "border-orange-200 bg-orange-50 text-orange-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
};

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-4 ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

function awardTone(award: string | null): Tone {
  if (!award) return "neutral";
  if (/대상|금상|최우수/.test(award)) return "gold";
  if (/은상|우수상/.test(award)) return "silver";
  if (/동상|장려/.test(award)) return "bronze";
  return "neutral";
}

function scoreHex(score: number): string {
  if (score >= 0.45) return "#ef4444";
  if (score >= 0.28) return "#f59e0b";
  return "#10b981";
}

function scoreLabel(score: number): string {
  if (score >= 0.45) return "많이 겹침";
  if (score >= 0.28) return "일부 겹침";
  return "낮은 유사도";
}

function SearchIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} stroke="currentColor" strokeWidth="1.8">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M17 17l-4-4" strokeLinecap="round" />
    </svg>
  );
}

function SparkleIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10 2l1.6 4.9L16.5 8.5l-4.9 1.6L10 15l-1.6-4.9L3.5 8.5l4.9-1.6L10 2z" />
      <path d="M16.5 13l.8 2.2L19.5 16l-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" opacity="0.7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" stroke="currentColor" strokeWidth="2">
      <path d="M4 10.5l3.5 3.5L16 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" stroke="currentColor" strokeWidth="2">
      <path d="M10 3v14M4 7l6-4 6 4M4 13l6 4 6-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TierIcon({ tier }: { tier: string }) {
  if (tier === "auto") {
    return (
      <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2">
        <path d="M4 10.5l3.5 3.5L16 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tier === "semi-auto") {
    return (
      <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2">
        <path d="M10 3v7l4 2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="10" cy="10" r="7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2">
      <path d="M13.5 3.5l3 3L6 17H3v-3z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ScoreRing({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = scoreHex(score);
  return (
    <div className="relative h-14 w-14 shrink-0">
      <div
        className="h-full w-full rounded-full"
        style={{ background: `conic-gradient(${color} ${pct}%, #ececf0 ${pct}% 100%)` }}
      />
      <div className="absolute inset-[3px] flex flex-col items-center justify-center rounded-full bg-white">
        <span className="text-[13px] font-bold leading-none text-zinc-900">{pct}%</span>
      </div>
    </div>
  );
}

function MatchCard({ match, rank }: { match: SearchMatch; rank: number }) {
  const { idea, score } = match;
  return (
    <li className="group rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.04)] transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_8px_24px_rgba(79,70,229,0.10)] sm:p-5">
      <div className="flex items-start gap-4">
        <ScoreRing score={score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-[10px] font-bold text-white">
              {rank}
            </span>
            <Chip tone="indigo">{idea.competitionName}</Chip>
            {idea.year && <Chip tone="neutral">{idea.year}</Chip>}
            {idea.award && <Chip tone={awardTone(idea.award)}>{idea.award}</Chip>}
            <span className="ml-auto shrink-0 text-[11px] font-medium text-zinc-400 sm:hidden">
              {scoreLabel(score)}
            </span>
          </div>
          <p className="mt-2 font-semibold text-zinc-900 break-words">{idea.title}</p>
          {idea.summary && (
            <p className="mt-1 text-sm leading-relaxed text-zinc-500 line-clamp-2 break-words">{idea.summary}</p>
          )}
          {(idea.team || idea.org) && (
            <p className="mt-1.5 text-xs text-zinc-400">
              {[idea.team, idea.org].filter(Boolean).join(" · ")}
            </p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <span className="hidden text-[11px] font-medium text-zinc-400 sm:inline">{scoreLabel(score)}</span>
            {idea.sourceUrl && (
              <a
                href={idea.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                출처 보기 →
              </a>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function AiResultPanel({ ai, candidates }: { ai: AiReviewResult; candidates: SearchMatch[] }) {
  const noveltyMeta = NOVELTY_META[ai.noveltyLevel];
  const topCandidate =
    ai.topMatch && ai.topMatch.candidateIndex >= 1 && ai.topMatch.candidateIndex <= candidates.length
      ? candidates[ai.topMatch.candidateIndex - 1]
      : null;

  const hasStructuredContent = ai.noveltySummary || ai.tags.length > 0 || topCandidate;

  return (
    <div className="space-y-4 rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-white p-5 shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
          <SparkleIcon className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs font-bold tracking-wide text-violet-700 uppercase">AI 정밀 분석 결과</span>
      </div>

      {hasStructuredContent ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={noveltyMeta.tone}>{noveltyMeta.label}</Chip>
            {ai.tags.map((tag) => (
              <Chip key={tag} tone="violet">
                {tag}
              </Chip>
            ))}
          </div>
          {ai.noveltySummary && <p className="text-sm leading-relaxed text-zinc-700">{ai.noveltySummary}</p>}

          {topCandidate && ai.topMatch && (
            <div className="space-y-3.5 rounded-xl border-2 border-violet-300/70 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-violet-700 uppercase">
                <SparkleIcon className="h-3.5 w-3.5" />
                가장 유사한 수상작
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900 break-words">{topCandidate.idea.title}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {topCandidate.idea.competitionName}
                  {topCandidate.idea.year ? ` · ${topCandidate.idea.year}` : ""}
                  {topCandidate.idea.award ? ` · ${topCandidate.idea.award}` : ""}
                  {` · 검색 유사도 ${Math.round(topCandidate.score * 100)}%`}
                </p>
              </div>

              {ai.topMatch.coreIdea && (
                <blockquote className="rounded-lg border border-violet-200 bg-violet-50 px-3.5 py-2.5 text-sm leading-relaxed text-violet-900">
                  💡 핵심 아이디어: “{ai.topMatch.coreIdea}”
                </blockquote>
              )}

              {(ai.topMatch.similarities.length > 0 || ai.topMatch.differences.length > 0) && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {ai.topMatch.similarities.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-bold tracking-wide text-emerald-700 uppercase">유사한 점</p>
                      <ul className="space-y-1.5">
                        {ai.topMatch.similarities.map((s) => (
                          <li key={s} className="flex gap-1.5 text-[13px] leading-relaxed text-zinc-700">
                            <CheckIcon />
                            <span className="break-words">{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {ai.topMatch.differences.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-bold tracking-wide text-blue-700 uppercase">다른 점</p>
                      <ul className="space-y-1.5">
                        {ai.topMatch.differences.map((d) => (
                          <li key={d} className="flex gap-1.5 text-[13px] leading-relaxed text-zinc-700">
                            <SplitIcon />
                            <span className="break-words">{d}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm whitespace-pre-wrap text-violet-900">{ai.rawText}</p>
      )}
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiReviewResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [activeTab, setActiveTab] = useState<string>("overall");

  useEffect(() => {
    fetch("/api/manifest")
      .then((r) => r.json())
      .then(setManifest)
      .catch(() => {});
  }, []);

  const competitions = result?.manifest.competitions ?? manifest?.competitions ?? [];
  const totalItems = competitions.reduce((sum, c) => sum + c.count, 0);

  const tabs = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.byCompetition)
      .filter(([, matches]) => matches.length > 0)
      .map(([slug, matches]) => ({
        slug,
        name: result.manifest.competitions.find((c) => c.slug === slug)?.name ?? slug,
        count: matches.length,
      }));
  }, [result]);

  const shownMatches: SearchMatch[] =
    result == null
      ? []
      : activeTab === "overall"
        ? result.overall
        : (result.byCompetition[activeTab] ?? []);

  async function handleSearch() {
    setLoading(true);
    setError(null);
    setAiResult(null);
    setAiError(null);
    setActiveTab("overall");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
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

  async function handleAiReview() {
    if (!result) return;
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await fetch("/api/ai-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: result.query,
          candidates: result.overall.slice(0, 5).map((m) => ({
            competitionName: m.idea.competitionName,
            title: m.idea.title,
            summary: m.idea.summary,
            award: m.idea.award,
            year: m.idea.year,
            score: m.score,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error ?? "AI 분석에 실패했습니다");
      } else {
        setAiResult(data as AiReviewResult);
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI 분석 중 오류가 발생했습니다");
    } finally {
      setAiLoading(false);
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
          {error ? (
            <p className="text-xs font-medium text-red-600">{error}</p>
          ) : (
            <span />
          )}
          <span className="text-[11px] font-medium text-zinc-400">{query.trim().length}/2000자</span>
        </div>
      </section>

      {result && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-bold text-zinc-800">
              가장 유사한 수상작 {result.overall.length}건
              <span className="ml-1.5 font-normal text-zinc-400">(전체 {result.totalIndexed.toLocaleString()}건 중)</span>
            </h2>
            <button
              onClick={handleAiReview}
              disabled={aiLoading}
              className="inline-flex items-center gap-1.5 rounded-full border border-violet-300 bg-gradient-to-r from-violet-50 to-indigo-50 px-3.5 py-1.5 text-xs font-semibold text-violet-700 shadow-sm transition hover:border-violet-400 hover:shadow disabled:cursor-not-allowed disabled:opacity-40"
            >
              {aiLoading ? <Spinner /> : <SparkleIcon className="h-3.5 w-3.5" />}
              {aiLoading ? "AI 분석 중..." : "AI 정밀 분석"}
            </button>
          </div>

          {aiResult && <AiResultPanel ai={aiResult} candidates={result.overall.slice(0, 5)} />}
          {aiError && <p className="text-xs font-medium text-zinc-400">{aiError}</p>}

          {tabs.length > 1 && (
            <div className="-mx-1 flex flex-wrap gap-1 overflow-x-auto px-1 pb-1">
              <button
                onClick={() => setActiveTab("overall")}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  activeTab === "overall"
                    ? "bg-zinc-900 text-white shadow-sm"
                    : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                }`}
              >
                전체 {result.overall.length}
              </button>
              {tabs.map((t) => (
                <button
                  key={t.slug}
                  onClick={() => setActiveTab(t.slug)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === t.slug
                      ? "bg-zinc-900 text-white shadow-sm"
                      : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                  }`}
                >
                  {t.name} {t.count}
                </button>
              ))}
            </div>
          )}

          {shownMatches.length === 0 ? (
            <p className="text-sm text-zinc-500">유사한 수상작을 찾지 못했습니다.</p>
          ) : (
            <ul className="space-y-2.5">
              {shownMatches.map((m, i) => (
                <MatchCard key={m.idea.id} match={m} rank={i + 1} />
              ))}
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
          기본 검색은 AI API를 전혀 사용하지 않는 단어 가중치(TF-IDF) 기반 유사도 방식이며, &quot;AI 정밀
          분석&quot;을 눌렀을 때만 상위 후보 5건에 한해 무료 AI 모델을 호출합니다.
        </p>
      </section>
    </main>
  );
}
