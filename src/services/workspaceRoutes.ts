import type { TabType } from '@/types';

/**
 * Routes rendered by the page-audit result navigator. These destinations are
 * still valid project workspace routes even when no audit exists; the UI then
 * renders the translated empty state instead of a broken lazy route.
 */
export const PAGE_AUDIT_TABS = [
  'overview',
  'social',
  'headings',
  'metadata',
  'images',
  'links',
  'security',
  'structured',
  'amp',
  'performance',
] as const satisfies readonly TabType[];

/** Every supported workspace destination, in stable deep-link order. */
export const ALL_WORKSPACE_TABS = [
  ...PAGE_AUDIT_TABS,
  'dataforseo',
  'keyword-research',
  'keyword-clustering',
  'core-web-vitals',
  'saved-keywords',
  'rank-tracking',
  'domain-overview',
  'backlink-checker',
  'site-audit',
  'ai-brand-visibility',
  'ai-search-prompts',
  'mcp-hub',
  'search-console',
  'seo-tools',
] as const satisfies readonly TabType[];

const pageAuditTabSet = new Set<TabType>(PAGE_AUDIT_TABS);

export const isPageAuditTab = (tab: TabType): boolean => pageAuditTabSet.has(tab);
