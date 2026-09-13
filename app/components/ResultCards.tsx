import { formatMoney } from "../../lib/types";
import type { CompetitionResultItem, PatentResultItem, ProductResultItem } from "../../lib/types";
import { Chip, ScoreRing, awardTone, scoreLabel } from "./ui";

export function MatchCard({ item, rank }: { item: CompetitionResultItem; rank: number }) {
  const { idea } = item;
  const score = item.aiScore ?? item.score;
  return (
    <li className="group rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.04)] transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_8px_24px_rgba(79,70,229,0.10)] sm:p-5">
      <div className="flex items-start gap-4">
        <ScoreRing score={score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-[10px] font-bold text-white">
              {rank}
            </span>
            <Chip tone="indigo">{idea.competitionName}</Chip>
            {idea.year && <Chip tone="neutral">{idea.year}</Chip>}
            {idea.award && <Chip tone={awardTone(idea.award)}>{idea.award}</Chip>}
            <span className="ml-auto shrink-0 text-[11px] font-medium text-zinc-400 sm:hidden">
              {scoreLabel(score)}
            </span>
          </div>
          <p className="mt-2 font-semibold text-zinc-900 break-words">{idea.title}</p>
          {idea.summary && (
            <p className="mt-1 text-sm leading-relaxed text-zinc-500 line-clamp-2 break-words">{idea.summary}</p>
          )}
          {(idea.team || idea.org) && (
            <p className="mt-1.5 text-xs text-zinc-400">{[idea.team, idea.org].filter(Boolean).join(" · ")}</p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <span className="hidden text-[11px] font-medium text-zinc-400 sm:inline">{scoreLabel(score)}</span>
            {idea.sourceUrl && (
              <a
                href={idea.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                출처 보기 →
              </a>
            )}
          </div>
        </div>
      </div>
    </li>
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
    <li className="group rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.04)] transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_8px_24px_rgba(79,70,229,0.10)] sm:p-5">
      <div className="flex items-start gap-4">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-[10px] text-zinc-400">
            이미지 없음
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-[10px] font-bold text-white">
              {rank}
            </span>
            {product.mallName && <Chip tone="blue">{product.mallName}</Chip>}
            {product.brand && <Chip tone="neutral">{product.brand}</Chip>}
          </div>
          <p className="mt-2 font-semibold text-zinc-900 break-words">{product.title}</p>
          {price && <p className="mt-1 text-sm font-medium text-zinc-700">{price}</p>}
          {product.category && <p className="mt-1 text-xs text-zinc-400">{product.category}</p>}
          {product.link && (
            <a
              href={product.link}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-0.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              쇼핑몰에서 보기 →
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

export function PatentCard({ item, rank }: { item: PatentResultItem; rank: number }) {
  const { patent } = item;
  return (
    <li className="group rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.04)] transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_8px_24px_rgba(79,70,229,0.10)] sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-[10px] font-bold text-white">
          {rank}
        </span>
        {patent.applicationDate && <Chip tone="neutral">출원 {patent.applicationDate}</Chip>}
        {patent.registrationStatus && <Chip tone="violet">{patent.registrationStatus}</Chip>}
      </div>
      <p className="mt-2 font-semibold text-zinc-900 break-words">{patent.title}</p>
      {patent.summary && (
        <p className="mt-1 text-sm leading-relaxed text-zinc-500 line-clamp-2 break-words">{patent.summary}</p>
      )}
      <p className="mt-1.5 text-xs text-zinc-400">
        {[patent.applicationNumber, patent.applicantName].filter(Boolean).join(" · ")}
      </p>
    </li>
  );
}
