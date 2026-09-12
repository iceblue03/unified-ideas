import { NextRequest, NextResponse } from "next/server";

/**
 * 선택 기능: 무료 검색(app/api/search)으로 이미 추려낸 상위 후보 몇 개에 대해서만,
 * 사용자가 버튼을 눌렀을 때만 OpenRouter의 무료 모델을 호출한다.
 * - 기본 검색 경로는 AI API를 전혀 쓰지 않는다 (lib/similarity.ts).
 * - 여기서도 전체 데이터셋이 아니라 이미 걸러진 top 5 후보 텍스트만 프롬프트에 넣어
 *   토큰을 최소화한다.
 * - openrouter_key가 설정되지 않은 배포에서는 501을 반환해 기능이 자연스럽게 꺼진다.
 * - 모델 응답은 자유 서술형 텍스트가 아니라 고정 스키마의 JSON으로 강제해서, 프런트엔드가
 *   이를 "칩"과 구조화된 비교 카드로 렌더링할 수 있게 한다 (AiReviewResult).
 */

const MODEL = "nex-n2.5-pro:free";

interface CandidateInput {
  competitionName: string;
  title: string;
  summary: string | null;
  award: string | null;
  year: number | null;
  score: number;
}

export type NoveltyLevel = "low" | "medium" | "high";

export interface AiTopMatch {
  /** 1-based index into the candidates array the client sent */
  candidateIndex: number;
  coreIdea: string;
  similarities: string[];
  differences: string[];
}

export interface AiReviewResult {
  noveltyLevel: NoveltyLevel;
  noveltySummary: string;
  tags: string[];
  topMatch: AiTopMatch | null;
  /** raw model text kept only as a fallback when structured parsing fails */
  rawText?: string;
}

const NOVELTY_LEVELS: NoveltyLevel[] = ["low", "medium", "high"];

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function parseAiResponse(text: string, candidateCount: number): AiReviewResult {
  const jsonStr = extractJson(text);
  if (!jsonStr) return fallback(text);

  try {
    const raw = JSON.parse(jsonStr) as {
      noveltyLevel?: unknown;
      noveltySummary?: unknown;
      tags?: unknown;
      topMatchIndex?: unknown;
      topMatchCoreIdea?: unknown;
      topMatchSimilarities?: unknown;
      topMatchDifferences?: unknown;
    };

    const noveltyLevel = NOVELTY_LEVELS.includes(raw.noveltyLevel as NoveltyLevel)
      ? (raw.noveltyLevel as NoveltyLevel)
      : "medium";

    const noveltySummary =
      typeof raw.noveltySummary === "string" && raw.noveltySummary.trim()
        ? raw.noveltySummary.trim().slice(0, 400)
        : "";

    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 6)
      : [];

    const idx = Number(raw.topMatchIndex);
    let topMatch: AiTopMatch | null = null;
    if (Number.isInteger(idx) && idx >= 1 && idx <= candidateCount) {
      const similarities = Array.isArray(raw.topMatchSimilarities)
        ? raw.topMatchSimilarities
            .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
            .slice(0, 4)
        : [];
      const differences = Array.isArray(raw.topMatchDifferences)
        ? raw.topMatchDifferences
            .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
            .slice(0, 4)
        : [];
      const coreIdea =
        typeof raw.topMatchCoreIdea === "string" ? raw.topMatchCoreIdea.trim().slice(0, 200) : "";

      if (coreIdea || similarities.length > 0) {
        topMatch = { candidateIndex: idx, coreIdea, similarities, differences };
      }
    }

    if (!noveltySummary && tags.length === 0 && !topMatch) return fallback(text);

    return { noveltyLevel, noveltySummary, tags, topMatch };
  } catch {
    return fallback(text);
  }
}

function fallback(text: string): AiReviewResult {
  return {
    noveltyLevel: "medium",
    noveltySummary: "",
    tags: [],
    topMatch: null,
    rawText: text.trim(),
  };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.openrouter_key;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI 분석 기능이 이 배포에는 설정되어 있지 않습니다 (openrouter_key 미설정)." },
      { status: 501 },
    );
  }

  let body: { query?: string; candidates?: CandidateInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  const candidates = (body.candidates ?? []).slice(0, 5);
  if (!query || candidates.length === 0) {
    return NextResponse.json({ error: "query와 candidates가 필요합니다" }, { status: 400 });
  }

  const candidateText = candidates
    .map(
      (c, i) =>
        `${i + 1}. [${c.competitionName}${c.year ? ` ${c.year}` : ""}${c.award ? ` · ${c.award}` : ""}] ${c.title}` +
        (c.summary ? `\n   설명: ${c.summary.slice(0, 300)}` : "") +
        `\n   (검색 유사도 점수: ${(c.score * 100).toFixed(0)}%)`,
    )
    .join("\n\n");

  const prompt =
    `사용자가 다음과 같은 아이디어를 구상 중입니다:\n"""\n${query.slice(0, 1500)}\n"""\n\n` +
    `아래는 국내 대회 역대 수상작 중 검색 유사도가 가장 높았던 후보들입니다 (번호 1~${candidates.length}):\n\n${candidateText}\n\n` +
    `이 후보들과 사용자 아이디어를 비교 분석해서, 다른 설명이나 마크다운, 코드블록 표시 없이 아래 스키마의 ` +
    `순수 JSON 객체 "하나만" 출력하세요. 모든 문자열 값은 한국어로 작성하고, 과장하지 말고 사실 기반으로 간결하게 ` +
    `작성하세요.\n\n` +
    `{\n` +
    `  "noveltyLevel": "low" | "medium" | "high",  // 기존 수상작과 비교했을 때 이 아이디어가 얼마나 참신한지\n` +
    `  "noveltySummary": "전체 평가를 1~2문장으로",\n` +
    `  "tags": ["짧은 키워드 칩 3~5개, 각 4~10자"],\n` +
    `  "topMatchIndex": 가장_핵심아이디어가_유사한_후보의_번호(1~${candidates.length}), 뚜렷하게 유사한 후보가 없으면 null,\n` +
    `  "topMatchCoreIdea": "topMatchIndex 후보와 사용자 아이디어가 공유하는 핵심을 한 문장으로 (없으면 빈 문자열)",\n` +
    `  "topMatchSimilarities": ["구체적으로 겹치는 점 1~3개, 각 한 문장 (없으면 빈 배열)"],\n` +
    `  "topMatchDifferences": ["구체적으로 다른 점 1~3개, 각 한 문장 (없으면 빈 배열)"]\n` +
    `}`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `AI 호출 실패: ${res.status} ${errText}` }, { status: 502 });
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (data.error) {
      return NextResponse.json({ error: `AI 호출 실패: ${data.error.message}` }, { status: 502 });
    }

    const text = data.choices?.[0]?.message?.content ?? "";
    const result = parseAiResponse(text, candidates.length);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: `AI 호출 중 오류: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}
