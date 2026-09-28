import React from 'react';
import { useTranslation } from 'react-i18next';
import { History, X, Trash2, ArrowRight } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useAuditStore } from '@/stores/auditStore';
import { PageAuditData } from '@/types';
import { useModalA11y } from '@/hooks/useModalA11y';

export const HistoryModal: React.FC = () => {
  const { t } = useTranslation();
  const closeModal = useUIStore((s) => s.closeModal);
  const history = useAuditStore((s) => s.history);
  const setAuditData = useAuditStore((s) => s.setAuditData);
  const removeFromHistory = useAuditStore((s) => s.removeFromHistory);
  const dialogRef = useModalA11y<HTMLDivElement>(closeModal);

  const handleSelect = (item: PageAuditData) => {
    setAuditData(item);
    closeModal();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="audit-history-title" aria-describedby="audit-history-description" tabIndex={-1} className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-slate-800 text-slate-300">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 id="audit-history-title" className="text-sm font-bold text-white">{t('urlBar.history')}</h3>
              <p id="audit-history-description" className="text-[11px] text-slate-400">
                {t('urlBar.historyCount', { count: history.length })}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeModal}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
            aria-label={t('urlBar.closeHistory')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* History List */}
        <div className="p-6 overflow-y-auto divide-y divide-slate-800/80">
          {history.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              {t('urlBar.historyEmpty')}
            </div>
          ) : (
            history.map((item, idx) => (
                <div
                  key={idx}
                  className="py-3 flex items-center justify-between gap-3 group hover:bg-slate-800/30 px-2 rounded-lg transition"
                >
                <div
                  onClick={() => handleSelect(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleSelect(item);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={t('urlBar.loadAudit', { url: item.final_url })}
                  className="flex-1 min-w-0 cursor-pointer"
                >
                  <div className="flex items-center space-x-2 mb-0.5">
                    <span className="text-xs font-semibold text-white truncate">
                      {item.meta_tags.title || item.final_url}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${
                        item.health_score >= 80
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-amber-500/10 text-amber-400'
                      }`}
                    >
                      {t('legacyUi.history.score', { score: item.health_score })}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 truncate">
                    {item.final_url}
                  </div>
                </div>

                <div className="flex items-center space-x-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSelect(item)}
                    className="p-1.5 text-slate-400 hover:text-emerald-400 rounded transition"
                    title={t('legacyUi.history.load')}
                    aria-label={t('urlBar.loadAudit', { url: item.final_url })}
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFromHistory(idx)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 rounded transition"
                    title={t('legacyUi.history.remove')}
                    aria-label={t('urlBar.removeAudit', { url: item.final_url })}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
