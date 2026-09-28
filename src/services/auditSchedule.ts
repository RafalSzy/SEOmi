import type { CrawlConfig } from '@/types';
import { readStorage, writeStorage } from '@/services/storage';
import { createId } from '@/services/ids';
import i18n from '@/i18n';

export type AuditIntervalHours = 6 | 12 | 24 | 168;
export type ScheduledTaskType = 'page-audit' | 'site-crawl';
export type ScheduledAuditStatus = 'scheduled' | 'running' | 'completed' | 'failed' | 'paused';

export interface ScheduledAuditExecution {
  startedAt: string;
  completedAt: string;
  succeeded: boolean;
  error?: string;
}

export interface ScheduledExecutionHandoff {
  projectId: string;
  scheduleId: string;
  taskType: ScheduledTaskType | string;
  startedAt: string;
  completedAt: string;
  succeeded: boolean;
  nextRunAt: string;
  error?: string;
  schedulerError?: string;
  result?: unknown;
}

export interface ScheduledAudit {
  id: string;
  url: string;
  /** Missing on older records; those remain single-page audits. */
  taskType?: ScheduledTaskType;
  /** Maximum pages used when taskType is site-crawl. */
  crawlLimit?: number;
  /** Non-secret crawl options captured when the schedule is created. */
  crawlConfig?: Partial<CrawlConfig>;
  intervalHours: AuditIntervalHours;
  enabled: boolean;
  status: ScheduledAuditStatus;
  createdAt: string;
  nextRunAt: string;
  lastStartedAt?: string;
  lastRunAt?: string;
  lastError?: string;
  runHistory?: ScheduledAuditExecution[];
}

const MAX_SCHEDULES_PER_PROJECT = 20;
const RUNNING_STALE_AFTER_MS = 5 * 60 * 1000;
const inFlightProjects = new Set<string>();
const storageKey = (projectId: string) => `seomi_project_${projectId}_audit_schedules_v1`;
export const AUDIT_SCHEDULES_UPDATED_EVENT = 'seomi:audit-schedules-updated';
const validProjectId = (projectId: string) => /^[a-zA-Z0-9-]{1,80}$/.test(projectId);
const allowedIntervals = new Set<number>([6, 12, 24, 168]);
const isHttpUrlWithoutCredentials = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
};

const parseSchedules = (value: unknown): ScheduledAudit[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ScheduledAudit => Boolean(
    item && typeof item.id === 'string' && item.id.length > 0 && isHttpUrlWithoutCredentials(item.url)
      && allowedIntervals.has(item.intervalHours) && typeof item.enabled === 'boolean'
      && ['scheduled', 'running', 'completed', 'failed', 'paused'].includes(item.status)
      && typeof item.createdAt === 'string' && typeof item.nextRunAt === 'string'
      && Number.isFinite(Date.parse(item.nextRunAt))
  )).map((item) => {
    const taskType: ScheduledTaskType = item.taskType === 'site-crawl' ? 'site-crawl' : 'page-audit';
    const crawlLimit = Number.isFinite(item.crawlLimit) ? Math.min(500, Math.max(1, Math.trunc(item.crawlLimit!))) : undefined;
    const runHistory = Array.isArray(item.runHistory)
      ? item.runHistory.filter((entry): entry is ScheduledAuditExecution => Boolean(
        entry && typeof entry.startedAt === 'string' && typeof entry.completedAt === 'string'
          && typeof entry.succeeded === 'boolean' && Number.isFinite(Date.parse(entry.startedAt))
          && Number.isFinite(Date.parse(entry.completedAt)),
      )).slice(-20)
      : [];
    return {
      ...item,
      taskType,
      ...(taskType === 'site-crawl' && crawlLimit ? { crawlLimit } : {}),
      ...(runHistory.length ? { runHistory } : {}),
    };
  }).slice(0, MAX_SCHEDULES_PER_PROJECT);
};

export const loadScheduledAudits = (projectId: string): ScheduledAudit[] => {
  if (!validProjectId(projectId)) return [];
  try {
    return parseSchedules(JSON.parse(readStorage(storageKey(projectId)) || '[]'));
  } catch {
    return [];
  }
};

