"use client";

import { SparkleIcon } from "./ui";
import { cn } from "@/lib/utils";

export function AiToggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition",
        checked
          ? "border-sky-300 bg-sky-50 text-sky-800"
          : "border-border bg-card text-muted-foreground hover:border-sky-200 hover:text-foreground",
      )}
    >
      <SparkleIcon className={cn("h-3.5 w-3.5", checked ? "text-sky-600" : "text-muted-foreground")} />
      AI 검색
      <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition", checked ? "bg-sky-600" : "bg-muted-foreground/40")}>
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
