import { SparkleIcon } from "./ui";

export function AiToggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${
        checked
          ? "border-violet-300 bg-gradient-to-r from-violet-50 to-indigo-50 text-violet-700"
          : "border-zinc-200 bg-white text-zinc-500"
      }`}
    >
      <SparkleIcon className={`h-3.5 w-3.5 ${checked ? "text-violet-600" : "text-zinc-400"}`} />
      AI 검색
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-violet-600" : "bg-zinc-300"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
