import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as tauriService from '@/services/tauri';
import { ShowOnPageButton } from '@/components/Results/ShowOnPageButton';
import i18n from '@/i18n';

describe('ShowOnPageButton', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('opens a native same-host preview with selector evidence', async () => {
    const openPreview = vi.spyOn(tauriService, 'openRenderedElementPreview').mockResolvedValue();
    render(
      <ShowOnPageButton
        url="https://example.com/page"
        selector="a[href]"
        needle="https://example.com/next"
        label="link Next"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: i18n.t('componentUi.showOnPageAria', { label: 'link Next' }) }));
    await waitFor(() => expect(openPreview).toHaveBeenCalledWith({
      url: 'https://example.com/page',
      selector: 'a[href]',
      needle: 'https://example.com/next',
    }));
  });

  it('surfaces desktop-only preview errors without hiding the audit row', async () => {
    vi.spyOn(tauriService, 'openRenderedElementPreview').mockRejectedValue(new Error('desktop-only'));
    render(
      <ShowOnPageButton url="https://example.com/page" selector="h1" label="H1" />,
    );

    fireEvent.click(screen.getByRole('button', { name: i18n.t('componentUi.showOnPageAria', { label: 'H1' }) }));
    expect((await screen.findByRole('alert')).textContent).toContain('desktop-only');
  });

  it('passes a bounded DOM index when text or attributes cannot identify a control', async () => {
    const openPreview = vi.spyOn(tauriService, 'openRenderedElementPreview').mockResolvedValue();
    render(
      <ShowOnPageButton
        url="https://example.com/form"
        selector="input, select, textarea"
        domIndex={3}
        label="kontrolka formularza #4"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: i18n.t('componentUi.showOnPageAria', { label: 'kontrolka formularza #4' }) }));
    await waitFor(() => expect(openPreview).toHaveBeenCalledWith({
      url: 'https://example.com/form',
      selector: 'input, select, textarea',
      domIndex: 3,
    }));
  });
});
