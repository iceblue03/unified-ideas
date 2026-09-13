import { CheckIcon, Spinner } from "./ui";

export type SearchStage = "idle" | "competition" | "query_gen" | "external" | "ranking" | "done" | "stream_error";

const STEPS: { stage: SearchStage; label: string }[] = [
  { stage: "competition", label: "대회 검색" },
  { stage: "query_gen", label: "검색어 생성" },
  { stage: "external", label: "특허·제품 검색" },
  { stage: "ranking", label: "AI 분석" },
];

const STEP_ORDER: SearchStage[] = STEPS.map((s) => s.stage);

/** AI 검색이 실제로 거치는 4단계를 그대로 보여준다 — 하나의 정적 스피너 대신 지금
 * 어느 단계인지 체감할 수 있게 한다. 완료된 단계는 체크마크, 진행 중인 단계는
 * 스피너로 표시한다. */
export function SearchProgress({ stage }: { stage: SearchStage }) {
  const currentIndex = STEP_ORDER.indexOf(stage);

  return (
    <ul className="flex flex-col gap-1.5 text-sm text-zinc-500">
      {STEPS.map((step, i) => {
        const isDone = currentIndex > i || stage === "done";
        const isActive = currentIndex === i;
        return (
          <li key={step.stage} className="flex items-center gap-2">
            {isDone ? <CheckIcon /> : isActive ? <Spinner /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-zinc-300" />}
            <span className={isDone ? "text-zinc-400 line-through" : isActive ? "font-medium text-zinc-700" : "text-zinc-400"}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
