import { describe, expect, it } from 'vitest';
import { buildLocalAuditChecks } from '@/services/auditChecks';
import { PageAuditData } from '@/types';
import i18n from '@/i18n';

const audit = (overrides: Partial<PageAuditData> = {}): PageAuditData => ({
  url: 'https://example.com', final_url: 'https://example.com', timestamp: '2026-09-21T00:00:00.000Z', http_status: 200, response_time_ms: 120, redirect_chain: [],
  meta_tags: { title: 'Prawidłowy tytuł strony testowej', title_length: 32, description: 'Opis strony o prawidłowej długości, wystarczający do kontroli lokalnego audytu SEO.', description_length: 84, canonical: 'https://example.com', other_tags: [] },
  open_graph: { all_tags: [] }, twitter_card: { all_tags: [] }, headings: { h1_count: 1, h1_texts: ['Temat'], hierarchy: [], has_valid_hierarchy: true, issues: [] }, images: [], links: { total_links: 0, internal_links: 0, external_links: 0, nofollow_links: 0, links: [] }, security_headers: { score: 90 }, structured_data: [], technical: { hreflang_tags: [] }, health_score: 100, issues: [], content_stats: { word_count: 100, reading_time_minutes: 1, text_ratio_percent: 10, top_keywords: [] },
  ...overrides,
});

describe('buildLocalAuditChecks', () => {
  it('exposes a stable 100+ point coverage contract with categories', () => {
    const checks = buildLocalAuditChecks(audit());
    expect(checks.length).toBeGreaterThanOrEqual(100);
    expect(new Set(checks.map((item) => item.id)).size).toBe(checks.length);
    expect(new Set(checks.map((item) => item.category)).size).toBeGreaterThanOrEqual(10);
    expect(checks.every((item) => item.evidence.trim().length > 0)).toBe(true);
  });

  it('reports only evidence-backed passed checks', () => {
    const checks = buildLocalAuditChecks(audit());
    expect(checks.find((item) => item.id === 'http')).toMatchObject({ status: 'pass', evidence: 'HTTP 200' });
    expect(checks.find((item) => item.id === 'images-alt')).toMatchObject({ status: 'not_applicable' });
  });

  it('reports missing and non-responsive viewport declarations explicitly', () => {
    expect(buildLocalAuditChecks(audit()).find((item) => item.id === 'viewport')).toMatchObject({
      status: 'error',
      evidence: i18n.t('auditChecks.evidence.missingViewport'),
    });
    expect(buildLocalAuditChecks(audit({
      meta_tags: {
        title: 'Prawidłowy tytuł strony testowej',
        title_length: 32,
        description: 'Opis strony o prawidłowej długości, wystarczający do kontroli lokalnego audytu SEO.',
        description_length: 84,
        canonical: 'https://example.com',
        viewport: 'initial-scale=1',
        other_tags: [],
      },
    })).find((item) => item.id === 'viewport')).toMatchObject({ status: 'warning' });
    expect(buildLocalAuditChecks(audit({
      meta_tags: {
        title: 'Prawidłowy tytuł strony testowej',
        title_length: 32,
        description: 'Opis strony o prawidłowej długości, wystarczający do kontroli lokalnego audytu SEO.',
        description_length: 84,
        canonical: 'https://example.com',
        viewport: 'width=device-width, initial-scale=1',
        other_tags: [],
      },
    })).find((item) => item.id === 'viewport')).toMatchObject({ status: 'pass' });
  });

  it('reports missing title and HTTP failure as errors', () => {
    const checks = buildLocalAuditChecks(audit({ http_status: 404, meta_tags: { title_length: 0, description_length: 0, other_tags: [] } }));
    expect(checks.find((item) => item.id === 'http')?.status).toBe('error');
    expect(checks.find((item) => item.id === 'title')?.status).toBe('error');
  });

  it('uses the unified indexability verdict when an audit includes it', () => {
    const checks = buildLocalAuditChecks(audit({
      indexability: {
        status: 'blocked',
        reasons: ['Nagłówek X-Robots-Tag zawiera dyrektywę noindex lub none.'],
        x_robots_tag: 'noindex',
      },
    }));

    expect(checks.find((item) => item.id === 'indexability')).toMatchObject({
      status: 'error',
      evidence: expect.stringContaining('X-Robots-Tag'),
    });
  });

  it('reports static accessibility evidence without pretending to test contrast', () => {
    const checks = buildLocalAuditChecks(audit({
      accessibility: {
        document_language: 'pl',
        landmarks: [{ name: 'main', count: 1 }],
        aria_attribute_count: 2,
        form_control_count: 1,
        unlabeled_form_control_count: 0,
        manual_review_items: ['Kontrast kolorów wymaga renderowanego widoku strony.'],
      },
    }));

    expect(checks.find((item) => item.id === 'accessibility-basics')).toMatchObject({
      status: 'pass',
      evidence: expect.stringContaining('lang=pl'),
    });
  });
});
