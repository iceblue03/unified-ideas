"use client";

import { CATEGORY_LABEL } from "../../lib/types";
import type { AiReport, ResultCategory, Verdict } from "../../lib/types";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Chip, SparkleIcon, type Tone } from "./ui";

const VERDICT_META: Record<Verdict, { label: string; tone: Tone }> = {
  exists: { label: "이미 비슷한 사례가 있어요", tone: "red" },
  partial: { label: "일부 겹치는 부분이 있어요", tone: "amber" },
  blue_ocean: { label: "블루오션이에요", tone: "emerald" },
};

const CATEGORY_TONE: Record<ResultCategory, Tone> = {
  competition: "sky",
  product: "teal",
  patent: "sky",
};

export function AiReportPanel({ report }: { report: AiReport }) {
  const verdictMeta = VERDICT_META[report.verdict];
  const hasDiagnosis = report.summary || report.tags.length > 0 || report.topMatches.length > 0;

  return (
    <div className="relative rounded-2xl border border-sky-200/70 bg-gradient-to-br from-sky-50/80 via-card to-teal-50/40 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <GlowingEffect
        spread={36}
        glow
        disabled={false}
        proximity={72}
        inactiveZone={0.05}
        borderWidth={1.5}
      />
      <div className="relative z-10 space-y-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <SparkleIcon className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs font-bold tracking-wide text-sky-800 uppercase">AI 진단 리포트</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={verdictMeta.tone}>{verdictMeta.label}</Chip>
          {report.tags.map((tag) => (
            <Chip key={tag} tone="sky">
              {tag}
            </Chip>
          ))}
        </div>

        {report.summary && <p className="text-sm leading-relaxed text-foreground/85">{report.summary}</p>}

        {report.topMatches.length > 0 && (
          <div className="space-y-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-sky-800 uppercase">
              <SparkleIcon className="h-3.5 w-3.5" />
              가장 관련성 높은 {report.topMatches.length}건
            </p>
            {report.topMatches.map((match, i) => {
              const body = (
                <div className="rounded-xl border border-sky-200/60 bg-card/90 p-3.5 shadow-sm transition hover:border-sky-300">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tone={CATEGORY_TONE[match.type]}>{CATEGORY_LABEL[match.type]}</Chip>
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      관련도 {Math.round(match.similarity * 100)}%
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold break-words text-foreground">{match.title}</p>
                  {match.meta && <p className="mt-0.5 text-xs text-muted-foreground">{match.meta}</p>}
                  {match.reason && (
                    <p className="mt-1.5 text-[13px] leading-relaxed break-words text-foreground/75">{match.reason}</p>
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
          <p className="whitespace-pre-wrap text-sm text-sky-950">{report.rawText}</p>
        )}
      </div>
    </div>
  );
}
