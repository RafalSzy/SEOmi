import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { URLInput } from '@/components/URLBar/URLInput';
import { useProjectStore } from '@/stores/projectStore';
import { useAuditStore } from '@/stores/auditStore';
import i18n from '@/i18n';

describe('URLInput project context', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('pl');
    localStorage.clear();
    useProjectStore.setState({
      projects: [{ id: 'url-project-a', name: 'A', rootUrl: 'https://a.example/', createdAt: '2026-09-24T00:00:00.000Z', lastOpenedAt: '2026-09-24T00:00:00.000Z' }],
      activeProjectId: 'url-project-a',
    });
    useAuditStore.setState({ batchItems: [], batchRun: null, batchWakeupError: null, isBatchRunning: false, isBatchStopping: false });
  });

  it('seeds and persists the audit URL per project without leaking drafts', async () => {
    const { unmount } = render(<URLInput />);
    const input = screen.getByRole('textbox', { name: 'URL strony do audytu' }) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('https://a.example/'));

    fireEvent.change(input, { target: { value: 'https://a.example/page' } });
    expect(localStorage.getItem('seomi_project_url-project-a_audit_url_draft_v1')).toBe('https://a.example/page');

    unmount();
    act(() => useProjectStore.setState({
      projects: [
        { id: 'url-project-a', name: 'A', rootUrl: 'https://a.example/', createdAt: '2026-09-24T00:00:00.000Z', lastOpenedAt: '2026-09-24T00:00:00.000Z' },
        { id: 'url-project-b', name: 'B', rootUrl: 'https://b.example/', createdAt: '2026-09-24T00:00:00.000Z', lastOpenedAt: '2026-09-24T00:00:00.000Z' },
      ],
      activeProjectId: 'url-project-b',
    }));
    render(<URLInput />);
    const secondInput = screen.getByRole('textbox', { name: 'URL strony do audytu' }) as HTMLInputElement;
    await waitFor(() => expect(secondInput.value).toBe('https://b.example/'));
  });

  it('persists a URL pasted from the clipboard in the active project draft', async () => {
    const readText = vi.fn().mockResolvedValue('https://a.example/pasted');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });

    render(<URLInput />);
    const input = await screen.findByRole('textbox', { name: 'URL strony do audytu' });
    fireEvent.click(screen.getByRole('button', { name: 'Wklej' }));

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('https://a.example/pasted');
      expect(localStorage.getItem('seomi_project_url-project-a_audit_url_draft_v1')).toBe('https://a.example/pasted');
    });
  });

  it('surfaces a failed native queue wake-up instead of hiding it', () => {
    useAuditStore.setState({
      batchItems: [{ id: 'item-1', url: 'https://a.example/', status: 'queued' }],
      batchWakeupError: 'Nie udało się zarejestrować wake-upu systemowego.',
    });

    render(<URLInput />);

    expect(screen.getByRole('alert').textContent).toContain('Nie udało się zarejestrować wake-upu systemowego.');
  });
});