const saveScheduledAudits = (projectId: string, schedules: ScheduledAudit[]): void => {
  if (!validProjectId(projectId)) throw new Error(i18n.t('runtimeErrors.schedules.projectRequired'));
  if (!writeStorage(storageKey(projectId), JSON.stringify(schedules.slice(0, MAX_SCHEDULES_PER_PROJECT)))) {
    throw new Error(i18n.t('runtimeErrors.schedules.saveFailed'));
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUDIT_SCHEDULES_UPDATED_EVENT, { detail: { projectId } }));
  }
};

/** Apply a native headless execution to the project-local schedule mirror. */
export const applyScheduledExecution = (projectId: string, handoff: ScheduledExecutionHandoff): ScheduledAudit | null => {
  if (handoff.projectId !== projectId || !validProjectId(projectId)) return null;
  const schedules = loadScheduledAudits(projectId);
  const index = schedules.findIndex((schedule) => schedule.id === handoff.scheduleId);
  if (index < 0) return null;
  const schedule = schedules[index];
  const history = schedule.runHistory || [];
  const alreadyRecorded = history.some((entry) => (
    entry.startedAt === handoff.startedAt && entry.completedAt === handoff.completedAt
  ));
  const next: ScheduledAudit = {
    ...schedule,
    status: schedule.enabled ? (handoff.succeeded ? 'completed' : 'failed') : 'paused',
    lastStartedAt: handoff.startedAt,
    lastRunAt: handoff.completedAt,
    nextRunAt: handoff.nextRunAt,
    lastError: handoff.succeeded
      ? handoff.schedulerError
      : handoff.error || i18n.t('runtimeErrors.schedules.auditFailed'),
    runHistory: alreadyRecorded
      ? history
      : [
        ...history,
        {
          startedAt: handoff.startedAt,
          completedAt: handoff.completedAt,
          succeeded: handoff.succeeded,
          ...(handoff.succeeded ? {} : { error: handoff.error || i18n.t('runtimeErrors.schedules.auditFailed') }),
        },
      ].slice(-20),
  };
  schedules[index] = next;
  saveScheduledAudits(projectId, schedules);
  return next;
};

export const addScheduledAudit = (
  projectId: string,
  value: string,
  intervalHours: AuditIntervalHours,
  now = Date.now(),
  options: {
    taskType?: ScheduledTaskType;
    crawlLimit?: number;
    crawlConfig?: Partial<CrawlConfig>;
  } = {},
): ScheduledAudit => {
  if (!validProjectId(projectId)) throw new Error(i18n.t('runtimeErrors.schedules.projectCreateRequired'));
  if (!allowedIntervals.has(intervalHours)) throw new Error(i18n.t('runtimeErrors.schedules.intervalInvalid'));
  const url = value.trim();
  if (url.length > 2048) throw new Error(i18n.t('runtimeErrors.schedules.urlTooLong'));
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(i18n.t('runtimeErrors.schedules.urlInvalid'));
  }
  if (!isHttpUrlWithoutCredentials(url) || !['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new Error(i18n.t('runtimeErrors.schedules.urlPublicOnly'));
  }
  const taskType = options.taskType === 'site-crawl' ? 'site-crawl' : 'page-audit';
  const crawlLimit = Math.trunc(options.crawlLimit ?? 25);
  if (taskType === 'site-crawl' && (!Number.isFinite(crawlLimit) || crawlLimit < 1 || crawlLimit > 500)) {
    throw new Error(i18n.t('runtimeErrors.schedules.crawlLimit'));
  }
  const schedules = loadScheduledAudits(projectId);
  if (schedules.length >= MAX_SCHEDULES_PER_PROJECT) throw new Error(i18n.t('runtimeErrors.schedules.maxReached', { count: MAX_SCHEDULES_PER_PROJECT }));
  const normalizedUrl = parsedUrl.toString();
  if (schedules.some((schedule) => schedule.url === normalizedUrl)) throw new Error(i18n.t('runtimeErrors.schedules.duplicate'));
  const createdAt = new Date(now).toISOString();
  const schedule: ScheduledAudit = {
    id: createId('schedule'),
    url: normalizedUrl,
    taskType,
    ...(taskType === 'site-crawl' ? {
      crawlLimit,
      crawlConfig: options.crawlConfig ? JSON.parse(JSON.stringify(options.crawlConfig)) as Partial<CrawlConfig> : undefined,
    } : {}),
    intervalHours,
    enabled: true,
    status: 'scheduled',
    createdAt,
    nextRunAt: new Date(now + intervalHours * 60 * 60 * 1000).toISOString(),
  };
  saveScheduledAudits(projectId, [schedule, ...schedules]);
  return schedule;
};

