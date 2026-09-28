import { useTranslation } from 'react-i18next';
import { shiftTopicalCalendarMonth, topicalCalendarDays } from '@/services/topicalMap';
import type { TopicalLifecycle, TopicalNode } from '@/services/topicalMap';

export interface TopicalCalendarFilters {
  lifecycle: TopicalLifecycle | 'all';
  kind: TopicalNode['kind'] | 'all';
  boundary: TopicalNode['boundary'] | 'all';
}

interface Props {
  nodes: TopicalNode[];
  month: string;
  filters: TopicalCalendarFilters;
  search: string;
  onMonthChange: (month: string) => void;
  onFiltersChange: (filters: TopicalCalendarFilters) => void;
  onSearchChange: (search: string) => void;
  onSelect: (nodeId: string) => void;
  onCreate: (date: string) => void;
  onBack: () => void;
}

const selectClass = 'h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-200 outline-none focus:border-emerald-400';
const lifecycleColors: Record<TopicalLifecycle, string> = {
  planned: 'border-slate-700 text-slate-300',
  briefed: 'border-sky-500/30 text-sky-300',
  drafted: 'border-violet-500/30 text-violet-300',
  published: 'border-emerald-500/30 text-emerald-300',
  'needs-update': 'border-amber-500/30 text-amber-300',
};

