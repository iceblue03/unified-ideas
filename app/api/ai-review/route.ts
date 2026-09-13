import { after, NextRequest, NextResponse } from "next/server";

/**
 * 선택 기능: 무료 검색(app/api/search)으로 이미 추려낸 상위 후보 몇 개에 대해서만,
 * 사용자가 버튼을 눌렀을 때만 OpenRouter의 무료 모델을 호출한다.
 * - 기본 검색 경로는 AI API를 전혀 쓰지 않는다 (lib/similarity.ts).
 * - 여기서도 전체 데이터셋이 아니라 이미 걸러진 top 5 후보 텍스트만 프롬프트에 넣어
 *   토큰을 최소화한다.
 * - openrouter_key가 설정되지 않은 배포에서는 501을 반환해 기능이 자연스럽게 꺼진다.
 *
 * 데이터 불완전 진단(숨겨진 백그라운드 요청):
 * 일부 수집기는 원본이 이미지/스캔본이라 summary가 비어있거나 아주 짧을 수 있다
 * (esw-contest, code-fair 등 — lib/collector-meta.ts 참고). 그런 후보가 상위에
 * 걸리면 사용자에게 보여주는 분석 결과는 그대로 두되, 응답을 막지 않는 별도의
 * 요청으로 "이 항목은 왜 데이터가 부족한지, attachments를 보면 무엇을 더
 * 보강해야 하는지"를 모델에게 물어 서버 로그에만 남긴다 — 사람이 나중에 수집기를
 * 개선할 단서로 쓰기 위함이다. next/server의 after()로 감싸서(Vercel의 waitUntil을
 * 통해) 응답을 보낸 뒤에도 이 요청이 중간에 끊기지 않고 끝까지 실행되게 하되,
 * 응답 자체는 이 요청을 기다리지 않는다.
 */

const MODEL = "nex-n2.5-pro:free";

interface CandidateInput {
  competitionName: string;
  title: string;
  summary: string | null;
  award: string | null;
  year: number | null;
  score: number;
  sourceUrl?: string | null;
  hasAttachments?: boolean;
}

function isIncomplete(c: CandidateInput): boolean {
  const summaryLen = c.summary?.trim().length ?? 0;
  return summaryLen < 20;
}

/** 응답을 기다리지 않는 백그라운드 진단 요청. 실패해도 사용자 흐름에 영향 없음. */
async function fireHiddenDiagnostic(apiKey: string, query: string, incomplete: CandidateInput[]) {
  if (incomplete.length === 0) return;

  const listText = incomplete
    .map(
      (c, i) =>
        `${i + 1}. [${c.competitionName}] ${c.title}${c.sourceUrl ? ` (원본: ${c.sourceUrl})` : ""}` +
        (c.hasAttachments ? " — 첨부/이미지 있음, summary 텍스트 없음" : " — summary 없음, 첨부도 없음"),
    )
    .join("\n");

  const diagnosticPrompt =
    `다음은 검색 결과 상위 후보인데 설명(summary) 데이터가 비어있거나 매우 짧다:\n\n${listText}\n\n` +
    `각 항목에 대해 (1) 왜 데이터가 부족할 것으로 추정되는지 (2) 원본을 보강하려면 무엇을 ` +
    `추가로 수집해야 하는지 한두 문장씩만 진단해줘. 이 응답은 사용자에게 보여주지 않고 운영 로그로만 쓴다.`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: diagnosticPrompt }] }),
    });
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? "(empty)";
    console.log(`[data-diagnostic] query="${query.slice(0, 80)}" items=${incomplete.length}\n${text}`);
  } catch (e) {
    console.warn("[data-diagnostic] failed:", e instanceof Error ? e.message : String(e));
  }
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

  // 사용자 응답과는 무관하게, 실패하거나 느려도 위 흐름을 막지 않는 백그라운드 진단.
  // after()로 감싸 응답 전송 이후에도 (Vercel의 waitUntil을 통해) 끝까지 실행되게 한다.
  const incompleteCandidates = candidates.filter(isIncomplete);
  after(() => fireHiddenDiagnostic(apiKey, query, incompleteCandidates));

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

    let text = data.choices?.[0]?.message?.content ?? "";
    // 기존 출력을 해치지 않는 선에서만 아주 짧게: 데이터가 부족한 후보가 섞여있었다면
    // 한 줄만 살짝 덧붙인다 (백그라운드 진단 요청은 위에서 이미 별도로 발사됨).
    if (incompleteCandidates.length > 0) {
      text += `\n\n(참고: 후보 중 일부는 원문이 이미지/스캔본이라 설명이 제한적일 수 있어요.)`;
    }
    return NextResponse.json({ analysis: text });
  } catch (e) {
    return NextResponse.json(
      { error: `AI 호출 중 오류: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}
