"use client";

import { formatMoney } from "../../lib/types";
import type { CompetitionResultItem, PatentResultItem, ProductResultItem } from "../../lib/types";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Chip, ScoreRing, awardTone, scoreLabel } from "./ui";

function GlowCard({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative list-none rounded-2xl border border-border/80 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
      <GlowingEffect
        spread={40}
        glow
        disabled={false}
        proximity={64}
        inactiveZone={0.01}
        borderWidth={1.5}
      />
      <div className="relative z-10">{children}</div>
    </li>
  );
}

export function MatchCard({ item, rank }: { item: CompetitionResultItem; rank: number }) {
  const { idea } = item;
  const score = item.aiScore ?? item.score;
  return (
    <GlowCard>
      <div className="flex items-start gap-4">
        <ScoreRing score={score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
              {rank}
            </span>
            <Chip tone="sky">{idea.competitionName}</Chip>
            {idea.year && <Chip tone="neutral">{idea.year}</Chip>}
            {idea.award && <Chip tone={awardTone(idea.award)}>{idea.award}</Chip>}
            <span className="ml-auto shrink-0 text-[11px] font-medium text-muted-foreground sm:hidden">
              {scoreLabel(score)}
            </span>
          </div>
          <p className="mt-2 font-semibold break-words text-foreground">{idea.title}</p>
          {idea.summary && (
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed break-words text-muted-foreground">{idea.summary}</p>
          )}
          {(idea.team || idea.org) && (
            <p className="mt-1.5 text-xs text-muted-foreground/80">{[idea.team, idea.org].filter(Boolean).join(" · ")}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="hidden text-[11px] font-medium text-muted-foreground sm:inline">{scoreLabel(score)}</span>
            {idea.sourceUrl && (
              <a
                href={idea.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-xs font-medium text-sky-700 hover:underline"
              >
                출처 보기 →
              </a>
            )}
            {idea.attachments?.map((att, i) => (
              <a
                key={i}
                href={att.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                title={att.label ?? undefined}
              >
                원본 {att.kind === "image" ? "이미지" : "첨부"} 보기 →
              </a>
            ))}
          </div>
        </div>
      </div>
    </GlowCard>
  );
}

export function ProductCard({ item, rank }: { item: ProductResultItem; rank: number }) {
  const { product } = item;
  const price =
    product.lprice != null
      ? product.hprice != null && product.hprice !== product.lprice
        ? `${formatMoney(product.lprice, product.currency)}~${formatMoney(product.hprice, product.currency)}`
        : formatMoney(product.lprice, product.currency)
      : null;

  return (
    <GlowCard>
      <div className="flex items-start gap-4">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-muted text-[10px] text-muted-foreground">
            이미지 없음
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
              {rank}
            </span>
            {product.mallName && <Chip tone="teal">{product.mallName}</Chip>}
            {product.brand && <Chip tone="neutral">{product.brand}</Chip>}
          </div>
          <p className="mt-2 font-semibold break-words text-foreground">{product.title}</p>
          {price && <p className="mt-1 text-sm font-medium text-foreground/80">{price}</p>}
          {product.category && <p className="mt-1 text-xs text-muted-foreground">{product.category}</p>}
          {product.link && (
            <a
              href={product.link}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-0.5 text-xs font-medium text-sky-700 hover:underline"
            >
              쇼핑몰에서 보기 →
            </a>
          )}
        </div>
      </div>
    </GlowCard>
  );
}

export function PatentCard({ item, rank }: { item: PatentResultItem; rank: number }) {
  const { patent } = item;
  return (
    <GlowCard>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
          {rank}
        </span>
        {patent.applicationDate && <Chip tone="neutral">출원 {patent.applicationDate}</Chip>}
        {patent.registrationStatus && <Chip tone="sky">{patent.registrationStatus}</Chip>}
      </div>
      <p className="mt-2 font-semibold break-words text-foreground">{patent.title}</p>
      {patent.summary && (
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed break-words text-muted-foreground">{patent.summary}</p>
      )}
      <p className="mt-1.5 text-xs text-muted-foreground">
        {[patent.applicationNumber, patent.applicantName].filter(Boolean).join(" · ")}
      </p>
    </GlowCard>
  );
}
