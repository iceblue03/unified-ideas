import { overlapTier } from "../../lib/score-thresholds";

export type Tone = "neutral" | "gold" | "silver" | "bronze" | "emerald" | "amber" | "red" | "sky" | "teal";

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-border bg-muted/80 text-muted-foreground",
  gold: "border-amber-200 bg-amber-50 text-amber-800",
  silver: "border-slate-300 bg-slate-100 text-slate-700",
  bronze: "border-orange-200 bg-orange-50 text-orange-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-rose-200 bg-rose-50 text-rose-800",
  sky: "border-sky-200 bg-sky-50 text-sky-800",
  teal: "border-teal-200 bg-teal-50 text-teal-800",
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
  if (tier === "high") return "#e11d48";
  if (tier === "partial") return "#d97706";
  return "#0d9488";
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

export function CheckIcon({ className = "mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} stroke="currentColor" strokeWidth="2">
      <path d="M4 10.5l3.5 3.5L16 6" strokeLinecap="round" strokeLinejoin="round" />
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

export function Spinner({ className = "h-4 w-4 animate-spin" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
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
        style={{ background: `conic-gradient(${color} ${pct}%, oklch(0.92 0.01 220) ${pct}% 100%)` }}
      />
      <div className="absolute inset-[3px] flex flex-col items-center justify-center rounded-full bg-card">
        <span className="text-[13px] font-bold leading-none text-foreground">{pct}%</span>
      </div>
    </div>
  );
}
