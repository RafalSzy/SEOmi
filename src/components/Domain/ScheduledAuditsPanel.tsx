import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, Layers, Pause, Play, Plus, Trash2 } from 'lucide-react';
import {
  addScheduledAudit,
  AUDIT_SCHEDULES_UPDATED_EVENT,
  AuditIntervalHours,
  loadScheduledAudits,
  removeScheduledAudit,
  runScheduledAuditNow,
  ScheduledAudit,
  ScheduledTaskType,
  setScheduledAuditEnabled,
} from '@/services/auditSchedule';
import { isTauriEnvironment } from '@/services/tauri';
import { removeAuditWakeup, syncAuditWakeup } from '@/services/scheduleWakeup';
import type { CrawlConfig } from '@/types';

interface ScheduledAuditsPanelProps {
  projectId: string;
  initialUrl?: string;
  crawlConfig?: CrawlConfig;
  crawlLimit?: number;
}

const intervalOptions: Array<{ hours: AuditIntervalHours; labelKey: string }> = [
  { hours: 6, labelKey: 'schedules.every6Hours' },
  { hours: 12, labelKey: 'schedules.every12Hours' },
  { hours: 24, labelKey: 'schedules.daily' },
  { hours: 168, labelKey: 'schedules.weekly' },
];

const localDate = (value: string, language: string): string => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : '—';
};

