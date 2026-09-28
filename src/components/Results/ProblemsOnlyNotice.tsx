import { AlertTriangle, CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AuditProblem } from '@/services/auditProblems';

interface ProblemsOnlyNoticeProps {
  problems: AuditProblem[];
  subject: string;
}

export const ProblemsOnlyNotice = ({ problems, subject }: ProblemsOnlyNoticeProps) => {
  const { t } = useTranslation();
  if (!problems.length) {
    return <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center"><CircleCheck className="mx-auto mb-3 h-8 w-8 text-emerald-300" /><h3 className="text-sm font-semibold text-emerald-100">{t('componentUi.noProblems')}</h3><p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-slate-400">{t('componentUi.noProblemsDetail', { subject })}</p></div>;
  }

  return <section aria-label={t('componentUi.problems', { subject })} className="overflow-hidden rounded-2xl border border-amber-500/20 bg-slate-900/60"><header className="flex items-center gap-2 border-b border-amber-500/15 bg-amber-500/5 px-5 py-4"><AlertTriangle className="h-4 w-4 text-amber-300" /><div><h3 className="text-sm font-semibold text-amber-100">{t('componentUi.problems', { subject })}</h3><p className="mt-0.5 text-xs text-slate-400">{t('componentUi.problemsOnly')}</p></div></header><div className="divide-y divide-slate-800">{problems.map((problem) => <article key={problem.id} className="px-5 py-4"><div className="flex items-start gap-3"><span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${problem.severity === 'error' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>{problem.severity === 'error' ? t('componentUi.error') : t('componentUi.warning')}</span><div className="min-w-0"><h4 className="text-xs font-semibold text-slate-100">{problem.label}</h4><p className="mt-1 text-xs leading-5 text-slate-400">{problem.detail}</p>{problem.evidence && <details className="mt-2 text-[11px] text-slate-500"><summary className="cursor-pointer text-slate-400">{t('schemaFindings.sourceEvidence')}</summary><p className="mt-1 break-words font-mono">{problem.evidence}</p></details>}</div></div></article>)}</div></section>;
};
