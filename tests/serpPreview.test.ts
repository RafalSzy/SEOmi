import { describe, expect, it } from 'vitest';
import { deriveSerpRichResult, deriveSerpSitelinks, formatSerpDisplayUrl, truncateSerpSnippet, truncateSerpText } from '../src/services/serpPreview';
import i18n from '@/i18n';

const fixedMeasure = (text: string) => Array.from(text).length * 10;

describe('Google SERP preview helpers', () => {
  it('truncates titles against the selected pixel width and adds an ellipsis', () => {
    expect(truncateSerpText('A title that is wider', 100, 20, fixedMeasure)).toBe('A title t…');
    expect(truncateSerpText('Short', 100, 20, fixedMeasure)).toBe('Short');
  });

  it('fits a description to two pixel-measured lines and flags omitted words', () => {
    expect(truncateSerpSnippet('alpha beta gamma delta epsilon', 60, 13, 2, fixedMeasure)).toBe('alpha beta…');
    expect(truncateSerpSnippet('alpha beta', 60, 13, 2, fixedMeasure)).toBe('alpha beta');
  });

  it('formats canonical display breadcrumbs without query strings or fragments', () => {
    expect(formatSerpDisplayUrl('https://example.com/guides/seo%20tools?utm_source=x#top'))
      .toBe('example.com › guides › seo tools');
    expect(formatSerpDisplayUrl('not-a-url')).toBe('not-a-url');
  });

  it('derives bounded sitelink candidates only from same-origin internal links', () => {
    const candidates = deriveSerpSitelinks([
      { href: 'https://example.com/about#team', text: ' O nas ', is_internal: true },
      { href: 'https://other.example/about', text: 'External', is_internal: false },
      { href: '/contact', text: 'Kontakt', is_internal: true },
      { href: 'https://example.com/about', text: 'Duplicate', is_internal: true },
    ], 'https://example.com/');
    expect(candidates).toEqual([
      { url: 'https://example.com/about', label: 'O nas', displayUrl: 'example.com › about' },
      { url: 'https://example.com/contact', label: 'Kontakt', displayUrl: 'example.com › contact' },
    ]);
  });

  it('shows rich-result evidence only when structured data contains supported fields', () => {
    const result = deriveSerpRichResult([{ data_type: 'Product', format: 'JSON-LD', content: {
      '@type': 'Product', name: 'Audyt SEO', offers: { price: '99', priceCurrency: 'PLN' }, aggregateRating: { ratingValue: 4.8, reviewCount: 12 },
    } }]);
    expect(result).toMatchObject({ type: 'Product', title: 'Product rich result' });
    expect(result?.fields).toEqual([
      { label: i18n.t('serpPreview.name'), value: 'Audyt SEO' },
      { label: i18n.t('serpPreview.price'), value: '99 PLN' },
      { label: i18n.t('serpPreview.rating'), value: '4.8 (12)' },
    ]);
    expect(deriveSerpRichResult([{ data_type: 'Thing', format: 'JSON-LD', content: { '@type': 'Product' } }])).toBeNull();
  });
});
