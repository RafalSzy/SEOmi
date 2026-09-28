import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AiSearchPrompts } from '@/components/AiVisibility/AiSearchPrompts';
import { useToolsStore } from '@/stores/toolsStore';
import { useProjectStore } from '@/stores/projectStore';
import i18n from '@/i18n';

describe('AI prompt research UI', () => {
  const originalRunPrompt = useToolsStore.getState().runAiPromptComparison;
  const originalSelectComparison = useToolsStore.getState().selectAiPromptComparison;
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({ activeProjectId: null });
    useToolsStore.setState({ crawlRuns: [], selectedCrawlRunId: null });
  });
  afterEach(() => {
    cleanup();
    useProjectStore.setState({ activeProjectId: null });
    useToolsStore.setState({ runAiPromptComparison: originalRunPrompt, selectAiPromptComparison: originalSelectComparison, aiPromptComparison: null, aiPromptHistory: [], aiPromptError: null });
  });

  it('does not silently execute a paid or subscription prompt on page load and explains the evidence limits', () => {
    const runPrompt = vi.fn();
    useToolsStore.setState({ aiSearchPrompt: 'saved prompt', aiPromptComparison: null, runAiPromptComparison: runPrompt });

    render(<AiSearchPrompts />);

    expect(runPrompt).not.toHaveBeenCalled();
    expect(screen.getByText(new RegExp(i18n.t('aiVisibility.search.description').slice(0, 20)))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('aiVisibility.search.promptLabel'))).toBeTruthy();
  });

  it('shows persisted project comparisons and delegates history selection to the store', () => {
    const current = { prompt: 'Current question', captured_at: '2026-01-02T00:00:00.000Z', results: [] };
    const previous = { prompt: 'Previous question', captured_at: '2026-01-01T00:00:00.000Z', results: [] };
    const select = vi.fn();
    useToolsStore.setState({ aiSearchPrompt: current.prompt, aiPromptComparison: current, aiPromptHistory: [current, previous], selectAiPromptComparison: select });

    render(<AiSearchPrompts />);

    const history = screen.getByLabelText(i18n.t('aiVisibility.search.historyAria')) as HTMLSelectElement;
    expect(history.options).toHaveLength(2);
    expect(screen.getByText(new RegExp(i18n.t('aiVisibility.search.historyNote').split(' · ')[0]))).toBeTruthy();
    fireEvent.change(history, { target: { value: previous.captured_at } });
    expect(select).toHaveBeenCalledWith(previous.captured_at);
  });

  it('compares extracted citation URLs to the selected project crawl and persists the selected context', () => {
    useProjectStore.setState({ activeProjectId: 'citation-project' });
    const oldRun = {
      id: 'run-old', completedAt: '2026-09-22T10:00:00.000Z', startUrl: 'https://example.test/', config: {},
      result: { pages_crawled: 1, pages: [{ url: 'https://example.test/source', final_url: 'https://example.test/source', title: 'Crawled source title', semantic_terms: ['answer', 'source'], semantic_excerpts: ['A source answer with bounded evidence.'], http_status: 200, indexability_status: 'Eligible from this response only', redirect_chain: [] }] },
    };
    const newRun = { ...oldRun, id: 'run-new', completedAt: '2026-09-23T10:00:00.000Z' };
    useToolsStore.setState({
      crawlRuns: [newRun, oldRun] as never, selectedCrawlRunId: 'run-new',
      aiSearchPrompt: 'question',
      aiPromptComparison: { prompt: 'question', captured_at: '2026-09-23T10:00:00.000Z', results: [{ provider: 'openai', model_name: 'local CLI', response_text: 'A source answer with bounded evidence.', citations: ['https://example.test/source.', 'https://outside.test/page'], brand_mentions: [], connection_method: 'local_cli', captured_at: '2026-09-23T10:00:00.000Z', response_status: 'success' }] } as never,
      aiPromptHistory: [{ prompt: 'question', captured_at: '2026-09-23T10:00:00.000Z', results: [] } as never],
    });

    render(<AiSearchPrompts />);

    expect(screen.getByText(new RegExp(i18n.t('aiVisibility.search.statusPresent', { status: 200, indexability: 'Eligible from this response only' })))).toBeTruthy();
    expect(screen.getByText(new RegExp(i18n.t('aiVisibility.search.lexicalContext', { matched: 2, total: 2, detail: 'main content' }).split(':')[0]))).toBeTruthy();
    expect(screen.getByText(new RegExp(i18n.t('aiVisibility.search.evidenceRange', { range: '' }).split(':')[0]))).toBeTruthy();
    expect(screen.getByText(new RegExp(i18n.t('aiVisibility.search.termPositions', { terms: '' }).split(':')[0]))).toBeTruthy();
    expect(screen.getByText(i18n.t('aiVisibility.search.statusAbsent'))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(i18n.t('aiVisibility.search.sourceAria')), { target: { value: 'run-old' } });
    expect(localStorage.getItem('seomi_project_citation-project_ai_citation_crawl_context_v1')).toBe('run-old');
  });

  it('keeps source-context matches scoped to each model response when citation URLs repeat', () => {
    useProjectStore.setState({ activeProjectId: 'citation-context-project' });
    const snapshot = {
      id: 'run-context', completedAt: '2026-09-23T10:00:00.000Z', startUrl: 'https://example.test/', config: {},
      result: { pages_crawled: 1, pages: [{ url: 'https://example.test/source', final_url: 'https://example.test/source', title: 'Source page', semantic_terms: ['coffee', 'beans'], http_status: 200, indexability_status: 'index', redirect_chain: [] }] },
    };
    const citation = 'https://example.test/source';
    useToolsStore.setState({
      crawlRuns: [snapshot] as never,
      aiPromptComparison: { prompt: 'question', captured_at: '2026-09-23T10:00:00.000Z', results: [
        { provider: 'openai', model_name: 'Model A', response_text: 'Coffee beans are popular.', citations: [citation], brand_mentions: [], connection_method: 'local_cli', captured_at: '2026-09-23T10:00:00.000Z', response_status: 'success' },
        { provider: 'claude', model_name: 'Model B', response_text: 'Unrelated garden tools.', citations: [citation], brand_mentions: [], connection_method: 'local_cli', captured_at: '2026-09-23T10:00:00.000Z', response_status: 'success' },
      ] } as never,
      aiPromptHistory: [{ prompt: 'question', captured_at: '2026-09-23T10:00:00.000Z', results: [] } as never],
    });

    render(<AiSearchPrompts />);

    const contextEvidence = screen.getAllByText(new RegExp(i18n.t('aiVisibility.search.lexicalContext', { matched: 0, total: 0, detail: '' }).split(':')[0]));
    expect(contextEvidence).toHaveLength(2);
    expect(contextEvidence[0].textContent).toContain(i18n.t('aiVisibility.search.observableSignal'));
    expect(contextEvidence[1].textContent).toContain(i18n.t('aiVisibility.search.belowThreshold'));
  });

  it('summarises citation evidence independently for every provider card', () => {
    useProjectStore.setState({ activeProjectId: 'citation-summary-project' });
    const snapshot = {
      id: 'run-summary', completedAt: '2026-09-23T10:00:00.000Z', startUrl: 'https://example.test/', config: {},
      result: { pages_crawled: 1, pages: [{ url: 'https://example.test/source', final_url: 'https://example.test/source', title: 'Source page', semantic_terms: ['coffee', 'beans', 'roast'], semantic_excerpts: ['Coffee beans are roasted before brewing for a deeper flavour profile.'], http_status: 200, indexability_status: 'index', redirect_chain: [] }] },
    };
    useToolsStore.setState({
      crawlRuns: [snapshot] as never,
      aiPromptComparison: { prompt: 'question', captured_at: '2026-09-23T10:00:00.000Z', results: [
        { provider: 'openai', model_name: 'Model A', response_text: 'Coffee beans are roasted before brewing for a deeper flavour profile.', citations: ['https://example.test/source'], brand_mentions: [], connection_method: 'local_cli', captured_at: '2026-09-23T10:00:00.000Z', response_status: 'success' },
        { provider: 'claude', model_name: 'Model B', response_text: 'No source context here.', citations: [], brand_mentions: [], connection_method: 'local_cli', captured_at: '2026-09-23T10:00:00.000Z', response_status: 'success' },
      ] } as never,
      aiPromptHistory: [{ prompt: 'question', captured_at: '2026-09-23T10:00:00.000Z', results: [] } as never],
    });

    render(<AiSearchPrompts />);

    expect(screen.getByLabelText(i18n.t('aiVisibility.search.citationSummaryAria', { provider: 'openai' })).textContent).toContain(`${i18n.t('aiVisibility.search.citations')} 1`);
    expect(screen.getByLabelText(i18n.t('aiVisibility.search.citationSummaryAria', { provider: 'openai' })).textContent).toContain(`${i18n.t('aiVisibility.search.inSnapshot')} 1`);
    expect(screen.getByLabelText(i18n.t('aiVisibility.search.citationSummaryAria', { provider: 'openai' })).textContent).toContain(`${i18n.t('aiVisibility.search.sentenceMatch')} 1`);
    expect(screen.getByLabelText(i18n.t('aiVisibility.search.citationSummaryAria', { provider: 'claude' })).textContent).toContain(`${i18n.t('aiVisibility.search.citations')} 0`);
  });
});
