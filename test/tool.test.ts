import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/render.js', () => ({
  renderPage: vi.fn(),
}));
vi.mock('../src/extract.js', () => ({
  extractContent: vi.fn(),
}));

import { renderPage } from '../src/render.js';
import { extractContent } from '../src/extract.js';
import { registerFetchPageTool } from '../src/tool.js';
import { SsrfBlockedError } from '../src/errors.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BrowserManager } from '../src/browser.js';

type Handler = (input: Record<string, unknown>) => Promise<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: Array<{ type: 'text'; text: string }>;
}>;

function captureHandler(): Handler {
  let handler: Handler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _config: unknown, cb: Handler) => {
      handler = cb;
    },
  } as unknown as McpServer;
  registerFetchPageTool(fakeServer, {} as BrowserManager);
  if (!handler) throw new Error('registerTool was not called');
  return handler;
}

describe('fetch_page tool handler', () => {
  it('returns structuredContent mapped from renderPage + extractContent on success', async () => {
    vi.mocked(renderPage).mockResolvedValue({
      finalUrl: 'https://example.com/',
      httpStatus: 200,
      html: '<html></html>',
      title: 'Example',
      waitCondition: 'networkidle',
      waitTimedOut: false,
    });
    vi.mocked(extractContent).mockReturnValue({
      content: 'Example content',
      extractionMethod: 'readability',
      truncated: false,
    });

    const handler = captureHandler();
    const result = await handler({
      url: 'https://example.com',
      timeoutMs: 30000,
      rawHtml: false,
      maxContentLength: 50000,
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      requestedUrl: 'https://example.com',
      finalUrl: 'https://example.com/',
      httpStatus: 200,
      content: 'Example content',
      extractionMethod: 'readability',
    });
  });

  it('returns an isError result instead of throwing when renderPage fails', async () => {
    vi.mocked(renderPage).mockRejectedValue(new SsrfBlockedError('blocked 10.0.0.1'));

    const handler = captureHandler();
    const result = await handler({
      url: 'http://10.0.0.1',
      timeoutMs: 30000,
      rawHtml: false,
      maxContentLength: 50000,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('SsrfBlockedError');
  });
});
