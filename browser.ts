// Shared headless-Chrome helpers. Used by both the inspiration (screenshot)
// and library (JS-render fallback) capture paths.

export const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * Render a URL in headless Chrome and return its visible text (document.body.innerText).
 * Used as a fallback for JS-rendered pages (SPAs) whose server HTML has no readable body.
 * Uses `domcontentloaded` + a short settle delay rather than `networkidle2`, which times
 * out on pages with persistent connections (analytics, ads, websockets).
 */
export async function renderPageText(url: string): Promise<string> {
  let browser: import("puppeteer-core").Browser | undefined;
  try {
    const puppeteer = await import("puppeteer-core");
    browser = await puppeteer.default.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    const text = await page.evaluate(() =>
      (document.body.innerText || "").substring(0, 10000)
    );
    return text;
  } finally {
    await browser?.close().catch(() => {});
  }
}
