import { invokeTauriCommand } from '@/services/tauri';
import { useProjectStore } from '@/stores/projectStore';
import i18n from '@/i18n';

export type PageSpeedStrategy = 'mobile' | 'desktop';
export type CruxFormFactor = 'PHONE' | 'DESKTOP' | 'TABLET';

export interface PageSpeedMetric {
  id: string;
  title: string;
  displayValue: string | null;
  numericValue: number | null;
  score: number | null;
}

export interface TouchTargetEvidence {
  label: string | null;
  selector: string | null;
  snippet: string | null;
  target: string | null;
  targetSize: unknown;
  boundingRect: unknown;
  failureSummary: string | null;
  explanation: string | null;
}

export interface TouchTargetAudit {
  id: string;
  title: string;
  description: string;
  score: number | null;
  scoreDisplayMode: string | null;
  displayValue: string | null;
  evidence: TouchTargetEvidence[];
  evidenceCount: number;
  evidenceTruncated: boolean;
}

export interface ImageOptimizationEvidence {
  url: string | null;
  label: string | null;
  selector: string | null;
  snippet: string | null;
  totalBytes: number | null;
  wastedBytes: number | null;
  wastedPercent: number | null;
  displayValue: string | null;
}

export interface ImageOptimizationAudit {
  id: string;
  title: string;
  description: string;
  score: number | null;
  scoreDisplayMode: string | null;
  displayValue: string | null;
  overallSavingsBytes: number | null;
  evidence: ImageOptimizationEvidence[];
  evidenceCount: number;
  evidenceTruncated: boolean;
}

export interface PageSpeedReport {
  source: string;
  requestedUrl: string;
  finalUrl: string;
  strategy: PageSpeedStrategy;
  fetchedAt: string | null;
  lighthouseVersion: string | null;
  categories: {
    performance: number | null;
    accessibility: number | null;
    bestPractices: number | null;
    seo: number | null;
  };
  metrics: Record<string, PageSpeedMetric>;
  opportunities: Array<{ id: string; title: string; description: string; displayValue: string | null; score: number | null }>;
  touchTargetAudit?: TouchTargetAudit | null;
  imageOptimizationAudits?: ImageOptimizationAudit[];
  fieldExperience: Record<string, unknown> | null;
  originExperience: Record<string, unknown> | null;
}

export interface CruxReport {
  source: string;
  fetchedAt: string;
  target: string;
  scope: 'url' | 'origin';
  formFactor: CruxFormFactor;
  response: Record<string, unknown>;
}

const activeProject = () => {
  const projectId = useProjectStore.getState().activeProjectId;
  if (!projectId) throw new Error(i18n.t('runtimeErrors.pagespeed.projectRequired'));
  return projectId;
};

export const runPageSpeedInsights = (url: string, strategy: PageSpeedStrategy) =>
  invokeTauriCommand<PageSpeedReport>('run_pagespeed_insights', {
    projectId: activeProject(), url: url.trim(), strategy,
  });

export const queryCrux = async (url: string, formFactor: CruxFormFactor, scope: 'url' | 'origin'): Promise<CruxReport> => {
  const target = url.trim();
  const response = await invokeTauriCommand<Record<string, unknown>>('query_crux_record', {
    projectId: activeProject(), url: target, formFactor, originScope: scope === 'origin',
  });
  return { source: 'Chrome UX Report API (CrUX)', fetchedAt: new Date().toISOString(), target, scope, formFactor, response };
};
