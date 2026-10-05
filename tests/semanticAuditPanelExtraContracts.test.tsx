import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticAuditPanel } from '@/components/Charts/SemanticAuditPanel';
import { createEmptyTopicalMap } from '@/services/topicalMap';
import { buildSemanticAudit } from '@/services/semanticAudit';
import { compareSemanticRuns } from '@/services/semanticRunComparison';
import type { SemanticAuditReport } from '@/services/topicalAudit/types';
import type { SemanticRunComparisonReport } from '@/services/semanticRunComparison';
import { createCrawlRunFixture } from './fixtures/crawl';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { count?: number; percent?: number }) => {
        const value = options?.count ?? options?.percent;
        return value === undefined ? key : `${key}:${value}`;
      },
    }),
  };
});
vi.mock('@/services/semanticAudit', () => ({ buildSemanticAudit: vi.fn() }));
vi.mock('@/services/semanticRunComparison', () => ({ compareSemanticRuns: vi.fn() }));

const report: SemanticAuditReport = {
  mappedTopics: 1, totalTopics: 2, mappedPages: 2, totalPages: 3,
  contentOrphanPages: null, truncated: true,
  entityObservability: [
    { label: 'Brand', observedPages: 0, comparablePages: 0, provenance: 'asserted+measured' },
    { label: 'Product', observedPages: 2, comparablePages: 4, provenance: 'asserted+measured' },
  ],
  findings: [
    { id: 'risk', code: 'possible-url-overlap', severity: 'risk', provenance: ['measured', 'derived', 'asserted'], title: 'Overlap risk', detail: 'Risk detail', action: 'Review overlap', topicId: 'topic-1', urls: Array.from({ length: 9 }, (_, index) => `https://site.test/${index}`), evidence: ['SERP evidence'], confidence: 'moderate' },
    { id: 'review', code: 'query-not-observed', severity: 'review', provenance: ['derived'], title: 'Review signal', detail: 'Review detail', action: 'Compare query', urls: [], evidence: ['Query evidence'], confidence: 'limited' },
    { id: 'notice', code: 'unassigned-page', severity: 'notice', provenance: ['asserted'], title: 'Notice signal', detail: 'Notice detail', action: 'Assign page', urls: ['https://site.test/notice'], evidence: ['Mapping evidence'], confidence: 'limited' },
  ],
};

const comparison: SemanticRunComparisonReport = {
  baselineRunId: 'older', currentRunId: 'current', truncated: true,
  counts: {
    'url-added': 1, 'url-not-observed': 1, 'content-terms-changed': 1,
    'content-link-added': 1, 'content-link-not-observed': 1, 'topic-edge-added': 1,
    'topic-edge-not-observed': 1, 'topic-url-coverage-changed': 1,
    'query-term-observation-changed': 1,
  },
  changes: [
    { id: 'change-topic', code: 'topic-edge-added', direction: 'added', title: 'Topic edge added', detail: 'A topic relation appeared', topicId: 'topic-1', urls: ['https://site.test/topic'], evidence: ['Observed relation'] },
    { id: 'change-url', code: 'url-added', direction: 'added', title: 'URL added', detail: 'A URL appeared', urls: [], evidence: ['Crawl evidence'] },
  ],
};

describe('SemanticAuditPanel direct evidence contracts', () => {
  beforeEach(() => {
    vi.mocked(buildSemanticAudit).mockReturnValue(report);
    vi.mocked(compareSemanticRuns).mockReturnValue(comparison);
  });

  it('renders entity observability, every finding severity, provenance, and bounded evidence', () => {
    render(<SemanticAuditPanel document={createEmptyTopicalMap()} pages={[]} />);
    expect(screen.getByText('semanticAudit.contentOrphansUnavailable')).toBeTruthy();
    expect(screen.getByText('Brand')).toBeTruthy();
    expect(screen.getByLabelText('semanticAudit.noComparablePages')).toBeTruthy();
    expect(screen.getByLabelText('semanticAudit.percentPages:50')).toBeTruthy();
    for (const value of ['Overlap risk', 'Review signal', 'Notice signal', 'semanticAudit.severity.risk', 'semanticAudit.severity.review', 'semanticAudit.severity.notice']) expect(screen.getByText(value)).toBeTruthy();
    for (const value of ['semanticAudit.provenance.measured', 'semanticAudit.provenance.derived', 'semanticAudit.provenance.asserted', 'SERP evidence', 'Query evidence']) expect(screen.getAllByText(value).length).toBeGreaterThan(0);
    expect(screen.getByText('semanticAudit.moreUrls:1')).toBeTruthy();
    expect(screen.getByText('semanticAudit.analysisTruncated')).toBeTruthy();
  });

  it('renders comparison changes and applies severity and text filters', () => {
    const older = createCrawlRunFixture({ id: 'older', completedAt: '2026-10-01' });
    const newest = createCrawlRunFixture({ id: 'newest', completedAt: '2026-10-02' });
    const current = createCrawlRunFixture({ id: 'current', completedAt: '2026-10-03' });
    render(<SemanticAuditPanel document={createEmptyTopicalMap()} pages={[]} runs={[older, newest, current]} currentRunId="current" />);
    const baseline = screen.getByRole('combobox') as HTMLSelectElement;
    expect(baseline.value).toBe('newest');
    expect(screen.getByText('Topic edge added')).toBeTruthy();
    expect(screen.getByText('semanticAudit.topicalTag')).toBeTruthy();
    expect(screen.getByText('semanticAudit.comparisonTruncated')).toBeTruthy();
    fireEvent.change(baseline, { target: { value: 'older' } });
    expect(baseline.value).toBe('older');

    fireEvent.click(screen.getByRole('button', { name: 'semanticAudit.filterReview:1' }));
    expect(screen.getByText('Review signal')).toBeTruthy();
    expect(screen.queryByText('Overlap risk')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'semanticAudit.filterNotice:1' }));
    expect(screen.getByText('Notice signal')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('semanticAudit.searchAria'), { target: { value: 'impossible' } });
    expect(screen.getByText('semanticAudit.noFilterMatches')).toBeTruthy();
  });
});
