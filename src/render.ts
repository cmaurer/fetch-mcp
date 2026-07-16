import type { BrowserManager } from './browser.js';
import { assertUrlIsSafe, isRequestUrlSafe } from './ssrf-guard.js';
import { NavigationFailedError } from './errors.js';

export interface RenderPageOptions {
  url: string;
  waitForSelector?: string;
  timeoutMs: number;
}

export type WaitCondition = 'selector' | 'networkidle';

export interface RenderResult {
  finalUrl: string;
  httpStatus: number;
  html: string;
  title: string | null;
  waitCondition: WaitCondition;
  waitTimedOut: boolean;
}

export async function renderPage(
  browserManager: BrowserManager,
  options: RenderPageOptions
): Promise<RenderResult> {
  await assertUrlIsSafe(options.url);

  return browserManager.withPage(async (page) => {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      isRequestUrlSafe(request.url()).then((safe) => {
        if (safe) {
          request.continue().catch(() => {});
        } else {
          request.abort('blockedbyclient').catch(() => {});
        }
      });
    });

    const start = Date.now();
    let response;
    try {
      response = await page.goto(options.url, {
        waitUntil: 'domcontentloaded',
        timeout: options.timeoutMs,
      });
    } catch (err) {
      throw new NavigationFailedError(`Failed to navigate to "${options.url}"`, { cause: err });
    }

    // Puppeteer treats timeout: 0 as "disable timeout" (wait forever), not "time out now" —
    // floor at 1ms so an already-exhausted budget still times out instead of hanging.
    const remaining = Math.max(options.timeoutMs - (Date.now() - start), 1);
    const waitCondition: WaitCondition = options.waitForSelector ? 'selector' : 'networkidle';
    let waitTimedOut = false;
    try {
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: remaining });
      } else {
        await page.waitForNetworkIdle({ idleTime: 500, timeout: remaining });
      }
    } catch {
      waitTimedOut = true;
    }

    return {
      finalUrl: page.url(),
      httpStatus: response ? response.status() : 0,
      html: await page.content(),
      title: (await page.title()) || null,
      waitCondition,
      waitTimedOut,
    };
  });
}
