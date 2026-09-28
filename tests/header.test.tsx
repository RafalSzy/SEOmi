import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Header } from '@/components/Layout/Header';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';

describe('Header language menu', () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({
      projects: [{ id: 'header-project', name: 'Header project', rootUrl: 'https://example.com', createdAt: '2026-09-24T00:00:00.000Z', lastOpenedAt: '2026-09-24T00:00:00.000Z' }],
      activeProjectId: 'header-project',
    });
    useSettingsStore.setState({ language: 'en', theme: 'dark' });
  });

  it('opens with a button, closes on Escape, and closes after selecting a language', () => {
    render(<Header />);
    const toggle = screen.getByRole('button', { name: 'Interface Language' });
    const menu = screen.getByRole('menu', { name: 'Interface Language' });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(menu.className).toContain('opacity-100');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('menuitem', { name: /Polski pl/i }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
