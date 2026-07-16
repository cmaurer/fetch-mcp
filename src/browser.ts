import puppeteer, { type Browser, type Page } from 'puppeteer';
import pLimit from 'p-limit';

const MAX_CONCURRENT_PAGES = 3;

export class BrowserManager {
  private browserPromise: Promise<Browser> | null = null;
  private readonly limit = pLimit(MAX_CONCURRENT_PAGES);

  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    return this.limit(async () => {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      try {
        return await fn(page);
      } finally {
        await page.close();
      }
    });
  }

  async close(): Promise<void> {
    const current = this.browserPromise;
    if (!current) return;
    this.browserPromise = null;
    const browser = await current;
    await browser.close();
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      const launchPromise: Promise<Browser> = puppeteer.launch({ headless: true }).catch((err) => {
        if (this.browserPromise === launchPromise) {
          this.browserPromise = null;
        }
        throw err;
      });
      this.browserPromise = launchPromise;
    }
    return this.browserPromise;
  }
}
