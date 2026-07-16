import { describe, it, expect, vi } from 'vitest';
import { renderPage } from '../src/render.js';
import { InvalidUrlError, SsrfBlockedError } from '../src/errors.js';
import type { BrowserManager } from '../src/browser.js';

function makeFakeBrowserManager(): BrowserManager {
  return {
    withPage: vi.fn(),
    close: vi.fn(),
  } as unknown as BrowserManager;
}

describe('renderPage', () => {
  it('rejects an unsafe (loopback) URL without ever touching the browser', async () => {
    const browserManager = makeFakeBrowserManager();
    await expect(
      renderPage(browserManager, { url: 'http://127.0.0.1:9/admin', timeoutMs: 5000 })
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(browserManager.withPage).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) protocol without ever touching the browser', async () => {
    const browserManager = makeFakeBrowserManager();
    await expect(
      renderPage(browserManager, { url: 'file:///etc/passwd', timeoutMs: 5000 })
    ).rejects.toBeInstanceOf(InvalidUrlError);
    expect(browserManager.withPage).not.toHaveBeenCalled();
  });
});
