import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MainContent } from '@/components/Layout/MainContent';
import { Sidebar } from '@/components/Layout/Sidebar';
import { WORKSPACE_NAVIGATION } from '@/components/Layout/navigation';
import { useAuditStore } from '@/stores/auditStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import type { PageAuditData, TabType } from '@/types';

const workspaceTabs = Array.from(
  new Set(
    WORKSPACE_NAVIGATION.flatMap((section) =>
      section.items.flatMap((item) => (item.tab ? [item.tab] : [])),
    ),
  ),
);

const pageAuditResultTabs: TabType[] = [
  'overview',
  'dataforseo',
  'social',
  'headings',
  'metadata',
  'images',
  'links',
  'security',
  'structured',
  'amp',
  'performance',
];

const auditFixture: PageAuditData = {
  url: 'https://example.com',
  final_url: 'https://example.com',
  timestamp: '2026-09-24T00:00:00.000Z',
  http_status: 200,
  response_time_ms: 120,
  redirect_chain: [],
  meta_tags: {
    title: 'Example',
    title_length: 7,
    description: 'Example page',
    description_length: 12,
    other_tags: [],
  },
  open_graph: { all_tags: [] },
  twitter_card: { all_tags: [] },
  headings: {
    h1_count: 1,
    h1_texts: ['Example'],
    hierarchy: [{ level: 1, text: 'Example', children: [] }],
    has_valid_hierarchy: true,
    issues: [],
  },
  images: [],
  links: {
    total_links: 0,
    internal_links: 0,
    external_links: 0,
    nofollow_links: 0,
    links: [],
  },
  security_headers: { score: 90 },
  structured_data: [],
  technical: { hreflang_tags: [] },
  health_score: 95,
  issues: [],
  content_stats: {
    word_count: 20,
    reading_time_minutes: 1,
    text_ratio_percent: 10,
    top_keywords: [],
  },
};

const expectRouteContent = (route = 'unknown') => {
  const text = screen.getByRole('main').textContent?.trim() ?? '';
  // A lazy route's Suspense fallback is non-empty, so checking only for
  // text would let a permanently stalled chunk pass this smoke test.
  expect(text, `route ${route} remained on the lazy loading fallback`).not.toMatch(/^(?:Loading view…|Ładowanie widoku…|Loading view\.\.\.|Ładowanie widoku\.\.\.)$/);
  expect(text.length).toBeGreaterThan(30);
};

describe('workspace route smoke coverage', () => {
  const routeErrorMessages = new Set(['route-render-failed', 'root-render-failed']);
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useProjectStore.setState({
      projects: [
        {
          id: 'route-smoke-project',
          name: 'Route smoke project',
          rootUrl: 'https://example.com',
          createdAt: '2026-09-24T00:00:00.000Z',
          lastOpenedAt: '2026-09-24T00:00:00.000Z',
        },
      ],
      activeProjectId: 'route-smoke-project',
    });
    useUIStore.setState({
      sidebarCollapsed: false,
      collapsedSections: {},
      activeModal: null,
    });
    useAuditStore.setState({
      activeTab: 'overview',
      currentAudit: null,
      error: null,
      isLoading: false,
      isBatchRunning: false,
    });
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    const routeErrors = consoleError.mock.calls.filter((call: unknown[]) => {
      const message = call[0];
      return typeof message === 'string' && routeErrorMessages.has(message);
    });
    consoleError.mockRestore();
    expect(routeErrors).toEqual([]);
  });

  it('mounts every sidebar destination through the real SPA content switch', async () => {
    render(
      <>
        <Sidebar />
        <MainContent />
      </>,
    );

    for (const tab of workspaceTabs) {
      const destination = screen.getAllByRole('button').find(
        (button) => button.getAttribute('data-sidebar-tab') === tab,
      );
      expect(destination, `missing sidebar destination: ${tab}`).toBeTruthy();

      await act(async () => {
        fireEvent.click(destination as HTMLElement);
      });

      await waitFor(() => {
        expect(useAuditStore.getState().activeTab).toBe(tab);
        expectRouteContent(tab);
        expect(screen.queryByRole('alert')).toBeNull();
      }, { timeout: 15_000 });
    }
  }, 60_000);

  it('mounts every page-audit result tab without activating the route fallback', async () => {
    useAuditStore.setState({ currentAudit: auditFixture, activeTab: 'overview' });
    render(<MainContent />);

    for (const tab of pageAuditResultTabs) {
      await act(async () => {
        useAuditStore.getState().setActiveTab(tab);
      });

      await waitFor(() => {
        expect(useAuditStore.getState().activeTab).toBe(tab);
        expectRouteContent(tab);
        expect(screen.queryByRole('alert')).toBeNull();
      }, { timeout: 5000 });
    }
  });

  it('keeps every action-only workspace destination reachable from the sidebar', async () => {
    render(<Sidebar />);
    const navigation = screen.getByRole('navigation', {
      name: /Application modules|Moduły aplikacji/i,
    });
    const actions = [
      { name: /AI Assistant|AI Optimizer|Optymalizator AI/i, modal: 'ai' as const },
      { name: /AI Connection|Połączenie AI/i, modal: 'subscription' as const },
      { name: /Audit history|Historia audytów/i, modal: 'history' as const },
      { name: /Settings|Ustawienia/i, modal: 'settings' as const },
    ];

    for (const action of actions) {
      fireEvent.click(within(navigation).getByRole('button', { name: action.name }));
      await waitFor(() => expect(useUIStore.getState().activeModal).toBe(action.modal));
      useUIStore.setState({ activeModal: null });
    }

    fireEvent.click(within(navigation).getByRole('button', { name: /Mapa semantyczna|Semantic map/i }));
    expect(useAuditStore.getState().activeTab).toBe('site-audit');
    expect(sessionStorage.getItem('seomi_open_crawl_map_v1')).toBe('1');
  });
});
