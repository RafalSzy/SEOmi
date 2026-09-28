import { describe, expect, it } from 'vitest';
import { SiteCrawlResult } from '../src/types';
import { compareCrawlResults, crawlComparisonKey } from '../src/services/crawlDiff';
import i18n from '@/i18n';

const page = (url: string, patch: Partial<SiteCrawlResult['pages'][number]> = {}) => ({
  url, final_url: url, redirect_chain: [], depth: 0, http_status: 200, response_time_ms: 10,
  title: 'Title', indexability_status: 'Eligible from this response only', h1_count: 1,
  word_count: 0,
  body_truncated: false,
  schema_types: [], schema_syntax_errors: 0,
  hreflangs: [],
  internal_link_count: 0, external_link_count: 0, links: [], images: [], issues_count: 0, issues: [], ...patch,
});

const result = (pages: SiteCrawlResult['pages']): SiteCrawlResult => ({
  start_url: 'https://example.com/', pages_crawled: pages.length, health_score: 100,
  critical_count: 0, warning_count: 0, notice_count: 0, pages, duration_ms: 10, cancelled: false, timed_out: false,
  robots_txt_status: 'loaded', robots_blocked_count: 0, sitemap_status: 'loaded', sitemap_urls_discovered: 0,
  sitemap_urls: [],
});

describe('compareCrawlResults', () => {
  it('reports only explicit added, removed, and changed URL evidence', () => {
    const baseline = result([page('https://example.com/a'), page('https://example.com/removed')]);
    const current = result([page('https://example.com/a', { http_status: 404 }), page('https://example.com/added')]);
    const diff = compareCrawlResults(current, baseline);

    expect(diff.added.map((change) => change.url)).toEqual(['https://example.com/added']);
    expect(diff.removed.map((change) => change.url)).toEqual(['https://example.com/removed']);
    expect(diff.changed).toEqual([{ kind: 'changed', url: 'https://example.com/a', fields: [i18n.t('crawlDiff.fields.httpStatus')] }]);
  });

  it('matches staging and production by path while preserving meaningful query parameters', () => {
    const baseline = result([
      page('https://staging.example.com/docs/guide/?utm_source=newsletter&lang=pl', { title: 'Staging title' }),
      page('https://staging.example.com/docs/removed'),
    ]);
    const current = result([
      page('https://www.example.com/docs/guide?lang=pl', { title: 'Production title' }),
      page('https://www.example.com/docs/added'),
    ]);

    const diff = compareCrawlResults(current, baseline, { matchByPath: true });

    expect(crawlComparisonKey('https://staging.example.com/docs/guide/?utm_source=x&lang=pl', true)).toBe('/docs/guide?lang=pl');
    expect(diff.changed).toEqual([{
      kind: 'changed',
      url: 'https://www.example.com/docs/guide?lang=pl',
      matchedUrl: 'https://staging.example.com/docs/guide/?utm_source=newsletter&lang=pl',
      fields: [i18n.t('crawlDiff.fields.title')],
    }]);
    expect(diff.added.map((change) => change.url)).toEqual(['https://www.example.com/docs/added']);
    expect(diff.removed.map((change) => change.url)).toEqual(['https://staging.example.com/docs/removed']);
  });

  it('does not collapse distinct non-tracking query parameters in environment mode', () => {
    expect(crawlComparisonKey('https://staging.example.com/search?q=seo', true)).not.toBe(
      crawlComparisonKey('https://production.example.com/search?q=marketing', true),
    );
  });
});
