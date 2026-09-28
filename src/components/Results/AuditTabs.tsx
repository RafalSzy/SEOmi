import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  Braces,
  ChevronLeft,
  ChevronRight,
  Filter,
  Gauge,
  Heading,
  Image,
  Link2,
  Rss,
  Share2,
  ShieldCheck,
  Tags,
  Zap,
} from 'lucide-react';
import { TabType } from '@/types';
import { useAuditStore } from '@/stores/auditStore';

type AuditTabGroup = 'overview' | 'content' | 'technical' | 'data';

type AuditTabDefinition = {
  id: TabType;
  labelKey: string;
  icon: typeof Gauge;
  group: AuditTabGroup;
};

const tabs: AuditTabDefinition[] = [
  { id: 'overview', labelKey: 'sidebar.overview', icon: Gauge, group: 'overview' },
  { id: 'metadata', labelKey: 'sidebar.metadata', icon: Tags, group: 'content' },
  { id: 'social', labelKey: 'sidebar.social', icon: Share2, group: 'content' },
  { id: 'headings', labelKey: 'sidebar.headings', icon: Heading, group: 'content' },
  { id: 'images', labelKey: 'sidebar.images', icon: Image, group: 'content' },
  { id: 'links', labelKey: 'sidebar.links', icon: Link2, group: 'content' },
  { id: 'structured', labelKey: 'sidebar.structured', icon: Braces, group: 'technical' },
  { id: 'amp', labelKey: 'sidebar.amp', icon: Rss, group: 'technical' },
  { id: 'security', labelKey: 'sidebar.security', icon: ShieldCheck, group: 'technical' },
  { id: 'performance', labelKey: 'sidebar.performance', icon: Zap, group: 'technical' },
  { id: 'dataforseo', labelKey: 'sidebar.dataforseo', icon: BarChart3, group: 'data' },
];

const groupLabels: Record<AuditTabGroup, string> = {
  overview: 'audit.groups.overview',
  content: 'audit.groups.content',
  technical: 'audit.groups.technical',
  data: 'audit.groups.data',
};

const groupOrder: AuditTabGroup[] = ['overview', 'content', 'technical', 'data'];

export const AuditTabs = () => {
  const { t } = useTranslation();
  const activeTab = useAuditStore((state) => state.activeTab);
  const setActiveTab = useAuditStore((state) => state.setActiveTab);
  const showOnlyProblems = useAuditStore((state) => state.showOnlyProblems);
  const setShowOnlyProblems = useAuditStore((state) => state.setShowOnlyProblems);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const scrollTabs = (direction: 'left' | 'right') => {
    const scroller = scrollRef.current;
    if (!scroller || typeof scroller.scrollBy !== 'function') return;
    scroller.scrollBy({ left: direction === 'left' ? -280 : 280, behavior: 'smooth' });
  };

  useEffect(() => {
    const activeElement = tabRefs.current[activeTab];
    if (activeElement && typeof activeElement.scrollIntoView === 'function') {
      activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeTab]);

  const moveFocus = (currentId: TabType, direction: 'previous' | 'next' | 'first' | 'last') => {
    const currentIndex = tabs.findIndex((tab) => tab.id === currentId);
    if (currentIndex < 0) return;
    const nextIndex = direction === 'first'
      ? 0
      : direction === 'last'
        ? tabs.length - 1
        : direction === 'previous'
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : (currentIndex + 1) % tabs.length;
    const nextTab = tabs[nextIndex];
    setActiveTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  return (
    <nav aria-label={t('audit.sections')} className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 px-2 py-2 backdrop-blur md:px-4">
      <div className="mx-auto flex max-w-6xl items-center gap-1">
        <button type="button" onClick={() => scrollTabs('left')} aria-label={t('audit.scrollPrevious')} className="hidden shrink-0 rounded-lg border border-slate-800 p-2 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:inline-flex">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <div ref={scrollRef} role="tablist" aria-label={t('audit.tabs')} className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5 scrollbar-thin">
          {groupOrder.map((group) => {
            const label = groupLabels[group];
            return (
              <div key={group} role="group" aria-label={t(label)} className="flex shrink-0 items-center gap-1">
                {group !== 'overview' && <span className="mx-1 h-5 w-px bg-slate-800" aria-hidden="true" />}
                {tabs.filter((tab) => tab.group === group).map((tab) => {
                  const Icon = tab.icon;
                  const selected = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      ref={(element) => { tabRefs.current[tab.id] = element; }}
                      type="button"
                      role="tab"
                      id={`audit-tab-${tab.id}`}
                      aria-controls="audit-panel"
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setActiveTab(tab.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowLeft') { event.preventDefault(); moveFocus(tab.id, 'previous'); }
                        else if (event.key === 'ArrowRight') { event.preventDefault(); moveFocus(tab.id, 'next'); }
                        else if (event.key === 'Home') { event.preventDefault(); moveFocus(tab.id, 'first'); }
                        else if (event.key === 'End') { event.preventDefault(); moveFocus(tab.id, 'last'); }
                      }}
                      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${selected ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {t(tab.labelKey)}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <button type="button" onClick={() => scrollTabs('right')} aria-label={t('audit.scrollNext')} className="hidden shrink-0 rounded-lg border border-slate-800 p-2 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:inline-flex">
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <button type="button" onClick={() => setShowOnlyProblems(!showOnlyProblems)} aria-pressed={showOnlyProblems} aria-label={t('audit.onlyProblems')} className={`ml-1 flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${showOnlyProblems ? 'border-amber-500/35 bg-amber-500/10 text-amber-200' : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}>
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden md:inline">{t('audit.onlyProblems')}</span>
        </button>
      </div>
    </nav>
  );
};
