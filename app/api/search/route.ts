import { NextRequest, NextResponse } from "next/server";
import { getAllIdeas, getManifest } from "../../../lib/dataset";
import { topMatches } from "../../../lib/similarity";
import type { Idea } from "../../../lib/types";

const ALL_IDEAS = getAllIdeas();
const CANDIDATES = ALL_IDEAS.map((item) => ({
  item,
  text: [item.title, item.summary, item.category].filter(Boolean).join(" "),
}));

export interface SearchMatch {
  score: number;
  idea: Idea;
}

export interface SearchResponse {
  query: string;
  totalIndexed: number;
  overall: SearchMatch[];
  byCompetition: Record<string, SearchMatch[]>;
  manifest: ReturnType<typeof getManifest>;
}

export async function POST(req: NextRequest) {
  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  if (!query || query.length < 2) {
    return NextResponse.json({ error: "query가 너무 짧습니다 (2자 이상 입력해주세요)" }, { status: 400 });
  }
  if (query.length > 2000) {
    return NextResponse.json({ error: "query가 너무 깁니다 (2000자 이하)" }, { status: 400 });
  }

  const overallRaw = topMatches(query, CANDIDATES, 15);
  const overall: SearchMatch[] = overallRaw.map((m) => ({ score: m.score, idea: m.item }));

  const byCompetition: Record<string, SearchMatch[]> = {};
  const competitionSlugs = [...new Set(ALL_IDEAS.map((i) => i.competition))];
  for (const slug of competitionSlugs) {
    const subset = CANDIDATES.filter((c) => c.item.competition === slug);
    const matches = topMatches(query, subset, 5).map((m) => ({ score: m.score, idea: m.item }));
    byCompetition[slug] = matches;
  }

  const response: SearchResponse = {
    query,
    totalIndexed: ALL_IDEAS.length,
    overall,
    byCompetition,
    manifest: getManifest(),
  };

  return NextResponse.json(response);
}
