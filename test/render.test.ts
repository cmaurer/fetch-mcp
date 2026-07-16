import { describe, it, expect, vi } from 'vitest';
import { renderPage, guardInterceptedRequest } from '../src/render.js';
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

describe('guardInterceptedRequest', () => {
  it('continues a request whose URL resolves to a safe (public) address', async () => {
    const request = {
      url: () => 'https://93.184.216.34/script.js',
      continue: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    await guardInterceptedRequest(request);
    expect(request.continue).toHaveBeenCalledTimes(1);
    expect(request.abort).not.toHaveBeenCalled();
  });

  it('aborts a request whose URL resolves to an unsafe (loopback) address', async () => {
    const request = {
      url: () => 'http://127.0.0.1/internal',
      continue: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    await guardInterceptedRequest(request);
    expect(request.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(request.continue).not.toHaveBeenCalled();
  });

  it('does not throw even if continue()/abort() rejects', async () => {
    const request = {
      url: () => 'https://93.184.216.34/script.js',
      continue: vi.fn().mockRejectedValue(new Error('detached frame')),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    await expect(guardInterceptedRequest(request)).resolves.toBeUndefined();
  });
});
