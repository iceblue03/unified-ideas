import { createWorker, type Worker } from "tesseract.js";

/**
 * 일부 대회(esw-contest 등)는 작품 설명이 텍스트가 아니라 이미지로만 게시된다
 * (lib/collector-meta.ts 참고). tesseract.js는 완전 무료·오프라인 OCR이라 이
 * 프로젝트가 유료 AI API를 쓰지 않는다는 원칙(README.md)에 맞고, 실제로
 * 본문 단락 텍스트(제목처럼 장식적인 큰 글씨가 아니라 일반 문단)에는 정확도가
 * 꽤 높다는 걸 확인했다. worker를 한 번만 띄우고 재사용해 이미지마다 반복되는
 * 초기화 비용(수백 ms~수 초)을 피한다.
 */
let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("kor+eng");
  }
  return workerPromise;
}

/** 이미지 buffer 또는 URL을 OCR해서 텍스트를 반환한다. 실패하면 null. */
export async function ocrImage(input: Buffer | string): Promise<string | null> {
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(input);
    const text = data.text.trim();
    return text.length > 0 ? text : null;
  } catch (e) {
    console.warn("[ocr] failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** 수집 스크립트 종료 전에 호출해 워커 프로세스를 정리한다 (안 하면 프로세스가 안 끝남). */
export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    // ignore
  } finally {
    workerPromise = null;
  }
}
