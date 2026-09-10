import fs from "node:fs/promises";
import path from "node:path";
import type { Idea } from "../lib/types";
import { MANUAL_COMPETITIONS } from "../lib/competitions";
import * as eswContest from "./collectors/esw-contest";
import * as publicDataStartup from "./collectors/public-data-startup";
import * as youthStartup from "./collectors/youth-startup";
import * as codeFair from "./collectors/code-fair";

const DATA_DIR = path.join(__dirname, "..", "data");
const AUTO_DIR = path.join(DATA_DIR, "auto");
const MANUAL_DIR = path.join(DATA_DIR, "manual");

const COLLECTORS = [eswContest, publicDataStartup, youthStartup, codeFair];

async function readExisting(slug: string): Promise<Idea[]> {
  try {
    const raw = await fs.readFile(path.join(AUTO_DIR, `${slug}.json`), "utf-8");
    const parsed = JSON.parse(raw) as { items?: Idea[] };
    return parsed.items ?? [];
  } catch {
    return [];
  }
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
  // 새로 수집한 값을 우선 반영하되, 이번 실행에 없었던(사이트가 지워버린) 과거
  // 항목도 그대로 보존한다 — 이게 이 프로젝트의 핵심인 "우리만의 누적 아카이브".
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
    error?: string;
  }> = [];

  for (const collector of COLLECTORS) {
    const { slug, name, tier, method, homepage } = collector.meta;
    console.log(`\n=== [${slug}] ${name} 수집 시작 ===`);

    let fresh: Idea[] = [];
    let errorMsg: string | undefined;
    try {
      fresh = await collector.collect();
      console.log(`[${slug}] 이번 실행에서 ${fresh.length}건 수집`);
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
      console.error(`[${slug}] 수집 실패:`, errorMsg);
    }

    const existing = await readExisting(slug);
    const merged = mergeById(existing, fresh);
    const updatedAt = new Date().toISOString();

    await fs.writeFile(
      path.join(AUTO_DIR, `${slug}.json`),
      JSON.stringify({ slug, name, tier, method, homepage, updatedAt, count: merged.length, items: merged }, null, 2),
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
      updatedAt,
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
    });
  }

  await fs.writeFile(
    path.join(DATA_DIR, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), competitions: manifest }, null, 2),
    "utf-8",
  );

  console.log("\n=== 전체 요약 ===");
  for (const m of manifest) {
    console.log(`- ${m.name} (${m.tier}): ${m.count}건${m.error ? ` [ERROR: ${m.error}]` : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
