import type { TabType } from '@/types';
import { ALL_WORKSPACE_TABS } from '@/services/workspaceRoutes';

const WORKSPACE_HASH_PREFIX = '#workspace?';

/**
 * Every tab that can be restored as a project workspace destination. Keeping
 * this allowlist separate from the renderer prevents a malformed hash (or an
 * old bookmark) from ever entering the Zustand route state.
 */
export const WORKSPACE_DEEP_LINK_TABS: readonly TabType[] = ALL_WORKSPACE_TABS;

const workspaceTabs = new Set<TabType>(WORKSPACE_DEEP_LINK_TABS);
const projectIdPattern = /^[A-Za-z0-9-]{1,80}$/;

export interface WorkspaceDeepLink {
  projectId: string;
  tab: TabType;
}

export const isWorkspaceDeepLinkTab = (value: string | null): value is TabType =>
  value !== null && workspaceTabs.has(value as TabType);

export const parseWorkspaceHash = (hash: string): WorkspaceDeepLink | null => {
  if (!hash.startsWith(WORKSPACE_HASH_PREFIX)) return null;
  const params = new URLSearchParams(hash.slice(WORKSPACE_HASH_PREFIX.length));
  const projectId = params.get('project')?.trim() || '';
  const tab = params.get('tab');
  if (!projectIdPattern.test(projectId) || !isWorkspaceDeepLinkTab(tab)) {
    return null;
  }
  return { projectId, tab };
};

export const buildWorkspaceHash = ({ projectId, tab }: WorkspaceDeepLink): string => {
  if (!projectIdPattern.test(projectId) || !workspaceTabs.has(tab)) {
    return '';
  }
  const params = new URLSearchParams({ project: projectId, tab });
  return `${WORKSPACE_HASH_PREFIX}${params.toString()}`;
};
