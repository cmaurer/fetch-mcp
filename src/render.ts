import type { BrowserManager } from './browser.js';
import { assertUrlIsSafe, isRequestUrlSafe } from './ssrf-guard.js';
import { NavigationFailedError } from './errors.js';

interface InterceptedRequest {
  url(): string;
  continue(): Promise<unknown>;
  abort(errorCode?: string): Promise<unknown>;
}

export async function guardInterceptedRequest(request: InterceptedRequest): Promise<void> {
  const safe = await isRequestUrlSafe(request.url());
  if (safe) {
    await request.continue().catch(() => {});
  } else {
    await request.abort('blockedbyclient').catch(() => {});
  }
}

export interface RenderPageOptions {
  url: string;
  waitForSelector?: string;
  timeoutMs: number;
}

export type WaitCondition = 'selector' | 'networkidle';

// Puppeteer's default UA advertises "HeadlessChrome", which is a trivial bot-detection
// signal; present as an ordinary desktop Chrome install instead.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

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
    await page.setUserAgent(USER_AGENT);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      void guardInterceptedRequest(request);
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
