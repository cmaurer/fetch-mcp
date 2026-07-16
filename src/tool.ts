import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { BrowserManager } from './browser.js';
import { renderPage } from './render.js';
import { extractContent } from './extract.js';
import { toToolError } from './errors.js';

export const fetchPageInputShape = {
  url: z.string().url().describe('The URL of the page to fetch and render.'),
  waitForSelector: z
    .string()
    .optional()
    .describe('A CSS selector to wait for before extracting content.'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(30000)
    .describe('Total time budget in milliseconds.'),
  rawHtml: z
    .boolean()
    .default(false)
    .describe('Return raw rendered HTML instead of extracted Markdown.'),
  maxContentLength: z
    .number()
    .int()
    .positive()
    .default(50000)
    .describe('Maximum characters of returned content.'),
};

export const fetchPageOutputShape = {
  requestedUrl: z.string(),
  finalUrl: z.string(),
  httpStatus: z.number(),
  title: z.string().nullable(),
  extractionMethod: z.enum(['readability', 'body-fallback', 'raw-html']),
  waitCondition: z.enum(['selector', 'networkidle']),
  waitTimedOut: z.boolean(),
  truncated: z.boolean(),
  content: z.string(),
};

export function registerFetchPageTool(server: McpServer, browserManager: BrowserManager): void {
  server.registerTool(
    'fetch_page',
    {
      title: 'Fetch Page',
      description:
        'Fetches a URL, fully renders it in a headless browser (so JS-heavy SPAs populate their DOM), and returns clean, scrapeable content.',
      inputSchema: fetchPageInputShape,
      outputSchema: fetchPageOutputShape,
    },
    async (input, _extra) => {
      try {
        const rendered = await renderPage(browserManager, {
          url: input.url,
          waitForSelector: input.waitForSelector,
          timeoutMs: input.timeoutMs,
        });
        const extracted = extractContent(rendered.html, rendered.finalUrl, {
          rawHtml: input.rawHtml,
          maxContentLength: input.maxContentLength,
        });
        const structuredContent = {
          requestedUrl: input.url,
          finalUrl: rendered.finalUrl,
          httpStatus: rendered.httpStatus,
          title: rendered.title,
          extractionMethod: extracted.extractionMethod,
          waitCondition: rendered.waitCondition,
          waitTimedOut: rendered.waitTimedOut,
          truncated: extracted.truncated,
          content: extracted.content,
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );
}
