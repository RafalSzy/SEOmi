import { describe, expect, it } from 'vitest';
import { WORKSPACE_NAVIGATION } from '@/components/Layout/navigation';
import { ALL_WORKSPACE_TABS, PAGE_AUDIT_TABS } from '@/services/workspaceRoutes';
import { WORKSPACE_DEEP_LINK_TABS } from '@/services/workspaceDeepLink';

describe('workspace navigation contract', () => {
  it('keeps one deterministic order for every navigation surface', () => {
    expect(WORKSPACE_NAVIGATION.map((section) => section.key)).toEqual([
      'audit-workspace',
      'keyword-research',
      'domain-research',
      'performance',
      'google-data',
      'ai-visibility',
      'agent-workflows',
      'seo-tools',
      'workspace-tools',
    ]);

    expect(WORKSPACE_NAVIGATION[0].items.map((item) => item.key)).toEqual([
      'overview',
      'site-audit',
      'semantic-map',
    ]);
    expect(WORKSPACE_NAVIGATION.find((section) => section.key === 'google-data')?.items.map((item) => item.key)).toEqual([
      'search-console',
      'dataforseo',
    ]);
    expect(WORKSPACE_NAVIGATION.find((section) => section.key === 'keyword-research')?.items.map((item) => item.key)).toEqual([
      'keyword-research',
      'saved-keywords',
      'keyword-clustering',
      'rank-tracking',
    ]);
  });

  it('requires every visible workflow to have a label, search terms and one destination', () => {
    const items = WORKSPACE_NAVIGATION.flatMap((section) => section.items);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
    items.forEach((item) => {
      expect(item.labelKey).toMatch(/^sidebar\./);
      expect(item.keywords.trim().length).toBeGreaterThan(0);
      expect(item.tab || item.action).toBeTruthy();
    });
  });

  it('keeps render, persistence and deep-link route contracts identical', () => {
    expect(new Set(ALL_WORKSPACE_TABS).size).toBe(ALL_WORKSPACE_TABS.length);
    expect(WORKSPACE_DEEP_LINK_TABS).toEqual(ALL_WORKSPACE_TABS);
    expect(ALL_WORKSPACE_TABS.slice(0, PAGE_AUDIT_TABS.length)).toEqual(PAGE_AUDIT_TABS);
  });
});
