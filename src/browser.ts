import puppeteer, { type Browser, type Page } from 'puppeteer';
import pLimit from 'p-limit';

const MAX_CONCURRENT_PAGES = 3;

export class BrowserManager {
  private browserPromise: Promise<Browser> | null = null;
  private closePromise: Promise<void> | null = null;
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
    if (this.closePromise) return this.closePromise;
    if (!this.browserPromise) return;
    const browserPromise = this.browserPromise;
    this.browserPromise = null;
    this.closePromise = browserPromise.then((browser) => browser.close());
    return this.closePromise;
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = puppeteer.launch({ headless: true }).catch((err) => {
        this.browserPromise = null;
        throw err;
      });
    }
    return this.browserPromise;
  }
}
