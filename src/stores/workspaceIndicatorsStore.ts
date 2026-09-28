import { create } from 'zustand';

export interface WorkspaceIndicatorsSnapshot {
  savedKeywordsCount: number;
  trackedRanksCount: number;
  isCrawling: boolean;
  crawlProgress: number;
  crawlRunsCount: number;
}

interface WorkspaceIndicatorsState extends WorkspaceIndicatorsSnapshot {
  setSnapshot: (snapshot: WorkspaceIndicatorsSnapshot) => void;
  reset: () => void;
}

const EMPTY_SNAPSHOT: WorkspaceIndicatorsSnapshot = {
  savedKeywordsCount: 0,
  trackedRanksCount: 0,
  isCrawling: false,
  crawlProgress: 0,
  crawlRunsCount: 0,
};

/**
 * Small, eagerly available projection used by the workspace shell. The
 * heavyweight tools store updates this projection from App after it is loaded
 * so the sidebar does not pull crawler/DataForSEO code into the initial chunk.
 */
export const useWorkspaceIndicatorsStore = create<WorkspaceIndicatorsState>((set) => ({
  ...EMPTY_SNAPSHOT,
  setSnapshot: (snapshot) => set(snapshot),
  reset: () => set(EMPTY_SNAPSHOT),
}));
