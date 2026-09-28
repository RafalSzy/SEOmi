import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderWorkerPanel } from '@/components/Settings/RenderWorkerPanel';
import { renderWorkerLeaseDelay } from '@/services/renderWorkerLease';
import { copyText } from '@/services/clipboard';
import { getRenderWorkerStatus, isTauriEnvironment, startRenderWorker } from '@/services/tauri';
import i18n from '@/i18n';

vi.mock('@/services/clipboard', () => ({ copyText: vi.fn() }));
vi.mock('@/services/tauri', () => ({
  getRenderWorkerStatus: vi.fn(),
  isTauriEnvironment: vi.fn(),
  startRenderWorker: vi.fn(),
  stopRenderWorker: vi.fn(),
}));

describe('RenderWorkerPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('pl');
    vi.mocked(isTauriEnvironment).mockReturnValue(false);
    vi.mocked(getRenderWorkerStatus).mockResolvedValue(false);
    vi.mocked(startRenderWorker).mockReset();
    vi.mocked(copyText).mockReset();
  });
  it('does not offer a worker in the browser preview', () => {
    render(<RenderWorkerPanel />);

    expect(screen.getByTestId('render-worker-panel')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Uruchom' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/wyłącznie na 127\.0\.0\.1/)).toBeTruthy();
  });

  it('calculates a safe lease expiry delay for the UI timer', () => {
    expect(renderWorkerLeaseDelay('2026-09-24T12:00:01.000Z', Date.parse('2026-09-24T12:00:00.000Z'))).toBe(1_000);
    expect(renderWorkerLeaseDelay('2026-09-24T11:59:59.000Z', Date.parse('2026-09-24T12:00:00.000Z'))).toBe(0);
    expect(renderWorkerLeaseDelay('not-a-date', Date.now())).toBeNull();
  });

  it('reports clipboard failure instead of claiming the token was copied', async () => {
    vi.mocked(isTauriEnvironment).mockReturnValue(true);
    vi.mocked(getRenderWorkerStatus).mockReset();
    vi.mocked(getRenderWorkerStatus).mockResolvedValueOnce(false).mockResolvedValue(true);
    vi.mocked(startRenderWorker).mockResolvedValue({
      baseUrl: 'http://127.0.0.1:9347',
      token: 'secret-token',
      version: '1.0.0',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      oneShot: true,
    });
    vi.mocked(copyText).mockResolvedValue(false);

    render(<RenderWorkerPanel />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('legacyUi.renderWorker.start') }));
    const copyButton = await screen.findByRole('button', { name: i18n.t('legacyUi.renderWorker.copyToken') });
    fireEvent.click(copyButton);

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(i18n.t('legacyUi.renderWorker.tokenCopyFailed')));
    expect(screen.getByRole('status').textContent).not.toContain(i18n.t('legacyUi.renderWorker.tokenCopied'));
    expect(copyText).toHaveBeenCalledWith('secret-token');
  });
});
