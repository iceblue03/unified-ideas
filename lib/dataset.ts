import type { Idea } from "./types";

import eswContest from "../data/auto/esw-contest.json";
import publicDataStartup from "../data/auto/public-data-startup.json";
import youthStartup from "../data/auto/youth-startup.json";
import codeFair from "../data/auto/code-fair.json";
import capstoneDesign from "../data/auto/capstone-design.json";
import kipaInventionPatent from "../data/auto/kipa-invention-patent.json";
import mafraPublicDataStartup from "../data/auto/mafra-public-data-startup.json";
import studentInvention from "../data/auto/student-invention.json";
import kStartup from "../data/auto/k-startup.json";

import chungjuyungStartup from "../data/manual/chungjuyung-startup.json";

import manifestJson from "../data/manifest.json";
import { MANUAL_COMPETITIONS } from "./competitions";

interface AutoFile {
  slug: string;
  name: string;
  tier: "auto" | "semi-auto";
  method: string;
  homepage: string;
  updatedAt: string;
  count: number;
  items: Idea[];
}

interface ManualFile {
  slug: string;
  note: string;
  items: Idea[];
}

const AUTO_FILES = [
  eswContest,
  publicDataStartup,
  youthStartup,
  codeFair,
  capstoneDesign,
  kipaInventionPatent,
  mafraPublicDataStartup,
  studentInvention,
  kStartup,
] as AutoFile[];
const MANUAL_FILES: Record<string, ManualFile> = {
  "chungjuyung-startup": chungjuyungStartup as ManualFile,
};

export function getAllIdeas(): Idea[] {
  const all: Idea[] = [];
  for (const file of AUTO_FILES) all.push(...file.items);
  for (const meta of MANUAL_COMPETITIONS) {
    const file = MANUAL_FILES[meta.slug];
    if (file) all.push(...file.items);
  }
  return all;
}

export interface ManifestEntry {
  slug: string;
  name: string;
  tier: "auto" | "semi-auto" | "manual";
  method: string;
  homepage: string;
  count: number;
  updatedAt: string | null;
  error?: string;
}

export interface Manifest {
  generatedAt: string;
  competitions: ManifestEntry[];
}

export function getManifest(): Manifest {
  return manifestJson as Manifest;
}