export const TopicalCalendar = ({ nodes, month, filters, search, onMonthChange, onFiltersChange, onSearchChange, onSelect, onCreate, onBack }: Props) => {
  const { t, i18n } = useTranslation();
  const lifecycleLabels: Record<TopicalLifecycle, string> = { planned: t('topicalCalendarUi.planned'), briefed: t('topicalCalendarUi.briefed'), drafted: t('topicalCalendarUi.drafted'), published: t('topicalCalendarUi.published'), 'needs-update': t('topicalCalendarUi.needsUpdate') };
  const kindLabels: Record<TopicalNode['kind'], string> = { pillar: t('topicalCalendarUi.pillar'), cluster: t('topicalCalendarUi.cluster'), supporting: t('topicalCalendarUi.supporting') };
  const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((key) => t(`topicalCalendarUi.${key}`));
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  const monthDate = match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date();
  const visibleNodes = nodes.filter((node) =>
    (filters.lifecycle === 'all' || node.lifecycle === filters.lifecycle)
    && (filters.kind === 'all' || node.kind === filters.kind)
    && (filters.boundary === 'all' || node.boundary === filters.boundary)
    && (!search.trim() || `${node.title} ${node.evidenceTerms.join(' ')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),
  );
  const days = topicalCalendarDays(month);
  const byDate = new Map<string, TopicalNode[]>();
  for (const node of visibleNodes) {
    if (!node.scheduledDate) continue;
    byDate.set(node.scheduledDate, [...(byDate.get(node.scheduledDate) ?? []), node]);
  }
  const unscheduled = visibleNodes.filter((node) => !node.scheduledDate);
  const moveMonth = (delta: number) => onMonthChange(shiftTopicalCalendarMonth(month, delta));

  return <section aria-label={t('topicalCalendarUi.sectionAria')} className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/45 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h4 className="text-sm font-semibold text-slate-100">{t('topicalCalendarUi.title')}</h4><p className="mt-1 text-[10px] text-slate-500">{t('topicalCalendarUi.description')}</p><button type="button" onClick={onBack} className="mt-2 rounded border border-slate-700 px-2.5 py-1.5 text-[10px] text-slate-300 hover:border-emerald-400">{t('topicalCalendarUi.back')}</button></div>
      <div className="flex items-center gap-2"><button type="button" aria-label={t('topicalCalendarUi.previousMonth')} onClick={() => moveMonth(-1)} className="h-9 w-9 rounded-md border border-slate-700 text-slate-300 hover:border-slate-500">‹</button><h5 aria-live="polite" className="min-w-36 text-center text-sm font-medium capitalize text-slate-200">{monthDate.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })}</h5><button type="button" aria-label={t('topicalCalendarUi.nextMonth')} onClick={() => moveMonth(1)} className="h-9 w-9 rounded-md border border-slate-700 text-slate-300 hover:border-slate-500">›</button><button type="button" onClick={() => { const now = new Date(); onMonthChange(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`); }} className="h-9 rounded-md border border-slate-700 px-2.5 text-[10px] text-slate-300 hover:border-emerald-400">{t('topicalCalendarUi.today')}</button></div>
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <label className="sr-only" htmlFor="topical-calendar-search">{t('topicalCalendarUi.searchLabel')}</label><input id="topical-calendar-search" aria-label={t('topicalCalendarUi.searchLabel')} value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={t('topicalCalendarUi.filterPlaceholder')} className={`${selectClass} w-full`} />
      <label><span className="sr-only">{t('topicalCalendarUi.filterLifecycle')}</span><select aria-label={t('topicalCalendarUi.filterLifecycle')} className={`${selectClass} w-full`} value={filters.lifecycle} onChange={(event) => onFiltersChange({ ...filters, lifecycle: event.target.value as TopicalCalendarFilters['lifecycle'] })}><option value="all">{t('topicalCalendarUi.allStages')}</option>{Object.entries(lifecycleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span className="sr-only">{t('topicalCalendarUi.filterKind')}</span><select aria-label={t('topicalCalendarUi.filterKind')} className={`${selectClass} w-full`} value={filters.kind} onChange={(event) => onFiltersChange({ ...filters, kind: event.target.value as TopicalCalendarFilters['kind'] })}><option value="all">{t('topicalCalendarUi.allTypes')}</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span className="sr-only">{t('topicalCalendarUi.filterBoundary')}</span><select aria-label={t('topicalCalendarUi.filterBoundary')} className={`${selectClass} w-full`} value={filters.boundary} onChange={(event) => onFiltersChange({ ...filters, boundary: event.target.value as TopicalCalendarFilters['boundary'] })}><option value="all">{t('topicalCalendarUi.coreOuter')}</option><option value="core">{t('topicalCalendarUi.core')}</option><option value="outer">{t('topicalCalendarUi.outer')}</option></select></label>
    </div>

    <div role="grid" aria-label={t('topicalCalendarUi.monthDays', { month })} className="mt-4 overflow-hidden rounded-lg border border-slate-800">
      <div role="row" className="grid grid-cols-7">{weekdays.map((day) => <div role="columnheader" key={day} className="border-b border-r border-slate-800 bg-slate-950/70 px-1 py-2 text-center text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:px-2">{day}</div>)}</div>
      {Array.from({ length: days.length / 7 }, (_, week) => <div role="row" key={days[week * 7]?.date} className="grid grid-cols-7">{days.slice(week * 7, week * 7 + 7).map((day) => <div role="gridcell" key={day.date} aria-label={day.date} className={`group min-h-24 min-w-0 border-b border-r border-slate-800 p-1.5 sm:min-h-32 sm:p-2 ${day.inCurrentMonth ? 'bg-slate-950/25' : 'bg-slate-950/60 text-slate-600'}`}>
        <div className="flex items-center justify-between gap-1"><span className={`text-[10px] font-medium tabular-nums ${day.inCurrentMonth ? 'text-slate-400' : 'text-slate-600'}`}>{Number(day.date.slice(-2))}</span><button type="button" aria-label={t('topicalCalendarUi.addTopic', { date: day.date })} onClick={() => onCreate(day.date)} className="rounded px-1 text-[10px] text-slate-600 opacity-0 hover:bg-emerald-500/10 hover:text-emerald-300 focus:opacity-100 group-hover:opacity-100">＋</button></div>
        <div className="mt-1 max-h-20 space-y-1 overflow-y-auto">{(byDate.get(day.date) ?? []).map((node) => <button type="button" key={node.id} onClick={() => onSelect(node.id)} className={`block w-full truncate rounded border px-1.5 py-1 text-left text-[9px] leading-3 hover:bg-slate-800/80 ${lifecycleColors[node.lifecycle]}`} title={`${node.title} · ${kindLabels[node.kind]} · ${lifecycleLabels[node.lifecycle]}`}>{node.title}</button>)}</div>
      </div>)}</div>)}
    </div>

    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/30 p-3"><div className="flex items-baseline justify-between gap-2"><h5 className="text-xs font-semibold text-slate-300">{t('topicalCalendarUi.unscheduled')}</h5><span className="text-[9px] text-slate-600">{t('topicalCalendarUi.unscheduledCount', { count: unscheduled.length })}</span></div>{unscheduled.length ? <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">{unscheduled.map((node) => <li key={node.id}><button type="button" onClick={() => onSelect(node.id)} className="w-full rounded-md border border-slate-800 px-2.5 py-2 text-left hover:border-sky-500/30"><span className="block truncate text-[10px] font-medium text-slate-300">{node.title}</span><span className="mt-1 flex gap-1.5 text-[9px] text-slate-600"><span>{kindLabels[node.kind]}</span><span>·</span><span>{lifecycleLabels[node.lifecycle]}</span><span>·</span><span>{node.boundary === 'core' ? t('topicalCalendarUi.core') : t('topicalCalendarUi.outer')}</span></span></button></li>)}</ul> : <p className="mt-2 text-[10px] text-slate-600">{t('topicalCalendarUi.noUnscheduled')}</p>}</div>
    <p className="mt-3 text-[9px] text-slate-600">{t('topicalCalendarUi.footerNote')}</p>
  </section>;
};
