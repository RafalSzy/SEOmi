import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { useToolsStore } from '@/stores/toolsStore';
import i18n from '@/i18n';

const connected = {
  connectionMethod: { openai: 'local_cli', claude: 'local_cli', gemini: 'local_cli' } as const,
  connectionStatus: { openai: 'connected', claude: 'connected', gemini: 'connected' } as const,
};

describe('project-scoped AI answer research', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('seomi_active_project_v1', 'ai-project-one');
    useToolsStore.setState({ aiBrandReport: null, aiBrandHistory: [], aiPromptComparison: null, aiPromptHistory: [], aiBrandError: null, aiPromptError: null });
    useAuthStore.setState({
      ...connected,
      apiKeys: { openai: '', claude: '', gemini: '' },
      generateTextForProvider: vi.fn(async (provider) => `${provider} answer mentions SEOmi. https://${provider}.example/source`),
    });
  });

  it('compares the same prompt across connected local subscription CLIs, keeps per-provider evidence, and restores it by project', async () => {
    await useToolsStore.getState().runAiPromptComparison('What is SEOmi?');

    const comparison = useToolsStore.getState().aiPromptComparison;
    expect(comparison?.results.map((result) => result.provider)).toEqual(['openai', 'claude', 'gemini']);
    expect(comparison?.results.every((result) => result.response_status === 'success' && result.captured_at && result.connection_method === 'local_cli')).toBe(true);
    expect(comparison?.results[0].citations).toEqual(['https://openai.example/source']);
    const storedHistory = JSON.parse(localStorage.getItem('seomi_project_ai-project-one_ai_prompt_comparison_v1') || '[]');
    expect(storedHistory).toHaveLength(1);
    expect(storedHistory[0].prompt).toBe('What is SEOmi?');

    localStorage.setItem('seomi_active_project_v1', 'ai-project-two');
    await useToolsStore.getState().hydrateProject('ai-project-two');
    expect(useToolsStore.getState().aiPromptComparison).toBeNull();
    expect(useToolsStore.getState().aiPromptHistory).toEqual([]);
    localStorage.setItem('seomi_active_project_v1', 'ai-project-one');
    await useToolsStore.getState().hydrateProject('ai-project-one');
    expect(useToolsStore.getState().aiPromptComparison?.prompt).toBe('What is SEOmi?');
  });

  it('does not call API-key providers, preserves individual failures, and records brand mention rate only over successful CLI answers', async () => {
    useAuthStore.setState({
      connectionMethod: { openai: 'local_cli', claude: 'api_key', gemini: 'local_cli' },
      generateTextForProvider: vi.fn(async (provider) => {
        if (provider === 'gemini') throw new Error('CLI quota reached');
        return 'SEOmi is mentioned. https://source.example/page';
      }),
    });

    await useToolsStore.getState().analyzeAiBrandVisibility('SEOmi', 'seomi.example');

    const report = useToolsStore.getState().aiBrandReport;
    expect(report?.models.map((model) => model.provider)).toEqual(['openai', 'gemini']);
    expect(report?.models.map((model) => model.response_status)).toEqual(['success', 'error']);
    expect(report?.models[1].error_message).toBe('CLI quota reached');
    expect(report?.overall_score).toBe(100);
    expect(useAuthStore.getState().generateTextForProvider).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem('seomi_project_ai-project-one_ai_brand_report_v1') || '[]')[0].brand).toBe('SEOmi');
  });

  it('requires a project and at least one connected local subscription client', async () => {
    localStorage.removeItem('seomi_active_project_v1');
    await useToolsStore.getState().runAiPromptComparison('test prompt');
    expect(useToolsStore.getState().aiPromptError).toContain(i18n.t('runtimeErrors.tools.projectRequired'));

    localStorage.setItem('seomi_active_project_v1', 'ai-project-one');
    useAuthStore.setState({ connectionStatus: { openai: 'unconfigured', claude: 'unconfigured', gemini: 'unconfigured' } });
    await useToolsStore.getState().runAiPromptComparison('test prompt');
    expect(useToolsStore.getState().aiPromptError).toContain(i18n.t('runtimeErrors.tools.aiConnect'));
    expect(useToolsStore.getState().aiPromptComparison).toBeNull();
  });

  it('appends prompt runs, restores the project history and lets the user select an older run', async () => {
    await useToolsStore.getState().runAiPromptComparison('first prompt');
    const first = useToolsStore.getState().aiPromptComparison!;
    await new Promise((resolve) => setTimeout(resolve, 2));
    await useToolsStore.getState().runAiPromptComparison('second prompt');

    expect(useToolsStore.getState().aiPromptHistory.map((item) => item.prompt)).toEqual(['second prompt', 'first prompt']);
    localStorage.setItem('seomi_active_project_v1', 'ai-project-two');
    await useToolsStore.getState().hydrateProject('ai-project-two');
    expect(useToolsStore.getState().aiPromptHistory).toEqual([]);
    localStorage.setItem('seomi_active_project_v1', 'ai-project-one');
    await useToolsStore.getState().hydrateProject('ai-project-one');
    expect(useToolsStore.getState().aiPromptHistory).toHaveLength(2);
    useToolsStore.getState().selectAiPromptComparison(first.captured_at);
    expect(useToolsStore.getState().aiPromptComparison?.prompt).toBe('first prompt');
    expect(localStorage.getItem('seomi_project_ai-project-one_ai_prompt_selection_v1')).toBe(JSON.stringify(first.captured_at));
    await useToolsStore.getState().hydrateProject('ai-project-one');
    expect(useToolsStore.getState().aiPromptComparison?.prompt).toBe('first prompt');
  });

  it('migrates legacy single-result records into in-memory histories and uses the latest as active', async () => {
    const legacyBrand = { brand: 'Legacy brand', domain: 'legacy.test', timestamp: '2026-01-01T00:00:00.000Z', overall_score: null, query_checked: '', key_takeaways: [], models: [] };
    const legacyPrompt = { prompt: 'legacy prompt', captured_at: '2026-01-02T00:00:00.000Z', results: [] };
    localStorage.setItem('seomi_project_ai-project-one_ai_brand_report_v1', JSON.stringify(legacyBrand));
    localStorage.setItem('seomi_project_ai-project-one_ai_prompt_comparison_v1', JSON.stringify(legacyPrompt));

    await useToolsStore.getState().hydrateProject('ai-project-one');

    expect(useToolsStore.getState().aiBrandHistory).toEqual([legacyBrand]);
    expect(useToolsStore.getState().aiBrandReport).toEqual(legacyBrand);
    expect(useToolsStore.getState().aiPromptHistory).toEqual([legacyPrompt]);
    expect(useToolsStore.getState().aiPromptComparison).toEqual(legacyPrompt);
  });

  it('keeps at most 50 saved comparisons, with the newest first', async () => {
    const previous = Array.from({ length: 50 }, (_, index) => ({ prompt: `saved ${index}`, captured_at: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, results: [] }));
    useToolsStore.setState({ aiPromptHistory: previous });

    await useToolsStore.getState().runAiPromptComparison('newest');

    expect(useToolsStore.getState().aiPromptHistory).toHaveLength(50);
    expect(useToolsStore.getState().aiPromptHistory[0].prompt).toBe('newest');
    expect(useToolsStore.getState().aiPromptHistory.some((item) => item.prompt === 'saved 49')).toBe(false);
  });

  it('does not let a delayed comparison from another project clear a newer run', async () => {
    useAuthStore.setState({
      connectionMethod: { openai: 'local_cli', claude: 'api_key', gemini: 'api_key' },
      connectionStatus: { openai: 'connected', claude: 'unconfigured', gemini: 'unconfigured' },
    });
    const pending: Array<{ resolve: (value: string) => void }> = [];
    useAuthStore.setState({
      generateTextForProvider: vi.fn(() => new Promise<string>((resolve) => { pending.push({ resolve }); })),
    });

    const oldRun = useToolsStore.getState().runAiPromptComparison('old project prompt');
    await Promise.resolve();
    localStorage.setItem('seomi_active_project_v1', 'ai-project-two');
    const newRun = useToolsStore.getState().runAiPromptComparison('new project prompt');
    await Promise.resolve();

    pending[0]?.resolve('old response');
    await Promise.resolve();
    expect(useToolsStore.getState().isAiPromptLoading).toBe(true);

    pending[1]?.resolve('new response');
    await Promise.all([oldRun, newRun]);
    expect(useToolsStore.getState().isAiPromptLoading).toBe(false);
  });

  it('keeps the newest same-project prompt comparison when responses finish out of order', async () => {
    useAuthStore.setState({
      connectionMethod: { openai: 'local_cli', claude: 'api_key', gemini: 'api_key' },
      connectionStatus: { openai: 'connected', claude: 'unconfigured', gemini: 'unconfigured' },
    });
    const pending: Array<{ resolve: (value: string) => void }> = [];
    useAuthStore.setState({
      generateTextForProvider: vi.fn(() => new Promise<string>((resolve) => { pending.push({ resolve }); })),
    });

    const oldRun = useToolsStore.getState().runAiPromptComparison('older prompt');
    await Promise.resolve();
    const newRun = useToolsStore.getState().runAiPromptComparison('newer prompt');
    await Promise.resolve();

    pending[0]?.resolve('older response');
    await Promise.resolve();
    expect(useToolsStore.getState().isAiPromptLoading).toBe(true);
    expect(useToolsStore.getState().aiPromptComparison).toBeNull();

    pending[1]?.resolve('newer response');
    await Promise.all([oldRun, newRun]);
    expect(useToolsStore.getState().isAiPromptLoading).toBe(false);
    expect(useToolsStore.getState().aiPromptComparison?.prompt).toBe('newer prompt');
  });
});
