"use client";

import { useEffect, useState } from "react";
import type { SearchResponse, SearchMatch } from "./api/search/route";
import type { Manifest } from "../lib/dataset";

const TIER_LABEL: Record<string, string> = {
  auto: "자동 수집",
  "semi-auto": "반자동 수집",
  manual: "수동 정리",
};

const TIER_COLOR: Record<string, string> = {
  auto: "bg-emerald-100 text-emerald-700",
  "semi-auto": "bg-amber-100 text-amber-700",
  manual: "bg-zinc-200 text-zinc-600",
};

function scoreColor(score: number): string {
  if (score >= 0.45) return "bg-red-500";
  if (score >= 0.28) return "bg-amber-500";
  return "bg-emerald-500";
}

function scoreLabel(score: number): string {
  if (score >= 0.45) return "많이 겹침";
  if (score >= 0.28) return "일부 겹침";
  return "낮은 유사도";
}

function MatchCard({ match }: { match: SearchMatch }) {
  const { idea, score } = match;
  const pct = Math.round(score * 100);
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">
            {idea.competitionName}
            {idea.year ? ` · ${idea.year}` : ""}
            {idea.award ? ` · ${idea.award}` : ""}
          </p>
          <p className="mt-0.5 font-medium text-zinc-900 break-words">{idea.title}</p>
          {idea.summary && (
            <p className="mt-1 text-sm text-zinc-600 line-clamp-2 break-words">{idea.summary}</p>
          )}
          {(idea.team || idea.org) && (
            <p className="mt-1 text-xs text-zinc-400">
              {[idea.team, idea.org].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold text-zinc-800">{pct}%</div>
          <div className="mt-1 h-1.5 w-16 overflow-hidden rounded-full bg-zinc-100">
            <div className={`h-full ${scoreColor(score)}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[10px] text-zinc-400">{scoreLabel(score)}</div>
        </div>
      </div>
      {idea.sourceUrl && (
        <a
          href={idea.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs text-blue-600 hover:underline"
        >
          출처 보기 →
        </a>
      )}
    </li>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);

  useEffect(() => {
    fetch("/api/manifest")
      .then((r) => r.json())
      .then(setManifest)
      .catch(() => {});
  }, []);

  async function handleSearch() {
    setLoading(true);
    setError(null);
    setAiText(null);
    setAiError(null);
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
    setAiText(null);
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
        setAiText(data.analysis);
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI 분석 중 오류가 발생했습니다");
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-5 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">아이디어 중복 체크</h1>
        <p className="text-sm text-zinc-500">
          국내 SW·창업 경진대회 역대 수상작 데이터베이스와 내 아이디어를 비교해, 이미 비슷한 시도가
          있었는지 무료로 빠르게 확인합니다. 매달 자동으로 데이터를 갱신합니다.
        </p>
      </header>

      <section className="space-y-3">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="예) 시각장애인을 위한 AI 점자 안내 지팡이, 공공데이터를 활용한 안전 경로 추천 서비스..."
          rows={5}
          className="w-full resize-none rounded-lg border border-zinc-300 bg-white p-3 text-sm outline-none focus:border-zinc-500"
        />
        <button
          onClick={handleSearch}
          disabled={loading || query.trim().length < 2}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {loading ? "검색 중..." : "유사 수상작 검색"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      {result && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">
              가장 유사한 수상작 {result.overall.length}건 (전체 {result.totalIndexed.toLocaleString()}건 중)
            </h2>
            <button
              onClick={handleAiReview}
              disabled={aiLoading}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
            >
              {aiLoading ? "AI 분석 중..." : "✨ AI 정밀 분석"}
            </button>
          </div>

          {aiText && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm whitespace-pre-wrap text-violet-900">
              {aiText}
            </div>
          )}
          {aiError && <p className="text-xs text-zinc-500">{aiError}</p>}

          {result.overall.length === 0 ? (
            <p className="text-sm text-zinc-500">유사한 수상작을 찾지 못했습니다.</p>
          ) : (
            <ul className="space-y-2">
              {result.overall.map((m) => (
                <MatchCard key={m.idea.id} match={m} />
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-auto space-y-2 border-t border-zinc-200 pt-6">
        <h2 className="text-xs font-semibold text-zinc-500">수집 현황 (대회별)</h2>
        <ul className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
          {(result?.manifest.competitions ?? manifest?.competitions ?? []).map((c) => (
            <li
              key={c.slug}
              className="flex items-center justify-between gap-2 rounded-md bg-white px-3 py-2 border border-zinc-100"
            >
              <span className="truncate text-zinc-700">{c.name}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="text-zinc-400">{c.count.toLocaleString()}건</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${TIER_COLOR[c.tier]}`}>
                  {TIER_LABEL[c.tier]}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-zinc-400">
          기본 검색은 AI API를 전혀 사용하지 않는 단어 가중치(TF-IDF) 기반 유사도 방식이며, &quot;AI 정밀
          분석&quot;을 눌렀을 때만 상위 후보 5건에 한해 무료 AI 모델을 호출합니다.
        </p>
      </section>
    </main>
  );
}
