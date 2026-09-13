/**
 * OpenRouter 모델은 "마크다운/코드블록 없이 순수 JSON 하나만" 출력하도록 프롬프트로
 * 강제하지만, 모델이 코드펜스를 붙이거나 잡담을 섞는 경우가 있어 방어적으로 추출한다.
 */
export function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}
