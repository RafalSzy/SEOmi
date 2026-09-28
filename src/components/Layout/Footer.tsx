import React, { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { relaunch } from '@tauri-apps/plugin-process';
import { APP_AUTHOR, APP_AUTHOR_URL, APP_LICENSE, APP_VERSION } from '@/constants/app';
import { useUIStore } from '@/stores/uiStore';

export const Footer: React.FC = () => {
  const { t } = useTranslation();
  const openModal = useUIStore((state) => state.openModal);
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const version = (event as CustomEvent<{ version?: string | null }>).detail?.version;
      setInstalledVersion(version || null);
    };
    window.addEventListener('seomi-update-installed', handleUpdate);
    return () => window.removeEventListener('seomi-update-installed', handleUpdate);
  }, []);

  return (
    <footer className="flex min-h-8 shrink-0 items-center justify-between gap-3 border-t border-slate-800/80 bg-slate-950/95 px-4 py-1.5 text-[10px] text-slate-500">
      <span>{t('app.footerVersion', { version: APP_VERSION })}</span>
      <span className="hidden sm:inline">{t('app.footerAuthor')} <a href={APP_AUTHOR_URL} target="_blank" rel="noreferrer" className="text-slate-400 transition hover:text-emerald-300">{APP_AUTHOR}<ExternalLink className="ml-1 inline h-3 w-3" aria-hidden="true" /></a> · {APP_LICENSE}</span>
      {installedVersion && <button type="button" onClick={() => void relaunch()} className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-amber-200 transition hover:bg-amber-500/25" title={t('legacyUi.settings.restartRequired')}>
        <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
        {t('legacyUi.settings.restartNow')} {t('app.footerVersion', { version: installedVersion })}
      </button>}
      <button type="button" onClick={() => openModal('settings')} className="inline-flex items-center gap-1 text-slate-400 transition hover:text-emerald-300" title={t('app.footerUpdates')}>
        <RefreshCw className="h-3 w-3" aria-hidden="true" />
        {t('app.footerUpdates')}
      </button>
    </footer>
  );
};
