import { chromium } from "playwright";
import path from "node:path";

/**
 * data.seoul.go.kr dataset pages expose downloads via a JS `downloadFile(seq)`
 * call rather than a plain href, and the file itself is gated by session
 * state the portal sets on page load — so we drive a real (headless) browser
 * instead of doing a raw HTTP request.
 *
 * A dataset page can list several files (e.g. "...2019~2024" and
 * "...2019~2025"); we pick the one whose title names the latest end-year.
 */
export async function downloadLatestSeoulFile(
  datasetId: string,
  saveDir: string,
): Promise<{ filePath: string; title: string }> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60_000);
    await page.goto(`https://data.seoul.go.kr/dataList/${datasetId}/S/1/datasetView.do`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForSelector("a[href^='javascript:downloadFile']", { timeout: 60_000 });

    const links = await page.$$eval("a[href^='javascript:downloadFile']", (as) =>
      as.map((a) => ({
        text: (a.textContent || "").trim(),
        seq: (a.getAttribute("href") || "").match(/downloadFile\('(\d+)'\)/)?.[1] ?? null,
      })),
    );

    let best: { text: string; seq: string } | null = null;
    let bestEndYear = -1;
    for (const l of links) {
      if (!l.seq) continue;
      const m = l.text.match(/~(\d{4})\D*\)/);
      const endYear = m ? parseInt(m[1], 10) : 0;
      if (endYear >= bestEndYear) {
        bestEndYear = endYear;
        best = { text: l.text, seq: l.seq };
      }
    }
    if (!best) {
      throw new Error(`seoul-open-data: no downloadable file link found for ${datasetId}`);
    }

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.evaluate((seq) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).downloadFile(seq);
      }, best.seq),
    ]);

    const filePath = path.join(saveDir, `${datasetId}.xlsx`);
    await download.saveAs(filePath);
    return { filePath, title: best.text };
  } finally {
    await browser.close();
  }
}
