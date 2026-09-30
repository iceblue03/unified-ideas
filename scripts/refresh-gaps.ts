import fs from "node:fs/promises";
import path from "node:path";
import type { Idea } from "../lib/types";
import * as codeFair from "./collectors/code-fair";
import * as esw from "./collectors/esw-contest";
import * as capstone from "./collectors/capstone-design";

const AUTO = path.join(__dirname, "..", "data", "auto");

function mergeById(existing: Idea[], fresh: Idea[]): Idea[] {
  const map = new Map<string, Idea>();
  for (const item of existing) map.set(item.id, item);
  for (const item of fresh) map.set(item.id, item);
  return [...map.values()].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

async function update(slug: string, fresh: Idea[]) {
  const file = path.join(AUTO, `${slug}.json`);
  const parsed = JSON.parse(await fs.readFile(file, "utf-8")) as { items?: Idea[] } & Record<string, unknown>;
  const merged = mergeById(parsed.items ?? [], fresh);
  const now = new Date().toISOString();
  parsed.items = merged;
  parsed.count = merged.length;
  parsed.updatedAt = now;
  parsed.lastSuccessAt = now;
  delete parsed.error;
  await fs.writeFile(file, JSON.stringify(parsed, null, 2) + "\n");
  console.log(`[${slug}] merged ${merged.length} (fresh ${fresh.length})`);
  return merged.length;
}

async function main() {
  const eswItems = await esw.collect();
  const eswCount = await update("esw-contest", eswItems);

  const capItems = await capstone.collect();
  const capCount = await update("capstone-design", capItems);

  const codeItems = await codeFair.collect();
  const codeCount = await update("code-fair", codeItems);

  const manifestPath = path.join(__dirname, "..", "data", "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as {
    competitions: Array<{ slug: string; count: number; updatedAt: string | null; error?: string }>;
  };
  const counts: Record<string, number> = {
    "esw-contest": eswCount,
    "capstone-design": capCount,
    "code-fair": codeCount,
  };
  for (const row of manifest.competitions) {
    if (!(row.slug in counts)) continue;
    row.count = counts[row.slug];
    row.updatedAt = new Date().toISOString();
    delete row.error;
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
