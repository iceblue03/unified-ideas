import { overlapTier } from "../../lib/score-thresholds";

export type Tone = "neutral" | "gold" | "silver" | "bronze" | "emerald" | "amber" | "red" | "violet" | "blue" | "indigo";

export const TONE_CLASSES: Record<Tone, string> = {
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

export function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-4 ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

export function awardTone(award: string | null): Tone {
  if (!award) return "neutral";
  if (/대상|금상|최우수/.test(award)) return "gold";
  if (/은상|우수상/.test(award)) return "silver";
  if (/동상|장려/.test(award)) return "bronze";
  return "neutral";
}

export function scoreHex(score: number): string {
  const tier = overlapTier(score);
  if (tier === "high") return "#ef4444";
  if (tier === "partial") return "#f59e0b";
  return "#10b981";
}

export function scoreLabel(score: number): string {
  const tier = overlapTier(score);
  if (tier === "high") return "많이 겹침";
  if (tier === "partial") return "일부 겹침";
  return "낮은 유사도";
}

export function SearchIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} stroke="currentColor" strokeWidth="1.8">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M17 17l-4-4" strokeLinecap="round" />
    </svg>
  );
}

export function SparkleIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10 2l1.6 4.9L16.5 8.5l-4.9 1.6L10 15l-1.6-4.9L3.5 8.5l4.9-1.6L10 2z" />
      <path d="M16.5 13l.8 2.2L19.5 16l-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" opacity="0.7" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" stroke="currentColor" strokeWidth="2">
      <path d="M4 10.5l3.5 3.5L16 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SplitIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" stroke="currentColor" strokeWidth="2">
      <path d="M10 3v14M4 7l6-4 6 4M4 13l6 4 6-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TierIcon({ tier }: { tier: string }) {
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

export function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ScoreRing({ score }: { score: number }) {
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
