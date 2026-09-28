import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandPalette } from '@/components/Layout/CommandPalette';
import { useAuditStore } from '@/stores/auditStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboard';
import i18n from '@/i18n';

const KeyboardHarness = () => {
  useKeyboardShortcuts();
  return null;
};

describe('project-aware command palette', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('pl');
    localStorage.clear();
    document.body.style.overflow = '';
    useProjectStore.setState({
      projects: [
        { id: 'palette-one', name: 'Pierwszy serwis', rootUrl: 'https://one.example', createdAt: '2026-09-23T00:00:00.000Z', lastOpenedAt: '2026-09-23T00:00:00.000Z' },
        { id: 'palette-two', name: 'Drugi serwis', rootUrl: 'https://two.example', createdAt: '2026-09-23T00:00:00.000Z', lastOpenedAt: '2026-09-23T00:00:00.000Z' },
      ],
      activeProjectId: 'palette-one',
    });
    useAuditStore.setState({ activeTab: 'overview' });
    useUIStore.setState({ commandPaletteOpen: true, activeModal: null });
  });

  it('filters the same logical workspace groups and navigates with Enter', () => {
    render(<CommandPalette />);

    const input = screen.getByRole('textbox', { name: /Search module, project or action|Szukaj modułu, projektu lub akcji/i });
    fireEvent.change(input, { target: { value: 'backlink' } });
    expect(screen.getByRole('option', { name: /Backlink Checker|Profil linków/i })).not.toBeNull();
    expect(screen.queryByRole('option', { name: /Keyword Research|Badanie słów kluczowych/i })).toBeNull();

    fireEvent.click(screen.getByRole('option', { name: /Backlink Checker|Profil linków/i }));
    expect(useAuditStore.getState().activeTab).toBe('backlink-checker');
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it('uses the combined audit and crawling group used by the sidebar', () => {
    render(<CommandPalette />);

    const overview = screen.getAllByRole('option').find((option) => option.textContent?.startsWith(i18n.t('sidebar.overview')));
    const crawler = screen.getAllByRole('option').find((option) => option.textContent?.startsWith(i18n.t('sidebar.siteAudit')));
    expect(overview?.textContent).toContain(i18n.t('sidebar.auditWorkspace'));
    expect(crawler?.textContent).toContain(i18n.t('sidebar.auditWorkspace'));
  });

  it('prioritizes project creation and project switching before workflow modules', () => {
    render(<CommandPalette />);
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toMatch(/Create new project|Utwórz nowy projekt/);
    expect(options[1].textContent).toMatch(/Pierwszy serwis/);
    expect(options[2].textContent).toMatch(/Drugi serwis/);
  });

  it('keeps workspace actions under the localized workspace-tools group', () => {
    render(<CommandPalette />);
    expect(screen.getByRole('option', { name: /Settings|Ustawienia/i }).textContent)
      .toMatch(/Workspace tools|Narzędzia workspace/);
  });

  it('keeps the Google & Data group complete with the DataForSEO workflow', () => {
    render(<CommandPalette />);

    const input = screen.getByRole('textbox', { name: /Search module, project or action|Szukaj modułu, projektu lub akcji/i });
    fireEvent.change(input, { target: { value: 'dataforseo' } });
    const option = screen.getByRole('option', { name: /DataForSEO/i });
    expect(option.textContent).toMatch(/Google & Data|Google i dane/);

    fireEvent.click(option);
    expect(useAuditStore.getState().activeTab).toBe('dataforseo');
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it('switches projects and exposes workspace actions without leaking the previous tab', async () => {
    render(<CommandPalette />);

    const input = screen.getByRole('textbox', { name: /Search module, project or action|Szukaj modułu, projektu lub akcji/i });
    fireEvent.change(input, { target: { value: 'Drugi serwis' } });
    fireEvent.click(screen.getByRole('option', { name: /Drugi serwis/i }));

    expect(useProjectStore.getState().activeProjectId).toBe('palette-two');
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);

    act(() => useUIStore.getState().openCommandPalette());
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Search module, project or action|Szukaj modułu, projektu lub akcji/i })).not.toBeNull());
    fireEvent.change(screen.getByRole('textbox', { name: /Search module, project or action|Szukaj modułu, projektu lub akcji/i }), { target: { value: 'ustawienia' } });
    fireEvent.click(screen.getByRole('option', { name: /Settings|Ustawienia/i }));
    expect(useUIStore.getState().activeModal).toBe('settings');
  });

  it('uses the localized Projects group for project switching results', () => {
    render(<CommandPalette />);
    const input = screen.getByRole('textbox', { name: /Search module, project or action|Szukaj modułu, projektu lub akcji/i });
    fireEvent.change(input, { target: { value: 'Pierwszy serwis' } });
    expect(screen.getByRole('option', { name: /Pierwszy serwis/i }).textContent).toMatch(/Projects|Projekty/);
  });

  it('closes on Escape and reports an empty result state', () => {
    render(<CommandPalette />);
    const input = screen.getByRole('textbox', { name: /Search module, project or action|Szukaj modułu, projektu lub akcji/i });
    fireEvent.change(input, { target: { value: 'nieistniejący moduł' } });
    expect(screen.getByText(/No matching modules, projects or actions\.|Brak pasujących modułów, projektów lub akcji\./i)).not.toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it('keeps the active result announced and supports Home/End navigation', () => {
    render(<CommandPalette />);
    const input = screen.getByRole('textbox', { name: /Search module, project or action|Szukaj modułu, projektu lub akcji/i });
    const listbox = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');

    fireEvent.keyDown(input, { key: 'End' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe(options[options.length - 1].id);
    fireEvent.keyDown(input, { key: 'Home' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe(options[0].id);
  });

  it('locks document scrolling while open and restores focus after closing', async () => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    document.body.appendChild(trigger);
    trigger.focus();

    render(<CommandPalette />);
    expect(document.body.style.overflow).toBe('hidden');
    act(() => useUIStore.getState().closeCommandPalette());

    await waitFor(() => expect(document.body.style.overflow).toBe(''));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('opens from the documented desktop shortcut without taking over Cmd/Ctrl+K', () => {
    useUIStore.setState({ commandPaletteOpen: false });
    render(<KeyboardHarness />);

    fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true });
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });
});
