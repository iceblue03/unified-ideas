/**
 * OpenRouter 무료 모델 호출 공용 클라이언트.
 *
 * 모델 선택 기준: nex-agi 계열(소규모 신생 랩)에서 타임아웃이 잦아, 데이터 학습 정책
 * 여부는 더 이상 따지지 않고 속도·안정성만 기준으로 고른다. NVIDIA/Cohere처럼 인프라가
 * 큰 벤더가 낸 "3B 활성 파라미터 MoE + 고처리량 특화" 모델 두 개를 서로 다른 벤더로
 * 골라, 한쪽 인프라가 흔들려도 다른 쪽으로 넘어가게 했다.
 *
 * 두 모델 다 reasoning 파라미터를 지원해 `reasoning: { effort: "none" }`으로 <think>
 * 트레이스 없이 즉답하게 만든다.
 *
 * 무료 티어는 트래픽이 몰리면 업스트림에서 언제든 429(rate-limited)를 반환할 수 있으므로
 * 1차 모델에서 429/5xx 등 "빠르게 실패하는" 응답을 만나면 다음 후보로 넘어간다.
 * 타임아웃(응답 자체가 너무 느림)은 재시도해도 시간만 배로 드니 재시도하지 않고 바로
 * 실패로 반환한다.
 */
const MODEL_CANDIDATES = [
  "nvidia/nemotron-3.5-lightning:free", // 30B-A3B, 고처리량 특화("Lightning") — NVIDIA 인프라
  "cohere/north-mini-code:free", // 30B-A3B, 저지연 특화 — 다른 벤더(Cohere)로 폴백
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
        // nex-agi 모델은 기본이 추론(사고) 모드라 <think> 트레이스로 느려지므로 끈다.
        reasoning: { effort: "none" },
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
