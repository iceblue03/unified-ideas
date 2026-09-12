/**
 * OpenRouter 무료 모델 호출 공용 클라이언트.
 *
 * 모델 교체 이력: nex-n2.5-pro:free(지연시간 약 2.0초, 추론형) →
 * google/gemma-4-26b-a4b-it:free(약 855ms, 비추론 instruct 모델, MoE 활성 파라미터
 * 약 4B). AI 토글이 기본 ON이 되면서 검색 1회당 LLM을 2번 호출하므로 지연시간이
 * 중요해졌고, <think> 트레이스가 붙는 추론 모델(nex-agi 계열)은 일부러 피했다.
 * 이 엔드포인트가 불안정하면 아래 한 줄만 "nex-agi/nex-n2.5-mini:free"로 교체하면 된다.
 */
export const MODEL = "google/gemma-4-26b-a4b-it:free";

export type OpenRouterResult = { ok: true; text: string } | { ok: false; error: string };

export async function callOpenRouter(prompt: string, timeoutMs = 10_000): Promise<OpenRouterResult> {
  const apiKey = process.env.openrouter_key;
  if (!apiKey) {
    return { ok: false, error: "openrouter_key가 설정되지 않았습니다." };
  }

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
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, error: `AI 호출 실패: ${res.status} ${errText}`.slice(0, 300) };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (data.error) {
      return { ok: false, error: `AI 호출 실패: ${data.error.message}` };
    }

    const text = data.choices?.[0]?.message?.content ?? "";
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: `AI 호출 중 오류: ${e instanceof Error ? e.message : String(e)}` };
  }
}
