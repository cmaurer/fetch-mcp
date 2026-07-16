import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const MIN_ARTICLE_TEXT_LENGTH = 200;

const turndownService = new TurndownService({ headingStyle: 'atx' });
turndownService.use(gfm);

export interface ExtractOptions {
  rawHtml?: boolean;
  maxContentLength: number;
}

export type ExtractionMethod = 'readability' | 'body-fallback' | 'raw-html';

export interface ExtractResult {
  content: string;
  extractionMethod: ExtractionMethod;
  truncated: boolean;
}

export function extractContent(
  html: string,
  baseUrl: string,
  options: ExtractOptions
): ExtractResult {
  if (options.rawHtml) {
    return truncate(html, options.maxContentLength, 'raw-html');
  }

  const article = tryExtractArticle(html, baseUrl);
  if (article) {
    return truncate(turndownService.turndown(article), options.maxContentLength, 'readability');
  }

  const bodyHtml = extractBodyHtml(html, baseUrl);
  return truncate(turndownService.turndown(bodyHtml), options.maxContentLength, 'body-fallback');
}

function tryExtractArticle(html: string, baseUrl: string): string | null {
  const dom = new JSDOM(html, { url: baseUrl });
  const parsed = new Readability(dom.window.document).parse();
  if (!parsed || !parsed.content || !parsed.textContent || parsed.textContent.trim().length < MIN_ARTICLE_TEXT_LENGTH) {
    return null;
  }
  return parsed.content;
}

function extractBodyHtml(html: string, baseUrl: string): string {
  const dom = new JSDOM(html, { url: baseUrl });
  return dom.window.document.body?.innerHTML ?? '';
}

function truncate(content: string, maxLength: number, method: ExtractionMethod): ExtractResult {
  if (content.length <= maxLength) {
    return { content, extractionMethod: method, truncated: false };
  }
  return {
    content: `${content.slice(0, maxLength)}\n\n[content truncated]`,
    extractionMethod: method,
    truncated: true,
  };
}
