import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  FolderPlus,
  Keyboard,
  Search,
  X,
} from 'lucide-react';
import { useAuditStore } from '@/stores/auditStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import { writeEphemeralStorage } from '@/services/storage';
import type { TabType } from '@/types';
import { WORKSPACE_NAVIGATION } from '@/components/Layout/navigation';

type PaletteItem = {
  id: string;
  label: string;
  group: string;
  keywords: string;
  icon: React.ElementType;
  action: () => void;
};

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

export const CommandPalette: React.FC = () => {
  const { t } = useTranslation();
  const open = useUIStore((state) => state.commandPaletteOpen);
  const close = useUIStore((state) => state.closeCommandPalette);
  const openModal = useUIStore((state) => state.openModal);
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const selectProject = useProjectStore((state) => state.selectProject);
  const setActiveTab = useAuditStore((state) => state.setActiveTab);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const run = (action: () => void) => {
    close();
    setQuery('');
    setActiveIndex(0);
    action();
  };

  const navigate = (tab: TabType) => run(() => setActiveTab(tab));

  const items = useMemo<PaletteItem[]>(() => {
    const moduleItems: PaletteItem[] = WORKSPACE_NAVIGATION.flatMap((section) => section.items
      .filter((definition) => definition.tab)
      .map((definition) => ({
        id: definition.key,
        label: t(definition.labelKey),
        keywords: definition.keywords,
        group: t(section.titleKey),
        icon: definition.icon,
        action: () => {
          if (definition.action === 'semantic-map') {
            writeEphemeralStorage('seomi_open_crawl_map_v1', '1');
          }
          navigate(definition.tab as TabType);
          if (definition.action === 'semantic-map') {
            // Dispatch after the tab switch so SiteAudit has a mounted listener.
            window.dispatchEvent(new Event('seomi:open-crawl-map'));
          }
        },
      })));

    const workspaceActions: PaletteItem[] = [
      { id: 'history', label: t('sidebar.history'), group: t('sidebar.workspaceTools'), keywords: 'history audit run', icon: WORKSPACE_NAVIGATION.find((section) => section.key === 'workspace-tools')?.items.find((item) => item.key === 'history')?.icon ?? FolderPlus, action: () => run(() => openModal('history')) },
      { id: 'settings', label: t('sidebar.settings'), group: t('sidebar.workspaceTools'), keywords: 'settings integrations dataforseo google', icon: WORKSPACE_NAVIGATION.find((section) => section.key === 'workspace-tools')?.items.find((item) => item.key === 'settings')?.icon ?? FolderPlus, action: () => run(() => openModal('settings')) },
      { id: 'ai-assistant', label: t('sidebar.aiAssistant'), group: t('sidebar.workspaceTools'), keywords: 'AI schema metadata', icon: WORKSPACE_NAVIGATION.find((section) => section.key === 'workspace-tools')?.items.find((item) => item.key === 'ai-assistant')?.icon ?? FolderPlus, action: () => run(() => openModal('ai')) },
      { id: 'ai-connection', label: t('sidebar.aiConnection'), group: t('sidebar.workspaceTools'), keywords: 'AI Claude Codex Gemini connection', icon: WORKSPACE_NAVIGATION.find((section) => section.key === 'workspace-tools')?.items.find((item) => item.key === 'ai-connection')?.icon ?? FolderPlus, action: () => run(() => openModal('subscription')) },
    ];

    const projectItems: PaletteItem[] = [
      {
        id: 'new-project',
        label: t('projects.createNew'),
        group: t('commandPalette.projectsGroup'),
        keywords: 'project workspace domain projekt workspace domena',
        icon: FolderPlus,
        action: () => run(() => openModal('create-project')),
      },
      ...projects.map((project) => ({
        id: `project:${project.id}`,
        label: project.id === activeProjectId
          ? `${project.name} · ${t('commandPalette.active')}`
          : project.name,
        group: t('commandPalette.projectsGroup'),
        keywords: `${project.rootUrl || ''} ${project.id}`,
        icon: FolderPlus,
        action: () => run(() => selectProject(project.id)),
      })),
    ];

    return [...projectItems, ...moduleItems, ...workspaceActions];
  }, [activeProjectId, openModal, projects, selectProject, t]);

  const filteredItems = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return items;
    return items.filter((item) => normalize(`${item.label} ${item.group} ${item.keywords}`).includes(needle));
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setQuery('');
    setActiveIndex(0);
    const focus = () => inputRef.current?.focus();
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focus);
    } else {
      focus();
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (activeIndex >= filteredItems.length) setActiveIndex(Math.max(0, filteredItems.length - 1));
  }, [activeIndex, filteredItems.length]);

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => filteredItems.length ? (index + 1) % filteredItems.length : 0);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => filteredItems.length ? (index - 1 + filteredItems.length) % filteredItems.length : 0);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        setActiveIndex(Math.max(0, filteredItems.length - 1));
        return;
      }
      if (event.key === 'Tab') {
        const dialog = document.getElementById('command-palette-dialog');
        if (!dialog) return;
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('input, button, [href], [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled') && element.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === 'Enter' && filteredItems[activeIndex]) {
        event.preventDefault();
        filteredItems[activeIndex].action();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, close, filteredItems, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-950/70 px-4 pt-[12vh] backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <section
        id="command-palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          <h2 id="command-palette-title" className="sr-only">{t('commandPalette.title')}</h2>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value.slice(0, 120)); setActiveIndex(0); }}
            aria-label={t('commandPalette.searchLabel')}
            placeholder={t('commandPalette.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          <kbd className="hidden rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline">{t('commandPalette.escape')}</kbd>
          <button type="button" onClick={close} aria-label={t('commandPalette.close')} className="rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div
          className="max-h-[55vh] overflow-y-auto p-2"
          role="listbox"
          aria-label={t('commandPalette.results')}
          aria-activedescendant={filteredItems[activeIndex] ? `command-palette-option-${filteredItems[activeIndex].id}` : undefined}
        >
          {filteredItems.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-slate-500">{t('commandPalette.noResults')}</p>
          ) : filteredItems.map((item, index) => {
            const Icon = item.icon;
            const selected = index === activeIndex;
            return (
              <button
                key={item.id}
                id={`command-palette-option-${item.id}`}
                ref={selected ? activeOptionRef : undefined}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={item.action}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${selected ? 'bg-emerald-400/10 text-emerald-100' : 'text-slate-300 hover:bg-slate-800/80'}`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${selected ? 'text-emerald-400' : 'text-slate-500'}`} aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm">{item.label}</span><span className="block truncate text-[10px] text-slate-500">{item.group}</span></span>
                {item.id === `project:${activeProjectId}` && <span className="text-[10px] text-emerald-400">{t('commandPalette.active')}</span>}
                {selected && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-slate-800 px-4 py-2 text-[10px] text-slate-500">
          <span><Keyboard className="mr-1 inline h-3 w-3" aria-hidden="true" />{t('commandPalette.keyboardHelp')}</span>
          <span>{t('commandPalette.itemsCount', { count: filteredItems.length })}</span>
        </div>
      </section>
    </div>
  );
};
