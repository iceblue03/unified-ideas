import fs from "node:fs/promises";
import path from "node:path";
import type { Idea } from "../lib/types";
import { MANUAL_COMPETITIONS } from "../lib/competitions";
import { evaluateCollectionQuality, statsForItems } from "../lib/collect-stats";
import * as eswContest from "./collectors/esw-contest";
import * as publicDataStartup from "./collectors/public-data-startup";
import * as youthStartup from "./collectors/youth-startup";
import * as codeFair from "./collectors/code-fair";
import * as capstoneDesign from "./collectors/capstone-design";
import * as kipaInventionPatent from "./collectors/kipa-invention-patent";
import * as mafraPublicDataStartup from "./collectors/mafra-public-data-startup";
import * as studentInvention from "./collectors/student-invention";
import * as kStartup from "./collectors/k-startup";

const DATA_DIR = path.join(__dirname, "..", "data");
const AUTO_DIR = path.join(DATA_DIR, "auto");
const MANUAL_DIR = path.join(DATA_DIR, "manual");

const COLLECTORS = [
  eswContest,
  publicDataStartup,
  youthStartup,
  codeFair,
  capstoneDesign,
  kipaInventionPatent,
  mafraPublicDataStartup,
  studentInvention,
  kStartup,
];

interface AutoFileMeta {
  slug: string;
  name: string;
  tier: string;
  method: string;
  homepage: string;
  updatedAt?: string;
  lastSuccessAt?: string | null;
  sourcePdfUrl?: string | null;
  count: number;
  items: Idea[];
  lastRun?: {
    freshCount: number;
    summaryRatio: number;
    maxYear: number | null;
  };
}

async function readExistingFile(slug: string): Promise<AutoFileMeta | null> {
  try {
    const raw = await fs.readFile(path.join(AUTO_DIR, `${slug}.json`), "utf-8");
    return JSON.parse(raw) as AutoFileMeta;
  } catch {
    return null;
  }
}

async function readExistingItems(slug: string): Promise<Idea[]> {
  const file = await readExistingFile(slug);
  return file?.items ?? [];
}

async function readManual(slug: string): Promise<Idea[]> {
  try {
    const raw = await fs.readFile(path.join(MANUAL_DIR, `${slug}.json`), "utf-8");
    const parsed = JSON.parse(raw) as { items?: Idea[] };
    return parsed.items ?? [];
  } catch {
    return [];
  }
}

function mergeById(existing: Idea[], fresh: Idea[]): Idea[] {
  const map = new Map<string, Idea>();
  for (const item of existing) map.set(item.id, item);
  for (const item of fresh) map.set(item.id, item);
  return [...map.values()].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

async function main() {
  await fs.mkdir(AUTO_DIR, { recursive: true });

  const manifest: Array<{
    slug: string;
    name: string;
    tier: string;
    method: string;
    homepage: string;
    count: number;
    updatedAt: string | null;
    lastSuccessAt?: string | null;
    error?: string;
    lastRun?: { freshCount: number; summaryRatio: number; maxYear: number | null };
  }> = [];

  let hadQualityFailure = false;

  for (const collector of COLLECTORS) {
    const { slug, name, tier, method, homepage } = collector.meta;
    console.log(`\n=== [${slug}] ${name} 수집 시작 ===`);

    const priorFile = await readExistingFile(slug);
    const existing = priorFile?.items ?? [];

    let fresh: Idea[] = [];
    let thrownError: string | undefined;
    try {
      fresh = await collector.collect();
      console.log(`[${slug}] 이번 실행에서 ${fresh.length}건 수집`);
    } catch (e) {
      thrownError = e instanceof Error ? e.message : String(e);
      console.error(`[${slug}] 수집 실패:`, thrownError);
    }

    const freshStats = statsForItems(fresh);
    const merged = mergeById(existing, fresh);
    const mergedStats = statsForItems(merged);

    console.log(
      `[${slug}] run 요약: fresh=${fresh.length}, merged=${merged.length}, ` +
        `summary≥20자 ${Math.round(freshStats.summaryRatio * 100)}% (fresh) / ${Math.round(mergedStats.summaryRatio * 100)}% (merged), ` +
        `maxYear fresh=${freshStats.maxYear ?? "—"} merged=${mergedStats.maxYear ?? "—"}`,
    );

    const qualityError = evaluateCollectionQuality(slug, tier, fresh.length, existing.length, thrownError);
    if (qualityError && !thrownError) {
      console.error(`[${slug}] 품질 게이트: ${qualityError}`);
      hadQualityFailure = true;
    }

    const now = new Date().toISOString();
    const successThisRun = !thrownError && !qualityError && fresh.length > 0;
    const lastSuccessAt = successThisRun ? now : (priorFile?.lastSuccessAt ?? priorFile?.updatedAt ?? null);

    const errorMsg = thrownError ?? qualityError;

    const sourcePdfUrl =
      slug === "capstone-design" && fresh[0]?.sourceUrl
        ? fresh[0].sourceUrl
        : (priorFile?.sourcePdfUrl ?? null);

    await fs.writeFile(
      path.join(AUTO_DIR, `${slug}.json`),
      JSON.stringify(
        {
          slug,
          name,
          tier,
          method,
          homepage,
          updatedAt: now,
          lastSuccessAt,
          ...(sourcePdfUrl ? { sourcePdfUrl } : {}),
          count: merged.length,
          lastRun: {
            freshCount: fresh.length,
            summaryRatio: Math.round(mergedStats.summaryRatio * 1000) / 1000,
            maxYear: mergedStats.maxYear,
          },
          items: merged,
        },
        null,
        2,
      ),
      "utf-8",
    );
    console.log(`[${slug}] 누적 저장: 총 ${merged.length}건 (data/auto/${slug}.json)`);

    manifest.push({
      slug,
      name,
      tier,
      method,
      homepage,
      count: merged.length,
      updatedAt: now,
      lastSuccessAt,
      lastRun: {
        freshCount: fresh.length,
        summaryRatio: Math.round(mergedStats.summaryRatio * 1000) / 1000,
        maxYear: mergedStats.maxYear,
      },
      ...(errorMsg ? { error: errorMsg } : {}),
    });
  }

  for (const m of MANUAL_COMPETITIONS) {
    const items = await readManual(m.slug);
    manifest.push({
      slug: m.slug,
      name: m.name,
      tier: m.tier,
      method: m.method,
      homepage: m.homepage,
      count: items.length,
      updatedAt: null,
      lastSuccessAt: null,
    });
  }

  await fs.writeFile(
    path.join(DATA_DIR, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), competitions: manifest }, null, 2),
    "utf-8",
  );

  console.log("\n=== 전체 요약 ===");
  for (const m of manifest) {
    console.log(
      `- ${m.name} (${m.tier}): ${m.count}건` +
        (m.lastRun ? ` [fresh ${m.lastRun.freshCount}]` : "") +
        (m.error ? ` [ERROR: ${m.error}]` : ""),
    );
  }

  if (hadQualityFailure) {
    console.error("\n품질 게이트 실패로 종료 코드 1을 반환합니다.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
