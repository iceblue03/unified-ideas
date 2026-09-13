import { CATEGORY_LABEL } from "../../lib/types";
import type { AiReport, ResultCategory, Verdict } from "../../lib/types";
import { Chip, SparkleIcon, type Tone } from "./ui";

const VERDICT_META: Record<Verdict, { label: string; tone: Tone }> = {
  exists: { label: "이미 비슷한 사례가 있어요", tone: "red" },
  partial: { label: "일부 겹치는 부분이 있어요", tone: "amber" },
  blue_ocean: { label: "블루오션이에요", tone: "emerald" },
};

const CATEGORY_TONE: Record<ResultCategory, Tone> = {
  competition: "indigo",
  product: "blue",
  patent: "violet",
};

export function AiReportPanel({ report }: { report: AiReport }) {
  const verdictMeta = VERDICT_META[report.verdict];
  // summary/tags/topMatches가 전부 비어 있으면 AI 호출 자체가 실패한 경우(예: 키 미설정) —
  // 이때 verdict는 로컬 점수 기반 추정치이므로 배지만 보여주고, rawText가 있을 때만(모델이
  // 응답은 했지만 JSON 파싱에 실패한 경우) 원문을 최후의 폴백으로 보여준다.
  const hasDiagnosis = report.summary || report.tags.length > 0 || report.topMatches.length > 0;

  return (
    <div className="space-y-4 rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-white p-5 shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
          <SparkleIcon className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs font-bold tracking-wide text-violet-700 uppercase">AI 진단 리포트</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={verdictMeta.tone}>{verdictMeta.label}</Chip>
        {report.tags.map((tag) => (
          <Chip key={tag} tone="violet">
            {tag}
          </Chip>
        ))}
      </div>

      {report.summary && <p className="text-sm leading-relaxed text-zinc-700">{report.summary}</p>}

      {report.topMatches.length > 0 && (
        <div className="space-y-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-violet-700 uppercase">
            <SparkleIcon className="h-3.5 w-3.5" />
            가장 관련성 높은 {report.topMatches.length}건
          </p>
          {report.topMatches.map((match, i) => {
            const body = (
              <div className="rounded-xl border border-violet-200/70 bg-white p-3.5 shadow-sm transition hover:border-violet-300">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip tone={CATEGORY_TONE[match.type]}>{CATEGORY_LABEL[match.type]}</Chip>
                  <span className="text-[11px] font-semibold text-zinc-400">
                    관련도 {Math.round(match.similarity * 100)}%
                  </span>
                </div>
                <p className="mt-1.5 text-sm font-semibold text-zinc-900 break-words">{match.title}</p>
                {match.meta && <p className="mt-0.5 text-xs text-zinc-500">{match.meta}</p>}
                {match.reason && (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600 break-words">{match.reason}</p>
                )}
              </div>
            );
            return match.sourceUrl ? (
              <a key={i} href={match.sourceUrl} target="_blank" rel="noreferrer" className="block">
                {body}
              </a>
            ) : (
              <div key={i}>{body}</div>
            );
          })}
        </div>
      )}

      {!hasDiagnosis && report.rawText && (
        <p className="text-sm whitespace-pre-wrap text-violet-900">{report.rawText}</p>
      )}
    </div>
  );
}