export const setScheduledAuditEnabled = (projectId: string, id: string, enabled: boolean, now = Date.now()): ScheduledAudit[] => {
  const schedules = loadScheduledAudits(projectId).map((schedule) => schedule.id !== id ? schedule : {
    ...schedule,
    enabled,
    status: enabled ? 'scheduled' as const : 'paused' as const,
    nextRunAt: enabled ? new Date(now + schedule.intervalHours * 60 * 60 * 1000).toISOString() : schedule.nextRunAt,
    lastError: undefined,
  });
  saveScheduledAudits(projectId, schedules);
  return schedules;
};

/**
 * Make one enabled schedule eligible on the next scheduler tick.
 *
 * Keeping this as a state transition (rather than running the audit from the
 * panel) means the same project lock, cancellation path and completion
 * bookkeeping are used for manual and recurring executions.
 */
export const runScheduledAuditNow = (projectId: string, id: string, now = Date.now()): ScheduledAudit[] => {
  const schedules = loadScheduledAudits(projectId).map((schedule) => {
    if (schedule.id !== id || !schedule.enabled || schedule.status === 'running') return schedule;
    return {
      ...schedule,
      status: 'scheduled' as const,
      nextRunAt: new Date(now).toISOString(),
      lastError: undefined,
    };
  });
  saveScheduledAudits(projectId, schedules);
  return schedules;
};

export const removeScheduledAudit = (projectId: string, id: string): ScheduledAudit[] => {
  const schedules = loadScheduledAudits(projectId).filter((schedule) => schedule.id !== id);
  saveScheduledAudits(projectId, schedules);
  return schedules;
};

export const claimDueScheduledAudit = (
  projectId: string,
  now = Date.now(),
  requestedScheduleId?: string,
): ScheduledAudit | null => {
  if (!validProjectId(projectId) || inFlightProjects.size > 0) return null;
  const schedules = loadScheduledAudits(projectId);
  const dueIndex = schedules.findIndex((schedule) => {
    if (requestedScheduleId && schedule.id !== requestedScheduleId) return false;
    if (!schedule.enabled) return false;
    const nextRun = Date.parse(schedule.nextRunAt);
    if (nextRun > now) return false;
    if (schedule.status !== 'running') return true;
    const startedAt = Date.parse(schedule.lastStartedAt || '');
    return !Number.isFinite(startedAt) || now - startedAt >= RUNNING_STALE_AFTER_MS;
  });
  if (dueIndex < 0) return null;
  const schedule = schedules[dueIndex];
  const running = { ...schedule, status: 'running' as const, lastStartedAt: new Date(now).toISOString(), lastError: undefined };
  schedules[dueIndex] = running;
  saveScheduledAudits(projectId, schedules);
  inFlightProjects.add(projectId);
  return running;
};

export const finishScheduledAudit = (projectId: string, id: string, succeeded: boolean, error?: string, now = Date.now()): ScheduledAudit[] => {
  inFlightProjects.delete(projectId);
  const schedules = loadScheduledAudits(projectId).map((schedule) => schedule.id !== id ? schedule : {
    ...schedule,
    status: (schedule.enabled ? succeeded ? 'completed' : 'failed' : 'paused') as ScheduledAuditStatus,
    lastRunAt: new Date(now).toISOString(),
    nextRunAt: new Date(now + schedule.intervalHours * 60 * 60 * 1000).toISOString(),
    lastError: succeeded ? undefined : error?.slice(0, 500) || i18n.t('runtimeErrors.schedules.auditFailed'),
    runHistory: [
      ...(schedule.runHistory || []),
      {
        startedAt: schedule.lastStartedAt || new Date(now).toISOString(),
        completedAt: new Date(now).toISOString(),
        succeeded,
        ...(succeeded ? {} : { error: error?.slice(0, 500) || i18n.t('runtimeErrors.schedules.auditFailed') }),
      },
    ].slice(-20),
  });
  saveScheduledAudits(projectId, schedules);
  return schedules;
};
