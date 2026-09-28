import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageAuditData } from '@/types';
import { MetadataTable } from '@/components/Results/MetadataTable';
import { useAuditStore } from '@/stores/auditStore';
import i18n from '@/i18n';

vi.mock('@/services/auditProblems', () => ({ getMetadataProblems: () => [] }));

const audit = {
  meta_tags: { title: 'Page title', title_length: 10, description: 'Page description', description_length: 16, other_tags: [] },
  technical: {
    technology_signals: [
      { name: 'WordPress', category: 'CMS / platform', confidence: 'confirmed', evidence: 'meta[name=generator]', version: '6.6.2' },
      { name: 'React', category: 'JavaScript framework', confidence: 'heuristic', evidence: 'HTML root marker' },
    ],
    favicons: [],
    hreflang_tags: [],
  },
  accessibility: { document_language: 'en', form_control_count: 0, unlabeled_form_control_count: 0, landmarks: [], aria_attribute_count: 0, findings: [], manual_review_items: [] },
} as unknown as PageAuditData;

describe('technology fingerprint display', () => {
  beforeEach(async () => { await i18n.changeLanguage('pl'); });
  beforeEach(() => useAuditStore.setState({ showOnlyProblems: false }));

  it('shows explicit versions and preserves a separate heuristic confidence label', () => {
    render(<MetadataTable audit={audit} />);

    expect(screen.getByText('Wykryte technologie')).toBeTruthy();
    expect(screen.getByText('6.6.2')).toBeTruthy();
    expect(screen.getByText('WordPress')).toBeTruthy();
    expect(screen.getByText('React')).toBeTruthy();
    expect(screen.getByText('potwierdzony')).toBeTruthy();
    expect(screen.getByText('heurystyczny')).toBeTruthy();
  });
});
