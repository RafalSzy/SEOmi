import { describe, expect, it } from 'vitest';
import { crawlErrorKinds, crawlErrorLabel, filterCrawlErrors } from '@/services/crawlErrors';
import i18n from '@/i18n';

describe('crawl error filters', () => {
  const records = [
    { url: 'https://example.com/ok', http_status: 200 },
    { url: 'https://example.com/not-found', http_status: 404 },
    { url: 'https://example.com/dns', request_error_kind: 'dns' },
    { url: 'https://example.com/tls', request_error_kind: 'tls' },
    { url: 'https://example.com/timeout', request_error_kind: 'timeout' },
  ];

  it('offers only error kinds found in the crawl and sorts common kinds predictably', () => {
    expect(crawlErrorKinds(records)).toEqual(['http', 'dns', 'tls', 'timeout']);
    expect(crawlErrorKinds(records).map(crawlErrorLabel)).toEqual([
      i18n.t('crawl.ui.errorKinds.http'), i18n.t('crawl.ui.errorKinds.dns'), i18n.t('crawl.ui.errorKinds.tls'), i18n.t('crawl.ui.errorKinds.timeout'),
    ]);
  });

  it('filters HTTP status failures separately from transport errors', () => {
    expect(filterCrawlErrors(records, 'http').map((record) => record.url)).toEqual(['https://example.com/not-found']);
    expect(filterCrawlErrors(records, 'dns').map((record) => record.url)).toEqual(['https://example.com/dns']);
    expect(filterCrawlErrors(records, 'all')).toHaveLength(records.length);
  });
});
