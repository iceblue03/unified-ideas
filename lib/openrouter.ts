/**
 * OpenRouter 무료 모델 호출 공용 클라이언트.
 *
 * 모델 선택 기준: OpenRouter 모델 목록의 data_policy 메타데이터를 직접 확인해
 * "프롬프트를 모델 학습에 쓰지 않음(training:false)"이 명시된 모델만 후보로 둔다 —
 * nex-agi 계열은 training:false, trainingOpenRouter:false이면서 retainsPrompts:true
 * (30일 보관)라, "데이터는 수집(로그)해도 학습에는 쓰지 않는" 정책과 정확히 일치한다.
 * (google/gemma-4-26b-a4b-it:free 등 다른 후보들은 이 스냅샷에 data_policy 자체가
 * 노출되지 않아 학습 여부를 확인할 수 없었으므로 제외했다 — 확인 안 된 모델을 끼워
 * 넣느니 검증된 벤더 하나로 좁히는 쪽을 택함.)
 *
 * 이 벤더의 모델은 기본적으로 추론(사고) 모델이라 <think> 트레이스가 붙어 느려질 수
 * 있는데, nex-n2.5-mini/pro 둘 다 "reasoning effort: none"을 지원하므로 요청에
 * `reasoning: { effort: "none" }`을 실어 매번 사고 트레이스 없이 즉답하게 만든다.
 *
 * 무료 티어는 트래픽이 몰리면 업스트림에서 언제든 429(rate-limited)를 반환할 수 있으므로
 * (실제로 이전에 쓰던 google/gemma-4-26b-a4b-it:free에서 겪음), 같은 데이터 정책을 가진
 * mini→pro 순으로 시도하다 429/5xx 등 "빠르게 실패하는" 응답을 만나면 다음 후보로
 * 넘어간다. 타임아웃(응답 자체가 너무 느림)은 재시도해도 시간만 배로 드니 재시도하지
 * 않고 바로 실패로 반환한다.
 */
const MODEL_CANDIDATES = [
  "nex-agi/nex-n2.5-mini:free", // ~609ms 기준, training:false
  "nex-agi/nex-n2.5-pro:free", // ~2.0s 기준(느리지만 동일한 데이터 정책의 벤더 폴백)
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
