import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SavedKeywords } from '@/components/Keywords/SavedKeywords';
import { useProjectStore } from '@/stores/projectStore';
import { useToolsStore } from '@/stores/toolsStore';

describe('Saved Keywords project-scoped filters', () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({
      projects: [
        { id: 'saved-one', name: 'Pierwszy', createdAt: '2026-09-24T00:00:00.000Z', lastOpenedAt: '2026-09-24T00:00:00.000Z' },
        { id: 'saved-two', name: 'Drugi', createdAt: '2026-09-24T00:00:00.000Z', lastOpenedAt: '2026-09-24T00:00:00.000Z' },
      ],
      activeProjectId: 'saved-one',
    });
    useToolsStore.setState({
      savedKeywords: [{ id: 'keyword-1', keyword: 'audyt seo', search_volume: 10, difficulty: 20, cpc: 1, intent: 'Informational', tags: ['Research'], addedAt: '2026-09-24T00:00:00.000Z' }],
    });
  });

  it('clears view filters after switching projects', async () => {
    render(<SavedKeywords />);
    const search = screen.getByPlaceholderText('Search keywords or tags…') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'audyt' } });
    expect(search.value).toBe('audyt');

    act(() => {
      useProjectStore.setState({ activeProjectId: 'saved-two' });
      useToolsStore.setState({ savedKeywords: [] });
    });

    await waitFor(() => expect(search.value).toBe(''));
  });
});
