import { describe, expect, it } from 'vitest';
import type { CrawledPageSummary } from '@/types';
import { buildCrawlDirectoryTree, filterCrawlPagesForDirectoryTree } from '@/services/crawlDirectoryTree';

const page = (overrides: Partial<CrawledPageSummary>): CrawledPageSummary => ({
  url: 'https://example.com/',
  title: '',
  http_status: 200,
  response_time_ms: 100,
  word_count: 10,
  issues: [],
  ...overrides,
} as CrawledPageSummary);

describe('crawl directory tree', () => {
  const pages = [
    page({ url: 'https://example.com/', indexability_status: 'Eligible for indexing' }),
    page({ url: 'https://example.com/blog/', http_status: 404, title: 'Blog index', indexability_status: 'Blocked by robots.txt', issues: [{ severity: 'Critical' } as never] }),
    page({ url: 'https://example.com/blog/post?sort=recent', title: 'Post', response_time_ms: 1000, word_count: 200, indexability_status: 'Eligible for indexing', issues: [{ severity: 'Warning' } as never] }),
    page({ url: 'https://other.example/deep/page', http_status: 0, request_error_kind: 'timeout', response_time_ms: -1, word_count: 0 }),
    page({ url: 'not a URL' }),
  ];

  it('groups by origin and path while aggregating only observed page metrics', () => {
    const tree = buildCrawlDirectoryTree(pages);
    expect(tree.pageCount).toBe(4);
    expect(tree.ignoredPageCount).toBe(1);
    expect(tree.metrics).toMatchObject({
      status2xx: 2,
      status4xx: 1,
      requestErrors: 1,
      criticalIssues: 1,
      warningIssues: 1,
      indexable: 2,
      excluded: 1,
      words: 220,
      averageResponseMs: 400,
    });

    const example = tree.roots.find((root) => root.name === 'https://example.com');
    expect(example?.ownPages).toHaveLength(1);
    const blog = example?.childDirectories.find((directory) => directory.name === 'blog');
    expect(blog?.metrics.pageCount).toBe(2);
    expect(blog?.ownPages[0].url).toBe('https://example.com/blog/');
    expect(blog?.childDirectories[0].ownPages[0].url).toBe('https://example.com/blog/post?sort=recent');
  });

  it('filters by URL, title, status, or indexability without changing source pages', () => {
    expect(filterCrawlPagesForDirectoryTree(pages, 'recent')).toHaveLength(1);
    expect(filterCrawlPagesForDirectoryTree(pages, 'blog index')).toHaveLength(1);
    expect(filterCrawlPagesForDirectoryTree(pages, '404')).toHaveLength(1);
    expect(filterCrawlPagesForDirectoryTree(pages, 'blocked')).toHaveLength(1);
    expect(filterCrawlPagesForDirectoryTree(pages, '   ')).toBe(pages);
  });

  it('indexes thousands of sibling paths and keeps every URL represented', () => {
    const manyPages = Array.from({ length: 5000 }, (_, index) => page({ url: `https://wide.example/section-${String(index).padStart(4, '0')}/item` }));
    const tree = buildCrawlDirectoryTree(manyPages);

    expect(tree.pageCount).toBe(5000);
    expect(tree.roots[0].childDirectories).toHaveLength(5000);
    expect(tree.roots[0].metrics.words).toBe(50000);
  });
});
