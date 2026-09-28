import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { SubscriptionModal } from '@/components/Auth/SubscriptionModal';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';

describe('AI connection dialog', () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({ activeModal: 'subscription' });
    useAuthStore.setState({
      provider: 'openai',
      model: 'gpt-4o',
      connectionMethod: { openai: 'local_cli', claude: 'api_key', gemini: 'api_key' },
      apiKeys: { openai: '', claude: '', gemini: '' },
      connectionStatus: { openai: 'unconfigured', claude: 'unconfigured', gemini: 'unconfigured' },
      statusMessages: { openai: '', claude: '', gemini: '' },
      cliStatus: { openai: null, claude: null, gemini: null },
      detectLocalClients: vi.fn(async () => undefined),
    });
  });

  it('renders as a labelled modal and exposes subscription/API choices', () => {
    render(<SubscriptionModal />);

    expect(screen.getByRole('dialog', { name: /AI connections|Połączenia AI/i })).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /Local CLI subscription|Lokalna subskrypcja CLI/i }).length).toBe(3);
    expect(screen.getAllByRole('button', { name: /Direct API credential|Bezpośrednie poświadczenie API/i }).length).toBe(3);
    expect(screen.queryByLabelText(/OpenAI \/ Codex API key|Klucz API OpenAI/i)).toBeNull();
  });

  it('closes on Escape and restores document scrolling', async () => {
    const view = render(<SubscriptionModal />);
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useUIStore.getState().activeModal).toBeNull();
    view.unmount();
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });
});
