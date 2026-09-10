import { NextRequest, NextResponse } from "next/server";

/**
 * 선택 기능: 무료 검색(app/api/search)으로 이미 추려낸 상위 후보 몇 개에 대해서만,
 * 사용자가 버튼을 눌렀을 때만 OpenRouter의 무료 모델을 호출한다.
 * - 기본 검색 경로는 AI API를 전혀 쓰지 않는다 (lib/similarity.ts).
 * - 여기서도 전체 데이터셋이 아니라 이미 걸러진 top 5 후보 텍스트만 프롬프트에 넣어
 *   토큰을 최소화한다.
 * - openrouter_key가 설정되지 않은 배포에서는 501을 반환해 기능이 자연스럽게 꺼진다.
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
    `아래는 국내 대회 역대 수상작 중 검색 유사도가 가장 높았던 후보들입니다:\n\n${candidateText}\n\n` +
    `이 후보들과 사용자 아이디어를 비교해서, (1) 실제로 핵심 아이디어/문제해결 방식이 겹치는 후보가 있는지, ` +
    `(2) 있다면 어떤 점이 유사하고 어떤 점이 다른지, (3) 전반적으로 이 아이디어가 얼마나 참신해 보이는지를 ` +
    `한국어로 5줄 이내로 간결하게 평가해주세요. 과장하지 말고 사실 기반으로 말해주세요.`;

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
    return NextResponse.json({ analysis: text });
  } catch (e) {
    return NextResponse.json(
      { error: `AI 호출 중 오류: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}