export const ScheduledAuditsPanel: React.FC<ScheduledAuditsPanelProps> = ({ projectId, initialUrl = '', crawlConfig, crawlLimit = 25 }) => {
  const { t, i18n } = useTranslation();
  const translate = (key: string, options?: Record<string, unknown>): string => t(key, options);
  const [url, setUrl] = useState(initialUrl);
  const [intervalHours, setIntervalHours] = useState<AuditIntervalHours>(24);
  const [taskType, setTaskType] = useState<ScheduledTaskType>('page-audit');
  const [scheduledCrawlLimit, setScheduledCrawlLimit] = useState(crawlLimit);
  const [schedules, setSchedules] = useState<ScheduledAudit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);
  const projectIdRef = useRef(projectId);

  useEffect(() => {
    projectIdRef.current = projectId;
    setSchedules(loadScheduledAudits(projectId));
    setUrl(initialUrl);
    setScheduledCrawlLimit(crawlLimit);
    setError(null);
    setSchedulerError(null);
  }, [projectId, initialUrl, crawlLimit]);

  useEffect(() => {
    const handleUpdated = (event: Event) => {
      if ((event as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId) {
        setSchedules(loadScheduledAudits(projectId));
      }
    };
    window.addEventListener(AUDIT_SCHEDULES_UPDATED_EVENT, handleUpdated);
    return () => window.removeEventListener(AUDIT_SCHEDULES_UPDATED_EVENT, handleUpdated);
  }, [projectId]);

  const refresh = () => setSchedules(loadScheduledAudits(projectId));

  const syncWakeup = (schedule?: ScheduledAudit): void => {
    if (!isTauriEnvironment()) return;
    void syncAuditWakeup(projectId, schedule)
      .then(() => {
        if (projectIdRef.current === projectId) setSchedulerError(null);
      })
      .catch((cause) => {
        if (projectIdRef.current === projectId) setSchedulerError(cause instanceof Error ? cause.message : translate('schedules.schedulerError', { error: String(cause) }));
      });
  };

  const removeWakeup = (scheduleId: string): void => {
    if (!isTauriEnvironment()) return;
    void removeAuditWakeup(projectId, scheduleId)
      .then(() => {
        if (projectIdRef.current === projectId) setSchedulerError(null);
      })
      .catch((cause) => {
        if (projectIdRef.current === projectId) setSchedulerError(cause instanceof Error ? cause.message : translate('schedules.schedulerError', { error: String(cause) }));
      });
  };

  const addSchedule = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      addScheduledAudit(projectId, url, intervalHours, Date.now(), {
        taskType,
        crawlLimit: scheduledCrawlLimit,
        crawlConfig: taskType === 'site-crawl' ? crawlConfig : undefined,
      });
      refresh();
      const created = loadScheduledAudits(projectId)[0];
      syncWakeup(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : translate('schedules.saveError'));
    }
  };

  return (
    <details className="rounded-xl border border-slate-800 bg-slate-900/45">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400">
        <span className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-emerald-300" />{translate('schedules.title')}</span>
        <span className="text-[11px] font-normal text-slate-500">{translate('schedules.activeCount', { active: schedules.filter((schedule) => schedule.enabled).length, total: schedules.length })}</span>
      </summary>
      <div className="space-y-4 border-t border-slate-800 p-4">
        <p className="text-xs leading-5 text-slate-400">{translate('schedules.description')}</p>
        {!isTauriEnvironment() && <p role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-100">{translate('schedules.desktopOnly')}</p>}
        {schedulerError && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-xs text-rose-200">{translate('schedules.schedulerError', { error: schedulerError })}</p>}
        <form onSubmit={addSchedule} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_160px_auto]">
          <label className="sr-only" htmlFor="scheduled-audit-url">{translate('schedules.urlLabel')}</label>
          <input id="scheduled-audit-url" type="url" required maxLength={2048} value={url} onChange={(event) => setUrl(event.target.value)} placeholder={taskType === 'site-crawl' ? translate('schedules.crawlPlaceholder') : translate('schedules.pagePlaceholder')} disabled={!isTauriEnvironment()} className="h-9 min-w-0 rounded-md border border-slate-700 bg-slate-950 px-3 text-xs text-white outline-none focus:border-emerald-400 disabled:opacity-50" />
          <label className="sr-only" htmlFor="scheduled-audit-type">{translate('schedules.taskTypeLabel')}</label>
          <select id="scheduled-audit-type" aria-label={translate('schedules.taskTypeLabel')} value={taskType} onChange={(event) => setTaskType(event.target.value as ScheduledTaskType)} disabled={!isTauriEnvironment()} className="h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400 disabled:opacity-50">
            <option value="page-audit">{translate('schedules.pageAudit')}</option>
            <option value="site-crawl">{translate('schedules.siteCrawl')}</option>
          </select>
          <label className="sr-only" htmlFor="scheduled-audit-interval">{translate('schedules.intervalLabel')}</label>
          <select id="scheduled-audit-interval" value={intervalHours} onChange={(event) => setIntervalHours(Number(event.target.value) as AuditIntervalHours)} disabled={!isTauriEnvironment()} className="h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400 disabled:opacity-50">
            {intervalOptions.map((option) => <option key={option.hours} value={option.hours}>{translate(option.labelKey)}</option>)}
          </select>
          <button type="submit" disabled={!isTauriEnvironment() || schedules.length >= 20} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-3.5 w-3.5" />{translate('schedules.add')}</button>
        </form>
        {taskType === 'site-crawl' && <label className="flex max-w-xs items-center gap-2 text-xs text-slate-400">{translate('schedules.crawlLimit')}<input aria-label={translate('schedules.crawlLimit')} type="number" min={1} max={500} value={scheduledCrawlLimit} onChange={(event) => setScheduledCrawlLimit(Math.min(500, Math.max(1, Number(event.target.value) || 1)))} disabled={!isTauriEnvironment()} className="h-9 w-24 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-400 disabled:opacity-50" /></label>}
        {error && <p role="alert" className="text-xs text-rose-300">{error || translate('schedules.error')}</p>}
        {schedules.length ? <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
          {schedules.map((schedule) => <li key={schedule.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate font-mono text-xs text-slate-200" title={schedule.url}>{schedule.taskType === 'site-crawl' ? <Layers className="h-3.5 w-3.5 shrink-0 text-sky-300" /> : <Clock3 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />}{schedule.url}</p>
              <p className="mt-1 text-[11px] text-slate-500">{schedule.taskType === 'site-crawl' ? translate('schedules.multiPage', { count: schedule.crawlLimit ?? 25 }) : translate('schedules.pageAuditShort')} · {translate(intervalOptions.find((option) => option.hours === schedule.intervalHours)?.labelKey || 'schedules.daily')} · {schedule.enabled ? translate('schedules.next', { date: localDate(schedule.nextRunAt, i18n.language || 'pl') }) : translate('schedules.paused')}{schedule.lastRunAt ? ` · ${translate('schedules.last', { date: localDate(schedule.lastRunAt, i18n.language || 'pl') })}` : ''}{schedule.status === 'running' ? ` · ${translate('schedules.running')}` : ''}</p>
              {schedule.lastError && <p className="mt-1 break-words text-[11px] text-rose-300">{schedule.lastError}</p>}
              {schedule.runHistory?.length ? <details className="mt-1 text-[11px] text-slate-500"><summary className="cursor-pointer">{translate('schedules.history', { count: schedule.runHistory.length })}</summary><ul className="mt-1 space-y-0.5 pl-3">{schedule.runHistory.slice(-5).reverse().map((entry) => <li key={`${entry.startedAt}-${entry.completedAt}`} className={entry.succeeded ? 'text-emerald-300' : 'text-rose-300'}>{entry.succeeded ? translate('schedules.success') : translate('schedules.failure')} · {localDate(entry.completedAt, i18n.language || 'pl')}{entry.error ? ` · ${entry.error}` : ''}</li>)}</ul></details> : null}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button type="button" aria-label={translate('schedules.runNowAria')} disabled={!schedule.enabled || schedule.status === 'running'} onClick={() => { const updated = runScheduledAuditNow(projectId, schedule.id); refresh(); const next = updated.find((item) => item.id === schedule.id); syncWakeup(next); }} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-700 px-2 text-[11px] text-slate-300 hover:border-emerald-400/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"><Play className="h-3 w-3" />{translate('schedules.runNow')}</button>
              <button type="button" aria-label={schedule.enabled ? translate('schedules.pauseAria') : translate('schedules.resumeAria')} onClick={() => { const updated = setScheduledAuditEnabled(projectId, schedule.id, !schedule.enabled); refresh(); const next = updated.find((item) => item.id === schedule.id); syncWakeup(next); }} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-700 px-2 text-[11px] text-slate-300 hover:border-emerald-400/50 hover:text-white">{schedule.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}{schedule.enabled ? translate('schedules.pause') : translate('schedules.resume')}</button>
              <button type="button" aria-label={translate('schedules.removeAria')} onClick={() => { removeScheduledAudit(projectId, schedule.id); refresh(); removeWakeup(schedule.id); }} className="inline-flex h-8 items-center justify-center rounded-md border border-slate-700 px-2 text-slate-400 hover:border-rose-400/50 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </li>)}
        </ul> : <p className="rounded-lg border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">{translate('schedules.empty')}</p>}
      </div>
    </details>
  );
};
