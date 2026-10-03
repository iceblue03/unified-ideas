"use client";

import { motion } from "motion/react";
import { CheckIcon, Spinner } from "./ui";

export type SearchStepId = "competition" | "query_gen" | "shopping" | "patent" | "ranking";
export type SearchStepPhase = "pending" | "active" | "done";

export type SearchRunState = {
  status: "idle" | "running" | "done" | "stream_error";
  steps: Record<SearchStepId, SearchStepPhase>;
};

const EMPTY_STEPS: Record<SearchStepId, SearchStepPhase> = {
  competition: "pending",
  query_gen: "pending",
  shopping: "pending",
  patent: "pending",
  ranking: "pending",
};

export function idleSearchRun(): SearchRunState {
  return { status: "idle", steps: { ...EMPTY_STEPS } };
}

export function runningSearchRun(useAi: boolean): SearchRunState {
  return {
    status: "running",
    steps: {
      competition: "active",
      query_gen: useAi ? "active" : "pending",
      shopping: "pending",
      patent: "pending",
      ranking: "pending",
    },
  };
}

const STEPS: { id: SearchStepId; label: string; hint: string }[] = [
  { id: "competition", label: "대회 검색", hint: "수상작 데이터셋에서 유사도 검색" },
  { id: "query_gen", label: "검색어 생성", hint: "특허·제품용 쿼리 정리" },
  { id: "shopping", label: "제품 검색", hint: "쇼핑 API 조회" },
  { id: "patent", label: "특허 검색", hint: "KIPRIS 조회" },
  { id: "ranking", label: "AI 분석", hint: "관련성 기준 종합 진단" },
];

export function SearchProgress({ run }: { run: SearchRunState }) {
  const allDone = run.status === "done";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border/80 bg-card/80 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-sm"
    >
      <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">검색 진행</p>
      <ol className="space-y-3">
        {STEPS.map((step, i) => {
          const phase = allDone ? "done" : run.steps[step.id];
          const isDone = phase === "done";
          const isActive = phase === "active";
          return (
            <li key={step.id} className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                  isDone
                    ? "border-teal-200 bg-teal-50 text-teal-700"
                    : isActive
                      ? "border-sky-300 bg-sky-50 text-sky-700"
                      : "border-border bg-muted text-muted-foreground"
                }`}
              >
                {isDone ? <CheckIcon className="h-3.5 w-3.5 text-teal-600" /> : isActive ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${isActive ? "text-foreground" : isDone ? "text-muted-foreground" : "text-muted-foreground/70"}`}>
                  {step.label}
                </p>
                {isActive && <p className="mt-0.5 text-xs text-muted-foreground">{step.hint}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </motion.div>
  );
}
