import { describe, expect, it } from 'vitest';
import { getAmpProblems, getMetadataProblems, getSocialProblems, getStructuredDataProblems } from '@/services/auditProblems';
import { PageAuditData } from '@/types';
import i18n from '@/i18n';

const audit = (overrides: Partial<PageAuditData> = {}): PageAuditData => ({
  url: 'https://example.com', final_url: 'https://example.com', timestamp: '2026-09-22T00:00:00.000Z', http_status: 200, response_time_ms: 120, redirect_chain: [],
  meta_tags: { title: 'A'.repeat(55), title_length: 55, description: 'A'.repeat(140), description_length: 140, canonical: 'https://example.com', viewport: 'width=device-width', other_tags: [] },
  open_graph: { og_title: 'Title', og_description: 'Description', og_image: 'https://example.com/card.png', all_tags: [] },
  twitter_card: { twitter_card: 'summary_large_image', twitter_title: 'Title', twitter_description: 'Description', twitter_image: 'https://example.com/card.png', all_tags: [] },
  headings: { h1_count: 1, h1_texts: ['Topic'], hierarchy: [], has_valid_hierarchy: true, issues: [] }, images: [], links: { total_links: 0, internal_links: 0, external_links: 0, nofollow_links: 0, links: [] }, security_headers: { score: 90 }, structured_data: [{ data_type: 'Organization', format: 'JSON-LD', content: { '@type': 'Organization' } }], technical: { hreflang_tags: [] }, health_score: 100, issues: [], content_stats: { word_count: 100, reading_time_minutes: 1, text_ratio_percent: 10, top_keywords: [] },
  ...overrides,
});

describe('audit problem predicates', () => {
  it('does not label valid metadata as a problem', () => {
    expect(getMetadataProblems(audit())).toEqual([]);
  });

  it('reports missing and broken metadata with evidence', () => {
    const problems = getMetadataProblems(audit({
      meta_tags: { title_length: 0, description_length: 0, other_tags: [] },
      indexability: { status: 'blocked', reasons: ['X-Robots-Tag: noindex'], canonical_target_checked: true, canonical_target_status: 404 },
    }));
    expect(problems.map((problem) => problem.id)).toEqual(expect.arrayContaining(['metadata-title-missing', 'metadata-description-missing', 'metadata-canonical-missing', 'metadata-viewport-missing', 'metadata-canonical-target', 'metadata-indexing-blocked']));
  });

  it('shows only missing social declarations as social problems', () => {
    expect(getSocialProblems(audit())).toEqual([]);
    expect(getSocialProblems(audit({ open_graph: { all_tags: [] }, twitter_card: { all_tags: [] } })).map((problem) => problem.id)).toHaveLength(7);
  });

  it('does not invent schema validation findings', () => {
    expect(getStructuredDataProblems(audit())).toEqual([]);
    expect(getStructuredDataProblems(audit({ structured_data: [] }))).toMatchObject([{ id: 'structured-data-missing' }]);
  });

  it('surfaces only recorded structured-data errors and warnings in the problems filter', () => {
    const problems = getStructuredDataProblems(audit({ structured_data: [{
      data_type: 'Product', format: 'JSON-LD', content: { '@type': 'Product' },
      validation_issues: [
        { code: 'product-name-missing', severity: 'warning', message: 'Product has no name.' },
        { code: 'jsonld-syntax-invalid', severity: 'error', message: 'JSON parse failed.' },
        { code: 'jsonld-context-not-detected', severity: 'info', message: 'No Schema.org context.' },
      ],
    }] }));
    expect(problems).toHaveLength(2);
    expect(problems.map((problem) => problem.evidence)).toEqual(expect.arrayContaining([
      expect.stringContaining('Product has no name.'), expect.stringContaining('JSON parse failed.'),
    ]));
    expect(problems.some((problem) => problem.detail.includes('No Schema.org context.'))).toBe(false);
    expect(problems.every((problem) => !problem.detail.includes('Product has no name.'))).toBe(true);
  });

  it('surfaces only AMP errors and warnings without inferring target-network failures', () => {
    const problems = getAmpProblems(audit({
      amp: {
        detected: true,
        is_amp_document: true,
        amphtml_urls: [],
        canonical_url: 'https://example.com/page',
        coverage: 'partial-local-rules',
        findings: [
          { code: 'amp-runtime-missing', severity: 'error', message: 'Runtime missing.', evidence: 'No runtime script.', recommendation: 'Add it.' },
          { code: 'amp-css-size', severity: 'warning', message: 'CSS is oversized.', evidence: 'Measured bytes.', recommendation: 'Reduce CSS.' },
          { code: 'amp-validator-not-run', severity: 'info', message: 'Official validator not run.', evidence: 'Local-only check.', recommendation: 'Use official validator.' },
        ],
        unchecked: ['Target HTTP status'],
      },
    }));
    expect(problems).toHaveLength(2);
    expect(problems.map((problem) => problem.id)).toEqual(['amp-amp-runtime-missing', 'amp-amp-css-size']);
    expect(problems.every((problem) => problem.detail.includes(`${i18n.t('auditProblems.recommendation')}:`))).toBe(true);
  });
});
