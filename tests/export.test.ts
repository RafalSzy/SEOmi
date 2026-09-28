import { describe, expect, it } from 'vitest';
import { auditCsv, auditImagesCsv, auditLinksCsv, backlinkGapCsv, crawlCustomSearchCsv, crawlFramesCsv, crawlImagesCsv, crawlIssuesCsv, crawlLinksCsv, crawlPagesCsv, crawlReportPayload, crawlResourcesCsv } from '@/services/export';
import type { CrawlReportTemplate } from '@/services/reportTemplates';
import { BacklinkGapReport, CrawlRunRecord, PageAuditData } from '@/types';
import i18n from '@/i18n';

const audit = { final_url: 'https://example.com', timestamp: '2026-09-20T12:00:00Z', http_status: 200, response_time_ms: 120, health_score: 88, meta_tags: { title: '=unsafe', description: 'Description', canonical: 'https://example.com' }, headings: { h1_count: 1 }, images: [], links: { total_links: 4 }, security_headers: { score: 90 }, issues: [{ severity: 'Warning', category: 'Technical', message: 'Needs "quotes"', recommendation: 'Fix it' }] } as unknown as PageAuditData;

describe('auditCsv', () => {
  it('exports real audit values and neutralizes spreadsheet formulas', () => {
    const csv = auditCsv(audit);
    expect(csv).toContain("'=unsafe");
    expect(auditCsv({ ...audit, meta_tags: { ...audit.meta_tags, title: ' \t=unsafe after whitespace' } })).toContain("' \t=unsafe after whitespace");
    expect(csv).toContain('Needs ""quotes""');
    expect(csv).toContain('"88"');
  });
});

describe('single-page table CSV exports', () => {
  it('exports every audit link and image with spreadsheet-safe cells', () => {
    const fullAudit = {
      ...audit,
      links: { total_links: 1, links: [{ href: '=unsafe-link', text: '+unsafe anchor', is_internal: true, rel: 'nofollow' }] },
      images: [{ src: '@unsafe-image', alt: '-unsafe alt', has_alt: false }],
    } as unknown as PageAuditData;

    expect(auditLinksCsv(fullAudit)).toContain("'=unsafe-link");
    expect(auditLinksCsv(fullAudit)).toContain("'+unsafe anchor");
    expect(auditImagesCsv(fullAudit)).toContain("'@unsafe-image");
    expect(auditImagesCsv(fullAudit)).toContain("'-unsafe alt");
    expect(auditLinksCsv(fullAudit)).toContain('Audited URL');
    expect(auditImagesCsv(fullAudit)).toContain('Has ALT');
  });
});

describe('backlink gap CSV export', () => {
  it('exports competitors and referring domains while neutralizing spreadsheet formulas', () => {
    const report = {
      target: 'example.com', competitors: ['competitor.example'], include_subdomains: true, rows_scanned: 1, total_rows: 1,
      opportunities: [{ referring_domain: '=unsafe.example', target_backlinks: 0, competitor_backlinks: [{ domain: 'competitor.example', backlinks: 4, rank: 55 }], max_competitor_spam_score: 12 }],
    } as BacklinkGapReport;
    const output = backlinkGapCsv(report);
    expect(output).toContain('API rows scanned');
    expect(output).toContain('competitor.example backlinks');
    expect(output).toContain("'=unsafe.example");
    expect(output).toContain('"4"');
  });
});

const crawlRun = {
  id: 'run-unsafe', completedAt: '2026-09-21T09:00:00.000Z', startUrl: 'https://example.com/',
  config: { includePatterns: ['=unsafe'], excludePatterns: [], allowSubdomains: false, scopePath: '/docs', keepQueryStrings: false, respectRobots: true, respectCrawlDelay: true, discoverSitemaps: true, maxRedirects: 10, followNofollow: false },
  result: {
    start_url: 'https://example.com/', pages_crawled: 1, health_score: 80, critical_count: 1, warning_count: 0, notice_count: 0, duration_ms: 12, cancelled: false, timed_out: false, robots_txt_status: 'loaded', robots_blocked_count: 0, sitemap_status: 'loaded', sitemap_urls_discovered: 0, sitemap_urls: [],
    pages: [{ url: '=page', final_url: '+final', redirect_chain: [], depth: 0, http_status: 200, response_time_ms: 10, title: '@title', indexability_status: 'Eligible', body_truncated: false, word_count: 10, schema_types: [], schema_syntax_errors: 0, hreflangs: [], h1_count: 1, internal_link_count: 1, external_link_count: 0, links: [{ target_url: '-link', anchor_text: '=anchor', is_internal: true }], images: [{ src: '@image', alt: '+alt', lazy_loaded: false }], issues_count: 1, issues: [{ severity: 'Warning', message: '=issue' }] }],
  },
} as CrawlRunRecord;

