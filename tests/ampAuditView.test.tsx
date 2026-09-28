import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AmpAuditView } from '@/components/Results/AmpAuditView';
import { useAuditStore } from '@/stores/auditStore';
import i18n from '@/i18n';
import { PageAuditData } from '@/types';

const audit: PageAuditData = {
  url: 'https://example.com/article/amp', final_url: 'https://example.com/article/amp', timestamp: '2026-09-23T00:00:00.000Z', http_status: 200, response_time_ms: 100, redirect_chain: [],
  meta_tags: { title_length: 0, description_length: 0, other_tags: [] }, open_graph: { all_tags: [] }, twitter_card: { all_tags: [] },
  headings: { h1_count: 1, h1_texts: ['AMP'], hierarchy: [], has_valid_hierarchy: true, issues: [] }, images: [],
  links: { total_links: 0, internal_links: 0, external_links: 0, nofollow_links: 0, links: [] }, security_headers: { score: 0 },
  structured_data: [], technical: { hreflang_tags: [] }, health_score: 85, issues: [], content_stats: { word_count: 2, reading_time_minutes: 1, text_ratio_percent: 10, top_keywords: [] },
  amp: {
    detected: true,
    is_amp_document: true,
    amphtml_urls: [],
    canonical_url: 'https://example.com/article',
    coverage: 'partial-local-rules',
    findings: [{ code: 'amp-runtime-missing', severity: 'error', message: 'AMP runtime script was not found.', evidence: 'Missing runtime script.', recommendation: 'Add the AMP runtime.' }],
    unchecked: ['Official AMP validator rule set and version', 'Target HTTP status'],
  },
};

describe('AMP audit view', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('pl');
  });
  beforeEach(() => useAuditStore.setState({ showOnlyProblems: false }));

  it('shows evidence, the saved canonical, and the partial-coverage boundary', () => {
    render(<AmpAuditView audit={audit} />);
    expect(screen.getByText(/nie jest oficjalny walidator AMP/i)).toBeTruthy();
    expect(screen.getByText('https://example.com/article')).toBeTruthy();
    expect(screen.getByText('Missing runtime script.')).toBeTruthy();
    expect(screen.getByText('Target HTTP status')).toBeTruthy();
  });

  it('uses the common only-problems view for recorded AMP findings', () => {
    useAuditStore.setState({ showOnlyProblems: true });
    render(<AmpAuditView audit={audit} />);
    expect(screen.getByRole('region', { name: 'Problemy: AMP' }).textContent).toContain('Reguła AMP amp-runtime-missing');
  });

  it('does not misreport a legacy record without AMP data as clean', () => {
    useAuditStore.setState({ showOnlyProblems: true });
    const legacyAudit = { ...audit, amp: undefined };
    render(<AmpAuditView audit={legacyAudit} />);
    expect(screen.getByText(/nie można ustalić, czy były problemy/i)).toBeTruthy();
  });
});
