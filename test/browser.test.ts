import { describe, it, expect, vi, beforeEach } from 'vitest';

const launchMock = vi.fn();

vi.mock('puppeteer', () => ({
  default: { launch: (...args: unknown[]) => launchMock(...args) },
}));

import { BrowserManager } from '../src/browser.js';

function makeFakeBrowser() {
  const pages: Array<{ closed: boolean; close: () => Promise<void> }> = [];
  const browser = {
    newPage: vi.fn(async () => {
      const page = {
        closed: false,
        close: vi.fn(async function (this: { closed: boolean }) {
          this.closed = true;
        }),
      };
      pages.push(page as { closed: boolean; close: () => Promise<void> });
      return page;
    }),
    close: vi.fn(async () => {}),
  };
  return { browser, pages };
}

beforeEach(() => {
  launchMock.mockReset();
});

describe('BrowserManager', () => {
  it('launches the browser lazily, only once, across multiple withPage calls', async () => {
    const { browser } = makeFakeBrowser();
    launchMock.mockResolvedValue(browser);
    const manager = new BrowserManager();

    await manager.withPage(async () => 'first');
    await manager.withPage(async () => 'second');

    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it('closes the page after the callback finishes, even if it throws', async () => {
    const { browser, pages } = makeFakeBrowser();
    launchMock.mockResolvedValue(browser);
    const manager = new BrowserManager();

    await expect(
      manager.withPage(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(pages).toHaveLength(1);
    expect(pages[0].closed).toBe(true);
  });

  it('never runs more than 3 callbacks concurrently', async () => {
    const { browser } = makeFakeBrowser();
    launchMock.mockResolvedValue(browser);
    const manager = new BrowserManager();

    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 8 }, () =>
      manager.withPage(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      })
    );

    await Promise.all(tasks);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('closes the browser on close()', async () => {
    const { browser } = makeFakeBrowser();
    launchMock.mockResolvedValue(browser);
    const manager = new BrowserManager();

    await manager.withPage(async () => 'warm up');
    await manager.close();

    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('clears the cached launch promise on failure so a later withPage call retries', async () => {
    launchMock.mockRejectedValueOnce(new Error('chromium failed to start'));
    const manager = new BrowserManager();

    await expect(manager.withPage(async () => 'never')).rejects.toThrow(
      'chromium failed to start'
    );

    const { browser } = makeFakeBrowser();
    launchMock.mockResolvedValue(browser);
    await expect(manager.withPage(async () => 'recovered')).resolves.toBe('recovered');
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it('closes the browser only once when close() is called concurrently', async () => {
    const { browser } = makeFakeBrowser();
    launchMock.mockResolvedValue(browser);
    const manager = new BrowserManager();

    await manager.withPage(async () => 'warm up');
    await Promise.all([manager.close(), manager.close()]);

    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
