import { describe, it, expect } from 'vitest';
import { extractContent } from '../src/extract.js';

const ARTICLE_HTML = `<!doctype html>
<html>
<head><title>A Long Article About Testing</title></head>
<body>
  <header><nav>Home | About | Contact</nav></header>
  <main>
    <article>
      <h1>A Long Article About Testing</h1>
      <p>Software testing is the process of evaluating and verifying that a software product does what it is supposed to do. The benefits of testing include preventing bugs, reducing development costs, and improving performance.</p>
      <p>There are many kinds of testing, from unit tests that check a single function in isolation, to integration tests that check how multiple components work together, to end-to-end tests that exercise the whole system the way a real user would.</p>
      <p>Automated tests are valuable because they can run quickly and repeatedly, catching regressions before they reach production. A well designed test suite gives engineers the confidence to refactor code without fear of silently breaking existing behavior.</p>
      <p>Good tests are specific, deterministic, and fast. They should fail for exactly one reason, and that reason should be obvious from the test's name and assertions. Flaky tests erode trust in the whole suite and should be fixed or removed.</p>
      <p>In the end, the goal of testing is not to achieve one hundred percent coverage for its own sake, but to build justified confidence that the software behaves correctly for the situations that actually matter to its users.</p>
    </article>
  </main>
  <footer>Copyright 2026</footer>
</body>
</html>`;

const DASHBOARD_HTML = `<!doctype html>
<html>
<head><title>Dashboard</title></head>
<body>
  <div id="app">
    <nav class="sidebar">
      <button>Home</button>
      <button>Reports</button>
      <button>Settings</button>
    </nav>
    <div class="widgets">
      <div class="widget"><span class="label">Revenue</span><span class="value">$12,345</span></div>
      <div class="widget"><span class="label">Users</span><span class="value">4,201</span></div>
      <div class="widget"><span class="label">Errors</span><span class="value">3</span></div>
    </div>
  </div>
</body>
</html>`;

describe('extractContent', () => {
  it('extracts article content via Readability for article-shaped HTML', () => {
    const result = extractContent(ARTICLE_HTML, 'https://example.com/article', {
      maxContentLength: 50000,
    });
    expect(result.extractionMethod).toBe('readability');
    expect(result.content).toContain('Software testing');
    expect(result.truncated).toBe(false);
  });

  it('falls back to the full body for dashboard-shaped HTML with no article content', () => {
    const result = extractContent(DASHBOARD_HTML, 'https://example.com/dashboard', {
      maxContentLength: 50000,
    });
    expect(result.extractionMethod).toBe('body-fallback');
    expect(result.content.trim().length).toBeGreaterThan(0);
    expect(result.content).toContain('Revenue');
  });

  it('truncates content longer than maxContentLength and notes the truncation', () => {
    const result = extractContent(ARTICLE_HTML, 'https://example.com/article', {
      maxContentLength: 50,
    });
    expect(result.truncated).toBe(true);
    expect(result.content).toContain('[content truncated]');
  });

  it('passes through raw HTML unchanged when rawHtml is true', () => {
    const result = extractContent(ARTICLE_HTML, 'https://example.com/article', {
      rawHtml: true,
      maxContentLength: 50000,
    });
    expect(result.extractionMethod).toBe('raw-html');
    expect(result.content).toBe(ARTICLE_HTML);
  });
});
