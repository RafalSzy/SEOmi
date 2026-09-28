import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '@/i18n';
import { openRenderedElementPreview } from '@/services/tauri';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('rendered element preview localization bridge', () => {
  let originalTauriDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    originalTauriDescriptor = Object.getOwnPropertyDescriptor(window, '__TAURI_INTERNALS__');
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
    await i18n.changeLanguage('pl');
  });

  afterEach(async () => {
    if (originalTauriDescriptor) {
      Object.defineProperty(window, '__TAURI_INTERNALS__', originalTauriDescriptor);
    } else {
      delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
    await i18n.changeLanguage('en');
  });

  it('passes localized title and not-found notice to the native preview', async () => {
    await openRenderedElementPreview({ url: 'https://example.com/page', selector: 'h1' });

    expect(invoke).toHaveBeenCalledWith('open_rendered_element_preview', {
      url: 'https://example.com/page',
      selector: 'h1',
      needle: null,
      domIndex: null,
      previewTitle: 'Podgląd · example.com',
      notFoundMessage: 'Nie znaleziono elementu w aktualnie wyrenderowanym DOM.',
    });
  });
});
