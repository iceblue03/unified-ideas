import { createServer, type Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

/**
 * 일부 대회(학생발명전시회, 창의적종합설계경진대회)는 전체 수상작을 PDF 도록
 * 한 권으로만 공개한다. pdf-parse로 텍스트를 뽑아보면 한글 본문이 CID 폰트라
 * 통째로 누락된다(lib/competitions.ts 참고) — 그래서 페이지를 이미지로
 * "렌더링"한 뒤 OCR(lib/ocr.ts)을 거치는 방식이 필요하다.
 *
 * poppler-utils(pdftoppm) 같은 외부 바이너리가 이 환경엔 없고, pdfjs-dist를
 * Node의 canvas 패키지와 직접 조합하면(NodeCanvasFactory) 버전 호환성 문제로
 * 렌더링이 깨지는 걸 확인했다. 대신 이미 프로젝트 의존성인 Playwright의 실제
 * Chromium 안에서 pdf.js(브라우저용 빌드)를 그대로 돌려 <canvas>에 렌더링하고
 * 스크린샷 대신 canvas.toDataURL()로 PNG를 뽑는다 — 진짜 브라우저 Canvas라
 * node-canvas 호환성 문제가 없다.
 *
 * PDF/폰트/CMap 파일을 file://로 직접 열면 워커 로딩이 막히는 경우가 있어,
 * 로컬 HTTP 서버를 하나 띄워 pdfjs 정적 파일과 대상 PDF를 서빙한다.
 */

const PDFJS_DIR = path.dirname(require.resolve("pdfjs-dist/package.json"));

const VIEWER_HTML = `<!doctype html>
<html><body>
<canvas id="c"></canvas>
<script type="module">
  import * as pdfjsLib from "/pdfjs/build/pdf.mjs";
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.mjs";
  let doc = null;
  window.__loadDoc = async () => {
    doc = await pdfjsLib.getDocument({
      url: "/doc.pdf",
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
    }).promise;
    return doc.numPages;
  };
  window.__renderPage = async (n, scale) => {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.getElementById("c");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { width: canvas.width, height: canvas.height };
  };
  window.__cropLast = (x, y, w, h) => {
    const src = document.getElementById("c");
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(w));
    crop.height = Math.max(1, Math.round(h));
    crop.getContext("2d").drawImage(src, x, y, w, h, 0, 0, crop.width, crop.height);
    return crop.toDataURL("image/png");
  };
</script>
</body></html>`;

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Buffer.from(base64, "base64");
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".mjs") || filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

export class PdfRenderer {
  private server: Server | null = null;
  private port = 0;
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor(private pdfPath: string) {}

  async open(): Promise<number> {
    this.server = createServer((req, res) => {
      const url = (req.url || "/").split("?")[0];
      if (url === "/" || url === "/viewer.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(VIEWER_HTML);
        return;
      }
      if (url === "/doc.pdf") {
        res.writeHead(200, { "content-type": "application/pdf" });
        fs.createReadStream(this.pdfPath).pipe(res);
        return;
      }
      if (url.startsWith("/pdfjs/")) {
        const rel = url.slice("/pdfjs/".length);
        const filePath = path.normalize(path.join(PDFJS_DIR, rel));
        if (!filePath.startsWith(PDFJS_DIR) || !fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": contentTypeFor(filePath) });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    this.port = typeof address === "object" && address ? address.port : 0;

    this.browser = await chromium.launch();
    this.page = await this.browser.newPage();
    await this.page.goto(`http://127.0.0.1:${this.port}/viewer.html`);
    const numPages = await this.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__loadDoc() as Promise<number>,
    );
    return numPages;
  }

  async renderPage(pageNum: number, scale = 2.0): Promise<Buffer> {
    const { dataUrl } = await this.renderPageWithSize(pageNum, scale);
    return dataUrlToBuffer(dataUrl);
  }

  /**
   * 페이지를 렌더링하고 캔버스 크기도 함께 반환한다. 좌/우 2단 레이아웃에서
   * 컬럼별로 잘라 OCR하고 싶을 때(cropRegion과 함께) 크기를 알아야 하기 때문.
   */
  async renderPageWithSize(
    pageNum: number,
    scale = 2.0,
  ): Promise<{ dataUrl: string; width: number; height: number }> {
    if (!this.page) throw new Error("PdfRenderer.open()을 먼저 호출해야 함");
    const size: { width: number; height: number } = await this.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ n, s }) => (window as any).__renderPage(n, s) as Promise<{ width: number; height: number }>,
      { n: pageNum, s: scale },
    );
    const dataUrl: string = await this.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ x, y, w, h }) => (window as any).__cropLast(x, y, w, h) as string,
      { x: 0, y: 0, w: size.width, h: size.height },
    );
    return { dataUrl, width: size.width, height: size.height };
  }

  /**
   * 마지막으로 렌더링한 캔버스에서 지정한 픽셀 영역만 잘라 PNG로 반환한다.
   * 좌/우 2단 레이아웃(본문 텍스트 | 학교·팀 정보) 페이지를 컬럼별로 나눠
   * OCR하면 두 컬럼 텍스트가 줄 단위로 뒤섞이는 문제를 피할 수 있다.
   */
  async cropLast(x: number, y: number, w: number, h: number): Promise<Buffer> {
    if (!this.page) throw new Error("PdfRenderer.open()을 먼저 호출해야 함");
    const dataUrl: string = await this.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ x, y, w, h }) => (window as any).__cropLast(x, y, w, h) as string,
      { x, y, w, h },
    );
    return dataUrlToBuffer(dataUrl);
  }

  async close(): Promise<void> {
    await this.page?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }
}
