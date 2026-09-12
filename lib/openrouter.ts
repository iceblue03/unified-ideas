/**
 * OpenRouter 무료 모델 호출 공용 클라이언트.
 *
 * 무료 티어 모델은 트래픽이 몰리면 업스트림에서 언제든 429(rate-limited)를 반환할 수
 * 있다 — 실제로 google/gemma-4-26b-a4b-it:free 단독 사용 중 이 문제를 겪었다. 그래서
 * 모델 하나에 의존하지 않고, 지연시간이 짧고 비추론(<think> 트레이스 없음)인 순으로
 * 정렬한 후보 목록을 순서대로 시도하다 429/5xx 등 "빠르게 실패하는" 응답을 만나면
 * 다음 후보로 넘어간다. 타임아웃(응답 자체가 너무 느림)은 재시도해도 시간만 배로
 * 드니 재시도하지 않고 바로 실패로 반환한다.
 */
const MODEL_CANDIDATES = [
  "google/gemma-4-26b-a4b-it:free", // ~855ms, 비추론, MoE 활성 파라미터 약 4B
  "liquid/lfm-2.5-2.6b:free", // ~535ms, 비추론 소형 general 모델
  "nex-agi/nex-n2.5-mini:free", // ~609ms, 이전에 쓰던 벤더의 모델(추론형 — <think> 트레이스가 섞여도 JSON 추출 로직이 이미 이를 감안해 처리함)
  "nvidia/nemotron-3-super-120b-a12b:free", // ~944ms, general nvidia 모델
];

export type OpenRouterResult = { ok: true; text: string } | { ok: false; error: string };

type ModelCallResult =
  | { ok: true; text: string }
  | { ok: false; retryable: boolean; error: string };

async function callModel(apiKey: string, model: string, prompt: string, timeoutMs: number): Promise<ModelCallResult> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      // 429(rate limit)/5xx는 보통 즉시 거절되므로 다음 후보 모델로 재시도할 가치가 있다.
      const retryable = res.status === 429 || res.status >= 500;
      return { ok: false, retryable, error: `AI 호출 실패(${model}): ${res.status} ${errText}`.slice(0, 300) };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string; code?: number };
    };

    if (data.error) {
      const retryable = data.error.code === 429 || (data.error.code ?? 0) >= 500;
      return { ok: false, retryable, error: `AI 호출 실패(${model}): ${data.error.message}` };
    }

    const text = data.choices?.[0]?.message?.content ?? "";
    return { ok: true, text };
  } catch (e) {
    // AbortSignal 타임아웃/네트워크 예외 — 같은 만큼 또 기다리게 되므로 재시도하지 않는다.
    return {
      ok: false,
      retryable: false,
      error: `AI 호출 중 오류(${model}): ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function callOpenRouter(prompt: string, timeoutMs = 10_000): Promise<OpenRouterResult> {
  const apiKey = process.env.openrouter_key;
  if (!apiKey) {
    return { ok: false, error: "openrouter_key가 설정되지 않았습니다." };
  }

  let lastError = "AI 호출에 실패했습니다.";
  for (const model of MODEL_CANDIDATES) {
    const result = await callModel(apiKey, model, prompt, timeoutMs);
    if (result.ok) return result;
    lastError = result.error;
    if (!result.retryable) break;
  }
  return { ok: false, error: lastError };
}
