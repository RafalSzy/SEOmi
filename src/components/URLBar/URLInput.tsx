import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, ArrowRight, Clipboard, RotateCcw, Globe, FileUp, Play, Square, X } from 'lucide-react';
import { useAuditStore } from '@/stores/auditStore';
import { useProjectStore } from '@/stores/projectStore';
import { readStorage, writeStorage } from '@/services/storage';
import { UserAgentSelector } from './UserAgentSelector';

const auditUrlDraftKey = (projectId: string) => `seomi_project_${projectId}_audit_url_draft_v1`;

export const URLInput: React.FC = () => {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projectRootUrl = useProjectStore((state) => state.projects.find((project) => project.id === state.activeProjectId)?.rootUrl || '');
  const startAudit = useAuditStore((s) => s.startAudit);
  const isLoading = useAuditStore((s) => s.isLoading);
  const currentAudit = useAuditStore((s) => s.currentAudit);
  const batchItems = useAuditStore((s) => s.batchItems);
  const batchRejectedRows = useAuditStore((s) => s.batchRejectedRows);
  const batchRun = useAuditStore((s) => s.batchRun);
  const isBatchRunning = useAuditStore((s) => s.isBatchRunning);
  const isBatchStopping = useAuditStore((s) => s.isBatchStopping);
  const batchWakeupError = useAuditStore((s) => s.batchWakeupError);
  const importAuditCsv = useAuditStore((s) => s.importAuditCsv);
  const startBatchAudits = useAuditStore((s) => s.startBatchAudits);
  const stopBatchAudits = useAuditStore((s) => s.stopBatchAudits);
  const clearBatchAudits = useAuditStore((s) => s.clearBatchAudits);
  const csvInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!activeProjectId) {
      setUrl('');
      return;
    }
    const savedDraft = readStorage(auditUrlDraftKey(activeProjectId));
    setUrl(savedDraft !== null ? savedDraft : projectRootUrl);
  }, [activeProjectId, projectRootUrl]);

  const updateUrl = (value: string) => {
    setUrl(value);
    if (activeProjectId) writeStorage(auditUrlDraftKey(activeProjectId), value.slice(0, 2048));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isLoading) return;
    startAudit(url.trim());
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        // Keep paste consistent with typing: the active project's draft must
        // survive a project switch or app restart as well.
        updateUrl(text.trim());
      }
    } catch {
      // Clipboard read permission declined
    }
  };

  const handleReAudit = () => {
    if (currentAudit?.url) {
      startAudit(currentAudit.url);
    }
  };

  const handleCsvImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    importAuditCsv(await file.text());
    event.target.value = '';
  };

  const completedCount = batchItems.filter((item) => item.status === 'completed').length;
  const failedCount = batchItems.filter((item) => item.status === 'failed').length;
  const interruptedCount = batchItems.filter((item) => item.status === 'interrupted').length;
  const pendingCount = batchItems.filter((item) => item.status === 'queued' || item.status === 'running' || item.status === 'interrupted').length;
  const runLabel = batchRun?.status === 'interrupted'
    ? t('legacyUi.url.runInterrupted')
    : batchRun?.status === 'stopped'
      ? t('legacyUi.url.runStopped')
      : batchRun?.status === 'completed'
        ? t('legacyUi.url.runCompleted')
        : batchRun?.status === 'running'
          ? t('legacyUi.url.runRunning')
          : null;

  return (
    <div className="bg-slate-950/60 border-b border-slate-800/80 px-4 py-3">
      <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-6xl mx-auto">
        {/* Main URL input container */}
        <div className="relative flex-1 flex items-center">
          <div className="absolute left-3 text-slate-400 pointer-events-none flex items-center">
            {isLoading ? (
              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
            ) : (
              <Globe className="w-4 h-4 text-slate-400" />
            )}
          </div>

          <input
            id="url-input-field"
            aria-label={t('legacyUi.url.urlAria')}
            type="text"
            value={url}
            onChange={(e) => updateUrl(e.target.value)}
            placeholder={t('urlBar.placeholder')}
            disabled={isLoading}
            className="w-full h-10 pl-9 pr-24 bg-slate-900/90 border border-slate-700/80 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition disabled:opacity-60"
            autoComplete="off"
            spellCheck={false}
          />

          {/* Quick paste button inside input */}
          <div className="absolute right-2 flex items-center space-x-1.5">
            <button
              type="button"
              onClick={handlePaste}
              className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-800 rounded border border-slate-700/50 transition flex items-center space-x-1"
              title={t('urlBar.quickPaste')}
            >
              <Clipboard className="w-3 h-3" />
              <span className="hidden sm:inline">{t('urlBar.quickPaste')}</span>
            </button>
            <kbd className="hidden lg:inline-block px-1.5 py-0.5 text-[10px] text-slate-400 font-mono bg-slate-800 rounded border border-slate-700">
              {t('uiUnits.openCommandPaletteShortcut')}
            </kbd>
          </div>
        </div>

        {/* User Agent preset selector */}
        <UserAgentSelector />

        <input ref={csvInput} onChange={handleCsvImport} accept=".csv,text/csv" type="file" className="hidden" aria-label={t('legacyUi.url.csvImportAria')} />
        <button
          type="button"
          onClick={() => csvInput.current?.click()}
          disabled={isLoading || isBatchRunning}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900 px-3 text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          title={t('legacyUi.url.csvImportTitle')}
        >
          <FileUp className="h-3.5 w-3.5 text-emerald-400" />
          <span className="hidden xl:inline">{t('legacyUi.url.csv')}</span>
        </button>

        {/* Submit button */}
        <button
          type="submit"
          disabled={!url.trim() || isLoading}
          aria-label={t('urlBar.analyze')}
          className="h-10 px-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm shadow-emerald-600/30 transition flex items-center space-x-1.5 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="hidden sm:inline">{t('urlBar.analyzing')}</span>
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">{t('urlBar.analyze')}</span>
              <ArrowRight className="w-3.5 h-3.5 sm:hidden" />
            </>
          )}
        </button>

        {/* Re-audit button if current audit exists */}
        {currentAudit && (
          <button
            type="button"
            onClick={handleReAudit}
            disabled={isLoading}
            className="h-10 px-3 bg-slate-900 border border-slate-700/80 hover:border-slate-600 text-slate-300 hover:text-white rounded-lg transition flex items-center space-x-1 text-xs shrink-0 disabled:opacity-50"
            title={t('legacyUi.url.reauditTitle')}
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </form>
      {batchItems.length > 0 && (
        <section className="mx-auto mt-3 flex max-w-6xl flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between" aria-label={t('legacyUi.url.queueAria')}>
          <div className="min-w-0 text-xs text-slate-300"><span className="font-semibold text-white">{t('legacyUi.url.csv')}:</span> {t('legacyUi.url.queue', { completed: completedCount, pending: pendingCount, failed: failedCount, interrupted: interruptedCount ? t('legacyUi.url.interrupted', { count: interruptedCount }) : '', rejected: batchRejectedRows.length ? t('legacyUi.url.rejected', { count: batchRejectedRows.length }) : '' })} {runLabel && <span className="ml-1 text-slate-400">({runLabel}{batchRun?.updatedAt ? ` · ${new Date(batchRun.updatedAt).toLocaleString()}` : ''})</span>} {isBatchStopping && t('legacyUi.url.cancelling')}</div>
          <div className="flex shrink-0 items-center gap-2">
            {isBatchRunning ? <button type="button" onClick={stopBatchAudits} disabled={isBatchStopping} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 text-xs font-semibold text-amber-200 disabled:opacity-50"><Square className="h-3 w-3" />{t('legacyUi.url.stop')}</button> : <button type="button" onClick={() => void startBatchAudits()} disabled={!pendingCount && !failedCount} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-slate-950 disabled:opacity-50"><Play className="h-3 w-3" />{completedCount || interruptedCount || failedCount ? t('legacyUi.url.resume') : t('legacyUi.url.run')}</button>}
            <button type="button" onClick={clearBatchAudits} disabled={isBatchRunning} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-50" title={t('legacyUi.url.clearQueue')}><X className="h-3.5 w-3.5" /></button>
          </div>
          {batchWakeupError && <p role="alert" className="basis-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{batchWakeupError}</p>}
        </section>
      )}
    </div>
  );
};