const crawlRunWithResources = {
  ...crawlRun,
  result: {
    ...crawlRun.result,
    resources: [{ source_urls: ['https://example.com/'], url: '=resource.css', resource_type: 'stylesheet', http_status: 200, content_type: 'text/css', content_length: 42, response_time_ms: 17 }],
  },
} as CrawlRunRecord;

describe('crawl CSV exports', () => {
  it('keeps scope, timestamp and configuration when a saved run has no rows', () => {
    const emptyRun = {
      ...crawlRun,
      result: { ...crawlRun.result, pages: [], pages_crawled: 0, resources: [] },
      config: { ...crawlRun.config, customSearches: [{ id: 'search-1', name: 'Title', selectorType: 'css', query: 'title', resultType: 'text' }] },
    } as CrawlRunRecord;
    const exports = [
      crawlPagesCsv(emptyRun), crawlLinksCsv(emptyRun), crawlImagesCsv(emptyRun),
      crawlCustomSearchCsv(emptyRun), crawlResourcesCsv(emptyRun), crawlFramesCsv(emptyRun), crawlIssuesCsv(emptyRun),
    ];
    for (const output of exports) {
      expect(output).toContain('run-unsafe');
      expect(output).toContain('2026-09-21T09:00:00.000Z');
      expect(output).toContain('https://example.com/');
      expect(output).toContain('includePatterns');
    }
    expect(crawlCustomSearchCsv(emptyRun)).toContain('Crawl configuration');
  });

  it('includes run context and neutralizes formulas in every flattened table', () => {
    expect(crawlPagesCsv(crawlRun)).toContain("'=page");
    expect(crawlPagesCsv(crawlRun)).toContain("'+final");
    expect(crawlLinksCsv(crawlRun)).toContain("'-link");
    expect(crawlLinksCsv(crawlRun)).toContain("'=anchor");
    expect(crawlImagesCsv(crawlRun)).toContain("'@image");
    expect(crawlImagesCsv(crawlRun)).toContain("'+alt");
    expect(crawlIssuesCsv(crawlRun)).toContain("'=issue");
    expect(crawlPagesCsv(crawlRun)).toContain('Scope start URL');
    expect(crawlPagesCsv(crawlRun)).toContain('Rendered LCP ms');
    expect(crawlPagesCsv(crawlRun)).toContain('Discovery sources');
    expect(crawlPagesCsv(crawlRun)).toContain('2026-09-21T09:00:00.000Z');
  });

  it('exports recorded discovery sources with each crawled URL', () => {
    const run = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          discovery_sources: [
            { kind: 'link', source_url: 'https://example.com/parent', anchor_text: 'Guide' },
            { kind: 'sitemap', source_url: 'https://example.com/sitemap.xml' },
          ],
        })),
        discovery_provenance_truncated: true,
      },
    } as CrawlRunRecord;

    const output = crawlPagesCsv(run);
    expect(output).toContain('link: https://example.com/parent: Guide | sitemap: https://example.com/sitemap.xml');
    expect(output).toContain('Discovery provenance truncated');
    expect(output).toContain('"yes"');
  });

  it('exports deterministic per-page content metrics', () => {
    const run = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          sentence_count: 4,
          average_words_per_sentence: 12.5,
          average_characters_per_word: 5.1,
          complexity_score: 83,
          complexity_label: 'simple',
          readability_ease_score: 72.4,
          readability_grade: 6.8,
          readability_label: 'standard',
          content_terms: [{ term: 'espresso', count: 4, density_percent: 12.5 }],
          focus_phrase: { phrase: 'espresso guide', body_occurrences: 2, body_density_percent: 8.3, title_occurrences: 1, meta_description_occurrences: 1, h1_occurrences: 1 },
        })),
      },
    } as CrawlRunRecord;

    const output = crawlPagesCsv(run);
    expect(output).toContain('Sentence count');
    expect(output).toContain('Average words per sentence');
    expect(output).toContain('83');
    expect(output).toContain('simple');
    expect(output).toContain('Readability ease score');
    expect(output).toContain('72.4');
    expect(output).toContain('standard');
    expect(output).toContain('Top content terms (term/count/density)');
    expect(output).toContain('espresso/4/12.50%');
    expect(output).toContain('Focus phrase evidence');
    expect(output).toContain('espresso guide; body=2');
  });

  it('exports per-hop redirect timing when it is present', () => {
    const run = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          redirect_chain: [{
            from_url: 'https://example.com/old',
            http_status: 301,
            to_url: 'https://example.com/',
            response_time_ms: 42,
          }],
          redirect_stop_reason: 'Redirect limit of 10 exceeded',
        })),
      },
    } as CrawlRunRecord;

    expect(crawlPagesCsv(run)).toContain('301: https://example.com/old -> https://example.com/ (42 ms)');
    expect(crawlPagesCsv(run)).toContain('Redirect stop reason');
    expect(crawlPagesCsv(run)).toContain('Redirect limit of 10 exceeded');
  });

  it('exports the effective per-URL robots decision with sources and header availability', () => {
    const run = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          meta_robots: 'index, nofollow',
          x_robots_tag: 'googlebot: noindex',
          robots_decision: {
            indexability: 'noindex',
            link_following: 'nofollow',
            directives: ['index', 'nofollow', 'noindex'],
            sources: ['meta robots', 'X-Robots-Tag'],
            response_headers_available: true,
          },
        })),
      },
    } as CrawlRunRecord;

    const output = crawlPagesCsv(run);
    expect(output).toContain('Robots decision');
    expect(output).toContain('noindex; nofollow');
    expect(output).toContain('index, nofollow, noindex');
    expect(output).toContain('meta robots, X-Robots-Tag');
    expect(output).toContain('headers=available');
  });

  it('exports image HTTP and byte evidence only when present in the crawl snapshot', () => {
    const run = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          images: [{ src: 'https://example.com/image.webp', alt: 'Example', lazy_loaded: true, checked_in_run: true, http_status: 206, content_length: 4096, width: 2, height: 3, dimensions_source: 'intrinsic-data-uri' }],
        })),
      },
    } as CrawlRunRecord;
    const output = crawlImagesCsv(run);

    expect(output).toContain('Resource checked in run');
    expect(output).toContain('HTTP status');
    expect(output).toContain('Content length bytes');
    expect(output).toContain('Dimensions source');
    expect(output).toContain('intrinsic-data-uri');
    expect(output).toContain('"206"');
    expect(output).toContain('"4096"');
  });

  it('exports resource records and neutralizes spreadsheet formulas', () => {
    const output = crawlResourcesCsv(crawlRunWithResources);
    expect(output).toContain("'=resource.css");
    expect(output).toContain('stylesheet');
    expect(output).toContain('text/css');
    expect(output).toContain('Response headers time ms');
    expect(output).toContain('Provenance status');
    expect(output).toContain('orphaned');
    expect(output).toContain('"17"');
  });

  it('exports static iframe evidence with source attribution and formula-safe values', () => {
    const run = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page, index) => index === 0 ? {
          ...page,
          frames: [{
            src: '=unsafe-frame', resolved_url: 'https://example.com/embed', title: 'Player',
            loading: 'lazy', sandbox: 'allow-scripts', checked_in_run: true, http_status: 200,
          }],
          frames_truncated: false,
        } : page),
      },
    } as CrawlRunRecord;
    const output = crawlFramesCsv(run);

    expect(output).toContain('Source page URL');
    expect(output).toContain("'=unsafe-frame");
    expect(output).toContain('https://example.com/embed');
    expect(output).toContain('"200"');
  });

  it('exports checked srcset candidates with status, bytes, and formula-safe URLs', () => {
    const run = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          images: [{
            src: 'https://example.com/image.webp',
            alt: 'Responsive image',
            srcset: 'https://example.com/image-2.webp 2x',
            lazy_loaded: false,
            checked_in_run: true,
            http_status: 200,
            content_length: 1024,
            srcset_resource_checks: [{
              url: '=https://example.com/image-2.webp',
              checked_in_run: true,
              http_status: 404,
              content_length: 2048,
            }],
            srcset_resource_checks_truncated: false,
          }],
        })),
      },
    } as CrawlRunRecord;

    const output = crawlImagesCsv(run);
    expect(output).toContain('Srcset candidate checks');
    expect(output).toContain("'=https://example.com/image-2.webp: 404 (2048 B)");
    expect(output).toContain('Srcset checks truncated');
  });

  it('exports HTML validation findings with source positions and escaped source excerpts', () => {
    const run = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          charset: 'windows-1252',
          detected_charset: 'UTF-8',
          html_validation_findings: [{
            code: 'html-uri-invalid',
            severity: 'Warning',
            message: 'Invalid URI',
            element: 'a',
            attribute: 'href',
            value: '=unsafe%ZZ',
            line: 7,
            column: 12,
            source_excerpt: '<a href="=unsafe%ZZ">',
          }],
          html_validation_truncated: false,
        })),
      },
    } as CrawlRunRecord;

    const output = crawlPagesCsv(run);
    expect(output).toContain('Detected charset');
    expect(output).toContain('HTML validation findings');
    expect(output).toContain('at 7:12');
    expect(output).toContain('=unsafe%ZZ');
    expect(output).toContain('source: <a href=""=unsafe%ZZ"">');
  });

  it('exports favicon and declared social-image checks without manufacturing missing status', () => {
    const run = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          favicons: ['https://example.com/favicon.ico'],
          favicon_resource_checks: [{
            url: 'https://example.com/favicon.ico', checked_in_run: true, http_status: 200,
            content_type: 'image/x-icon', content_length: 321,
          }],
          social_meta_tags: [
            {
              key: 'og:image', content: 'https://example.com/social.jpg',
              resource_check: {
                url: 'https://example.com/social.jpg', checked_in_run: true, http_status: 404,
                content_type: 'text/html', content_length: 82,
              },
            },
            {
              key: 'twitter:image', content: 'https://cdn.example.net/card.jpg',
              resource_check: { url: 'https://cdn.example.net/card.jpg', checked_in_run: false },
            },
          ],
        })),
      },
    } as CrawlRunRecord;

    const output = crawlPagesCsv(run);
    expect(output).toContain('Favicon URLs / status / bytes');
    expect(output).toContain('https://example.com/favicon.ico [HTTP 200; 321 B; image/x-icon]');
    expect(output).toContain('og:image: https://example.com/social.jpg [HTTP 404; 82 B; text/html]');
    expect(output).toContain('twitter:image: https://cdn.example.net/card.jpg [not checked in this run]');
  });

  it('exports custom-search previews with selector metadata and formula-safe values', () => {
    const run = {
      ...crawlRun,
      config: {
        ...crawlRun.config,
        customSearches: [{ id: 'sku', name: 'SKU', selectorType: 'css' as const, query: '[data-sku]', resultType: 'attribute' as const, attribute: 'data-sku' }],
      },
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          custom_search_results: [{ id: 'sku', values: ['=FORMULA', 'SKU-2'], error: null, truncated: false }],
        })),
      },
    } as CrawlRunRecord;
    const output = crawlCustomSearchCsv(run);
    expect(output).toContain('Selector type');
    expect(output).toContain('[data-sku]');
    expect(output).toContain("'=FORMULA");
    expect(output).toContain('SKU-2');
  });

  it('exports duplicate heading text, levels, and occurrence counts', () => {
    const duplicateHeadingRun = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          duplicate_headings: [{ text: 'Quick start', levels: [2, 3], occurrences: 2 }],
        })),
      },
    } as CrawlRunRecord;

    const output = crawlPagesCsv(duplicateHeadingRun);
    expect(output).toContain('Duplicate headings (text/levels/count)');
    expect(output).toContain('H2/H3: Quick start (2)');
  });

  it('exports raw social metadata and favicons from the saved crawl snapshot', () => {
    const metadataRun = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          favicons: ['=https://example.com/icon.svg'],
          favicon_metadata: [{
            href: '=https://example.com/icon.svg',
            rel: 'icon',
            declared_type: 'image/svg+xml',
            declared_sizes: 'any',
            inferred_format: 'svg',
          }],
          social_meta_tags: [
            { key: 'og:title', content: '=unsafe title' },
            { key: 'twitter:card', content: 'summary_large_image' },
          ],
        })),
      },
    } as CrawlRunRecord;
    const output = crawlPagesCsv(metadataRun);

    expect(output).toContain('Favicon URLs');
    expect(output).toContain('Favicon declarations');
    expect(output).toContain('rel=icon; type=image/svg+xml; sizes=any; format=svg');
    expect(output).toContain('Open Graph declarations');
    expect(output).toContain('Twitter Card declarations');
    expect(output).toContain("'=https://example.com/icon.svg");
    expect(output).toContain('og:title: =unsafe title');
    expect(output).toContain('twitter:card: summary_large_image');
  });

  it('exports canonical declarations, classifications, verification scope and robots conflicts', () => {
    const canonicalRun = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          canonical: 'https://example.com/canonical',
          canonical_relation: 'same-host-other-url',
          canonical_declaration_count: 1,
          canonical_robots_conflict: true,
          indexability_verdict: { status: 'uncertain', reasons: ['canonical_points_elsewhere', 'robots_nofollow'] },
          canonical_targets: [
            { url: 'https://example.com/canonical', relation: 'same-host-other-url', http_status: 404, checked_in_run: true },
            { url: 'https://example.com/not-crawled', relation: 'same-host-other-url', http_status: null, checked_in_run: false },
          ],
        })),
      },
    } as CrawlRunRecord;
    const output = crawlPagesCsv(canonicalRun);

    expect(output).toContain('Canonical relation');
    expect(output).toContain('Canonical declaration count');
    expect(output).toContain('Canonical targets/status in run');
    expect(output).toContain('Canonical/noindex conflict');
    expect(output).toContain('Indexability verdict');
    expect(output).toContain('canonical_points_elsewhere | robots_nofollow');
    expect(output).toContain('same-host-other-url');
    expect(output).toContain('HTTP 404');
    expect(output).toContain('not checked in this run');
    expect(output).toContain('"yes"');
  });

  it('exports applicable robots rules, sitemap directives and robots-blocked URLs', () => {
    const robotsRun = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        robots_txt_status: 'Loaded 1 applicable robots.txt rules',
        robots_user_agent: 'SEOmiDesktopBot/1.0',
        robots_applicable_rules: [{ directive: 'disallow', path: '/private' }],
        robots_sitemap_directives: ['https://example.com/sitemap.xml'],
        rejected_urls: [
          { url: 'https://example.com/private/page', reason: 'Blocked by robots.txt Disallow rule: /private' },
          { url: 'https://example.com/outside', reason: 'Outside configured crawl scope' },
        ],
      },
    } as CrawlRunRecord;
    const output = crawlPagesCsv(robotsRun);

    expect(output).toContain('Applicable robots rules');
    expect(output).toContain('SEOmiDesktopBot/1.0');
    expect(output).toContain('DISALLOW: /private');
    expect(output).toContain('https://example.com/sitemap.xml');
    expect(output).toContain('https://example.com/private/page');
    expect(output).not.toContain('https://example.com/outside');
  });

  it('exports client-side redirect source, delay, raw declaration and resolved target', () => {
    const redirectRun = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          client_redirects: [
            { source: 'meta-refresh', declaration: "0; URL='/next'", delay_seconds: 0, target_url: 'https://example.com/next' },
            { source: 'http-refresh', declaration: '5; url="/later"', delay_seconds: 5, target_url: 'https://example.com/later' },
          ],
        })),
      },
    } as CrawlRunRecord;
    const output = crawlPagesCsv(redirectRun);

    expect(output).toContain('Client-side redirects');
    expect(output).toContain(`${i18n.t('crawlDeepUi.mechanismMetaRefresh')}; delay=0s; target=https://example.com/next`);
    expect(output).toContain(`${i18n.t('crawlDeepUi.mechanismHttpRefresh')}; delay=5s; target=https://example.com/later`);
  });

  it('exports pagination declarations, query changes, canonical alignment and in-run HTTP status', () => {
    const paginationRun = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          pagination_declaration_count: 1,
          pagination_invalid_declaration_count: 0,
          pagination_canonical_alignment: 'self-canonical',
          pagination_links: [{
            relation: 'next', target_url: 'https://example.com/articles?page=2',
            query_parameter_changes: ['page: 1 → 2'], http_status: 200, checked_in_run: true,
          }],
        })),
      },
    } as CrawlRunRecord;
    const output = crawlPagesCsv(paginationRun);

    expect(output).toContain('Pagination declarations');
    expect(output).toContain('Pagination/canonical alignment');
    expect(output).toContain('self-canonical');
    expect(output).toContain('next: https://example.com/articles?page=2 (HTTP 200; page: 1 → 2)');
  });

  it('exports hreflang target verification evidence without inventing out-of-run status', () => {
    const internationalRun = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          hreflangs: [
            { language: 'en', target_url: 'https://example.com/en/', target_http_status: 200, target_checked_in_run: true, reciprocal_in_run: true, target_canonical_alignment: 'self-canonical' },
            { language: 'de', target_url: 'https://example.com/de/', target_http_status: null, target_checked_in_run: false, reciprocal_in_run: null, target_canonical_alignment: null },
          ],
        })),
      },
    } as CrawlRunRecord;
    const output = crawlPagesCsv(internationalRun);

    const crawlHeaders = i18n.t('exportUi.headers.crawlPages', { returnObjects: true }) as string[];
    expect(output).toContain(crawlHeaders.find((header) => header.includes('Hreflang'))!);
    expect(output).toContain(`en: https://example.com/en/ (${i18n.t('exportUi.statuses.http', { status: 200 })}; ${i18n.t('exportUi.statuses.reciprocalYes')}; self-canonical)`);
    expect(output).toContain(`de: https://example.com/de/ (${i18n.t('exportUi.statuses.notChecked')}; ${i18n.t('exportUi.statuses.reciprocityUnverified')}; ${i18n.t('exportUi.statuses.canonicalUnverified')})`);
  });

  it('exports the declared AMP URL and whether its HTTP response was checked in-run', () => {
    const ampRun = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({
          ...page,
          amp_url: 'https://example.com/amp/',
          amp_target_http_status: 404,
          amp_target_checked_in_run: true,
          amp_target_canonical_alignment: 'canonical-points-elsewhere',
        })),
      },
    } as CrawlRunRecord;
    const output = crawlPagesCsv(ampRun);

    expect(output).toContain('AMP target status');
    expect(output).toContain('AMP target checked in run');
    expect(output).toContain('AMP target canonical alignment');
    expect(output).toContain('https://example.com/amp/');
    expect(output).toContain('"404"');
    expect(output).toContain('"yes"');
    expect(output).toContain('"no"');
  });

  it('exports external link check status, redirects, errors and timestamps', () => {
    const checkedRun = {
      ...crawlRun,
      result: {
        ...crawlRun.result,
        pages: crawlRun.result.pages.map((page) => ({ ...page, links: [{
          target_url: 'https://outside.example/', anchor_text: 'outside', rel: 'nofollow', is_internal: false,
          target_http_status: 302, target_response_time_ms: 48, target_redirect_url: 'https://new.example/',
          target_request_error_kind: undefined, target_checked_at: '2026-09-22T12:00:00.000Z',
        }] })),
      },
    } as CrawlRunRecord;
    const output = crawlLinksCsv(checkedRun);
    expect(output).toContain('Target response time ms');
    expect(output).toContain('https://new.example/');
    expect(output).toContain('302');
    expect(output).toContain('2026-09-22T12:00:00.000Z');
  });
});

describe('crawl report templates', () => {
  it('exports only the selected JSON sections while keeping the run envelope', () => {
    const template: CrawlReportTemplate = {
      id: 'technical-qa', name: 'Technical QA', sections: ['summary', 'issues', 'semantic'],
      createdAt: '2026-09-21T09:00:00.000Z', updatedAt: '2026-09-21T09:00:00.000Z',
    };
    const payload = crawlReportPayload(crawlRun, template);
    const result = payload.result as Record<string, unknown>;
    expect(payload.report_template).toMatchObject({ id: 'technical-qa', sections: ['summary', 'issues', 'semantic'] });
    expect(result.pages).toBeUndefined();
    expect(result.limit_reasons).toEqual([]);
    expect(result.links).toBeUndefined();
    expect(result.issues).toEqual([{ page_url: '=page', severity: 'Warning', message: '=issue' }]);
    expect(result.semantic).toEqual([{ url: '=page', final_url: '+final', title: '@title', semantic_terms: [], semantic_excerpts: [], semantic_links: [], content_hash: undefined, content_simhash: undefined }]);
  });
});
