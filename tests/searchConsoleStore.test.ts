import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@/services/tauri', () => ({ invokeTauriCommand: (...args: unknown[]) => invokeMock(...args) }));

import { useToolsStore } from '@/stores/toolsStore';

describe('Search Console desktop workflow', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('seomi_active_project_v1', 'gsc-project');
    invokeMock.mockReset();
    useToolsStore.setState({
      isGscConnected: false,
      gscClientId: '',
      gscProperties: [],
      gscProperty: '',
      gscFilters: {},
      gscData: null,
      gscDataFetchedAt: null,
      gscInspectionResult: null,
      isGscLoading: false,
      gscError: null,
    });
  });

  it('authorizes, selects the returned property, retrieves live reports and inspects a URL', async () => {
    const properties = [
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://example.com/', permissionLevel: 'siteFullUser' },
    ];
    invokeMock.mockResolvedValueOnce(properties);
    await useToolsStore.getState().connectGsc('123.apps.googleusercontent.com');
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'connect_search_console', { projectId: 'gsc-project', clientId: '123.apps.googleusercontent.com' });
    expect(useToolsStore.getState()).toMatchObject({ isGscConnected: true, gscProperty: 'sc-domain:example.com', gscProperties: properties });
    expect(localStorage.getItem('seomi_gsc_client_id_gsc-project')).toBe('123.apps.googleusercontent.com');
    expect(localStorage.getItem('seomi_gsc_property_gsc-project')).toBe('sc-domain:example.com');

    invokeMock.mockResolvedValueOnce({ site_url: 'sc-domain:example.com', start_date: '2026-08-01', end_date: '2026-08-28', total_clicks: 10, total_impressions: 100, avg_ctr: 10, avg_position: 4, queries: [], pages: [], daily: [], queries_may_be_truncated: false, pages_may_be_truncated: false, daily_may_be_truncated: false, max_rows_per_dimension: 25000 });
    await useToolsStore.getState().refreshGscData();
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'search_console_performance', { projectId: 'gsc-project', clientId: '123.apps.googleusercontent.com', siteUrl: 'sc-domain:example.com', startDate: null, endDate: null, filters: {} });
    expect(useToolsStore.getState().gscData?.total_clicks).toBe(10);
    expect(useToolsStore.getState().gscDataFetchedAt).toMatch(/^\d{4}-\d\d-\d\dT/);

    invokeMock.mockResolvedValueOnce({ inspectionResult: { indexStatusResult: { verdict: 'PASS' } } });
    await useToolsStore.getState().inspectGscUrl('https://example.com/page');
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'inspect_search_console_url', {
      projectId: 'gsc-project', clientId: '123.apps.googleusercontent.com', siteUrl: 'sc-domain:example.com', inspectionUrl: 'https://example.com/page',
    });
    expect(useToolsStore.getState().gscInspectionResult).toMatchObject({ inspectionResult: { indexStatusResult: { verdict: 'PASS' } } });

    invokeMock.mockResolvedValueOnce('Token Search Console usunięto z aplikacji i cofnięto zgodę Google.');
    await useToolsStore.getState().disconnectGsc();
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'disconnect_search_console', { projectId: 'gsc-project' });
    expect(useToolsStore.getState()).toMatchObject({ isGscConnected: false, gscData: null, gscDataFetchedAt: null, gscInspectionResult: null });
  });

  it('never fabricates performance data when the Google API command fails', async () => {
    useToolsStore.setState({ isGscConnected: true, gscClientId: '123.apps.googleusercontent.com', gscProperty: 'sc-domain:example.com', gscDataFetchedAt: null });
    invokeMock.mockRejectedValueOnce(new Error('Google Search Console HTTP 403'));
    await useToolsStore.getState().refreshGscData();
    expect(useToolsStore.getState().gscData).toBeNull();
    expect(useToolsStore.getState().gscError).toBe('Google Search Console HTTP 403');
  });

  it('forwards the explicitly selected performance date range to the desktop command', async () => {
    useToolsStore.setState({ isGscConnected: true, gscClientId: '123.apps.googleusercontent.com', gscProperty: 'sc-domain:example.com' });
    invokeMock.mockResolvedValueOnce({ site_url: 'sc-domain:example.com', start_date: '2026-01-01', end_date: '2026-01-31', total_clicks: 0, total_impressions: 0, avg_ctr: 0, avg_position: 0, queries: [], pages: [], daily: [], queries_may_be_truncated: false, pages_may_be_truncated: false, daily_may_be_truncated: false, max_rows_per_dimension: 25000 });
    await useToolsStore.getState().refreshGscData({ startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(invokeMock).toHaveBeenCalledWith('search_console_performance', {
      projectId: 'gsc-project', clientId: '123.apps.googleusercontent.com', siteUrl: 'sc-domain:example.com', startDate: '2026-01-01', endDate: '2026-01-31', filters: {},
    });
  });

  it('does not apply a Search Console response after switching projects', async () => {
    useToolsStore.setState({ isGscConnected: true, gscClientId: '123.apps.googleusercontent.com', gscProperty: 'sc-domain:example.com' });
    let resolveResponse: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation(() => new Promise((resolve) => { resolveResponse = resolve; }));

    const pending = useToolsStore.getState().refreshGscData();
    localStorage.setItem('seomi_active_project_v1', 'gsc-project-two');
    resolveResponse?.({ site_url: 'sc-domain:example.com', start_date: '2026-08-01', end_date: '2026-08-28', total_clicks: 10, total_impressions: 100, avg_ctr: 10, avg_position: 4, queries: [], pages: [], daily: [], queries_may_be_truncated: false, pages_may_be_truncated: false, daily_may_be_truncated: false, max_rows_per_dimension: 25000 });
    await pending;

    expect(useToolsStore.getState().gscData).toBeNull();
  });

  it('keeps the newest performance response when requests finish out of order', async () => {
    useToolsStore.setState({ isGscConnected: true, gscClientId: '123.apps.googleusercontent.com', gscProperty: 'sc-domain:example.com' });
    let releaseFirst!: (value: unknown) => void;
    let callCount = 0;
    const oldData = { site_url: 'sc-domain:example.com', start_date: '2026-01-01', end_date: '2026-01-31', total_clicks: 1, total_impressions: 10, avg_ctr: 10, avg_position: 9, queries: [], pages: [], daily: [], queries_may_be_truncated: false, pages_may_be_truncated: false, daily_may_be_truncated: false, max_rows_per_dimension: 25000 };
    const freshData = { ...oldData, total_clicks: 99, avg_position: 2 };
    invokeMock.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return new Promise((resolve) => { releaseFirst = resolve; });
      return Promise.resolve(freshData);
    });

    const first = useToolsStore.getState().refreshGscData();
    await Promise.resolve();
    const second = useToolsStore.getState().refreshGscData();
    await second;
    expect(useToolsStore.getState().gscData?.total_clicks).toBe(99);

    releaseFirst(oldData);
    await first;
    expect(useToolsStore.getState().gscData?.total_clicks).toBe(99);
    expect(useToolsStore.getState().isGscLoading).toBe(false);
  });

  it('invalidates a pending performance response when the selected property changes', async () => {
    useToolsStore.setState({ isGscConnected: true, gscClientId: '123.apps.googleusercontent.com', gscProperty: 'sc-domain:example.com' });
    let release!: (value: unknown) => void;
    invokeMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const pending = useToolsStore.getState().refreshGscData();
    await Promise.resolve();
    useToolsStore.getState().setGscProperty('sc-domain:new.example');
    release({ site_url: 'sc-domain:example.com', start_date: '2026-01-01', end_date: '2026-01-31', total_clicks: 10, total_impressions: 100, avg_ctr: 10, avg_position: 4, queries: [], pages: [], daily: [], queries_may_be_truncated: false, pages_may_be_truncated: false, daily_may_be_truncated: false, max_rows_per_dimension: 25000 });
    await pending;

    expect(useToolsStore.getState()).toMatchObject({ gscProperty: 'sc-domain:new.example', gscData: null, gscDataFetchedAt: null, isGscLoading: false });
  });

  it('persists and forwards the selected Search Console scope filters per project', async () => {
    useToolsStore.setState({ isGscConnected: true, gscClientId: '123.apps.googleusercontent.com', gscProperty: 'sc-domain:example.com', gscFilters: {} });
    useToolsStore.getState().setGscFilters({ search_type: 'web', device: 'MOBILE', country: 'POL' });
    expect(localStorage.getItem('seomi_gsc_filters_gsc-project_v1')).toBe(JSON.stringify({ search_type: 'web', device: 'MOBILE', country: 'pol' }));
    invokeMock.mockResolvedValueOnce({ site_url: 'sc-domain:example.com', start_date: '2026-01-01', end_date: '2026-01-31', filters: { search_type: 'web', device: 'MOBILE', country: 'pol' }, total_clicks: 0, total_impressions: 0, avg_ctr: 0, avg_position: 0, queries: [], pages: [], daily: [], queries_may_be_truncated: false, pages_may_be_truncated: false, daily_may_be_truncated: false, max_rows_per_dimension: 25000 });
    await useToolsStore.getState().refreshGscData();
    expect(invokeMock).toHaveBeenCalledWith('search_console_performance', expect.objectContaining({ filters: { search_type: 'web', device: 'MOBILE', country: 'pol' } }));
  });
});
