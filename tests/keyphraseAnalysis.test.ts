import { describe, expect, it } from 'vitest';
import { analyzeKeyphrase, flattenHeadings } from '@/services/keyphraseAnalysis';
import { PageAuditData } from '@/types';

const audit = {
  meta_tags: { title: 'Audyt SEO dla sklepu', description: 'Praktyczny audyt SEO strony.' },
  headings: { hierarchy: [{ level: 1, text: 'Audyt SEO', children: [{ level: 2, text: 'Wnioski', children: [] }] }] },
  links: { links: [{ text: 'audyt seo', href: 'https://example.com', is_internal: true }] },
  content_stats: { body_text: 'Ten audyt SEO obejmuje kompletną treść strony. Audyt SEO jest lokalny.' },
} as unknown as PageAuditData;

describe('keyphrase analysis', () => {
  it('counts only actual phrase occurrences in audited fields', () => {
    const evidence = analyzeKeyphrase(audit, 'audyt seo');
    expect(evidence.find((item) => item.field === 'title')).toMatchObject({ occurrences: 1 });
    expect(evidence.find((item) => item.field === 'headings')).toMatchObject({ occurrences: 1 });
    expect(evidence.find((item) => item.field === 'anchors')).toMatchObject({ occurrences: 1 });
    expect(evidence.find((item) => item.field === 'body')).toMatchObject({ occurrences: 2 });
  });

  it('flattens nested heading trees without losing child headings', () => {
    expect(flattenHeadings(audit.headings.hierarchy).map((item) => item.text)).toEqual(['Audyt SEO', 'Wnioski']);
  });
});
