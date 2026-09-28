import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AIAssistantModal } from '@/components/AI/AIAssistantModal';
import { useAuditStore } from '@/stores/auditStore';
import { useAuthStore } from '@/stores/authStore';
import { copyText } from '@/services/clipboard';
import i18n from '@/i18n';

vi.mock('@/services/clipboard', () => ({
  copyText: vi.fn(),
}));

describe('AI assistant schema copy feedback', () => {
  beforeEach(() => {
    useAuditStore.setState({ currentAudit: { url: 'https://example.com' } as never });
    useAuthStore.setState({
      provider: 'openai',
      model: 'gpt-4o',
      apiKeys: { openai: 'test-key', claude: '', gemini: '' },
      connectionMethod: { openai: 'api_key', claude: 'api_key', gemini: 'api_key' },
      connectionStatus: { openai: 'connected', claude: 'unconfigured', gemini: 'unconfigured' },
      isProviderConnected: () => true,
      generateSuggestions: vi.fn().mockResolvedValue({
        suggestedTitle: 'A generated title',
        suggestedDescription: 'A generated description',
        keyImprovements: ['Improve the title'],
        schemaJsonLd: { '@type': 'WebPage', name: 'Example' },
      }),
    });
    vi.mocked(copyText).mockReset();
  });

  afterEach(() => cleanup());

  it('does not claim success when the clipboard rejects the JSON-LD copy', async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    render(<AIAssistantModal />);

    fireEvent.click(screen.getByRole('button', { name: i18n.t('ai.generate') }));
    await screen.findByText(i18n.t('ai.schemaJsonLd'));

    const copyButton = screen.getByRole('button', { name: i18n.t('ai.copyJson') });
    fireEvent.click(copyButton);
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: i18n.t('ai.copyJson') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: i18n.t('ai.copied') })).toBeNull();
  });

  it('shows copied feedback only after the clipboard confirms the JSON-LD copy', async () => {
    vi.mocked(copyText).mockResolvedValue(true);
    render(<AIAssistantModal />);

    fireEvent.click(screen.getByRole('button', { name: i18n.t('ai.generate') }));
    await screen.findByText(i18n.t('ai.schemaJsonLd'));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('ai.copyJson') }));

    await waitFor(() => expect(screen.getByRole('button', { name: i18n.t('ai.copied') })).toBeTruthy());
  });
});
