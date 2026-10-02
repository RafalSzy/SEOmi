import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  FolderPlus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useAuditStore } from "@/stores/auditStore";
import { useProjectStore } from "@/stores/projectStore";
import { useWorkspaceIndicatorsStore } from "@/stores/workspaceIndicatorsStore";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { TabType } from "@/types";
import {
  readStorage,
  writeEphemeralStorage,
  writeStorage,
} from "@/services/storage";
import {
  WORKSPACE_NAVIGATION,
  type WorkspaceNavItemDefinition,
} from "@/components/Layout/navigation";

interface NavItem {
  id?: TabType;
  /** Search vocabulary is intentionally kept beside the visible label. */
  keywords: string;
  labelKey: string;
  icon: React.ElementType;
  badge?: () => number | string | null;
  action?: () => void;
}

interface NavSection {
  key: string;
  titleKey: string;
  items: NavItem[];
  badge?: () => number | string | null;
}

const sectionId = (key: string) => `sidebar-section-${key}`;
const navigationSearchKey = (projectId: string | null) =>
  projectId ? `seomi_project_${projectId}_sidebar_search_v1` : null;
const readNavigationSearch = (projectId: string | null): string => {
  const key = navigationSearchKey(projectId);
  if (!key) return "";
  return (readStorage(key) || "").slice(0, 120);
};
const persistNavigationSearch = (
  projectId: string | null,
  value: string,
): void => {
  const key = navigationSearchKey(projectId);
  if (!key) return;
  writeStorage(key, value.slice(0, 120));
};
const pageAuditTabIds: TabType[] = [
  "overview",
  "dataforseo",
  "social",
  "headings",
  "metadata",
  "images",
  "links",
  "security",
  "structured",
  "amp",
  "performance",
];

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const [navQuery, setNavQuery] = React.useState("");
  const currentAudit = useAuditStore((s) => s.currentAudit);
  const activeTab = useAuditStore((s) => s.activeTab);
  const setActiveTab = useAuditStore((s) => s.setActiveTab);
  const isLoading = useAuditStore((s) => s.isLoading);
  const isBatchRunning = useAuditStore((s) => s.isBatchRunning);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const collapsedSections = useUIStore((s) => s.collapsedSections);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const hydrateSidebarSections = useUIStore((s) => s.hydrateSidebarSections);
  const toggleSidebarSection = useUIStore((s) => s.toggleSidebarSection);
  const openModal = useUIStore((s) => s.openModal);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProject = useProjectStore((s) =>
    s.projects.find((project) => project.id === s.activeProjectId),
  );
  const lastNavigatedTab = React.useRef(activeTab);
  const provider = useAuthStore((s) => s.provider);

  const savedKeywordsCount = useWorkspaceIndicatorsStore((s) => s.savedKeywordsCount);
  const trackedRanksCount = useWorkspaceIndicatorsStore((s) => s.trackedRanksCount);
  const isCrawling = useWorkspaceIndicatorsStore((s) => s.isCrawling);
  const crawlProgress = useWorkspaceIndicatorsStore((s) => s.crawlProgress);
  const crawlRunsCount = useWorkspaceIndicatorsStore((s) => s.crawlRunsCount);

  useEffect(() => {
    hydrateSidebarSections(activeProjectId);
  }, [activeProjectId, hydrateSidebarSections]);

  useEffect(() => {
    setNavQuery(readNavigationSearch(activeProjectId));
  }, [activeProjectId]);

  const updateNavQuery = (value: string) => {
    const nextValue = value.slice(0, 120);
    setNavQuery(nextValue);
    persistNavigationSearch(activeProjectId, nextValue);
  };

  // Subscribe to the status itself: selecting the `isProviderConnected`
  // function never re-renders when a connection is established later.
  const isConnected = useAuthStore((s) => s.connectionStatus[s.provider] === 'connected');
  const providerName =
    provider === "claude"
      ? "Claude"
      : provider === "openai"
        ? "OpenAI"
        : "Gemini";

  const navSections: NavSection[] = WORKSPACE_NAVIGATION.map((section) => ({
    key: section.key,
    titleKey: section.titleKey,
    badge:
      section.key === "audit-workspace"
        ? () =>
            isCrawling
              ? `${Math.round(crawlProgress)}%`
              : isLoading || isBatchRunning
                ? t("sidebar.running")
                : currentAudit
                  ? currentAudit.health_score
                  : crawlRunsCount > 0
                    ? crawlRunsCount
                    : null
        : undefined,
    items: section.items.map((definition: WorkspaceNavItemDefinition) => ({
      id: definition.tab,
      keywords: definition.keywords,
      labelKey: definition.labelKey,
      icon: definition.icon,
      badge:
        definition.key === "overview"
          ? () => (currentAudit ? currentAudit.health_score : null)
          : definition.key === "saved-keywords"
            ? () => (savedKeywordsCount > 0 ? savedKeywordsCount : null)
            : definition.key === "rank-tracking"
              ? () => (trackedRanksCount > 0 ? trackedRanksCount : null)
              : undefined,
      action:
        definition.action === "semantic-map"
          ? () => {
              writeEphemeralStorage("seomi_open_crawl_map_v1", "1");
              setActiveTab("site-audit");
              window.dispatchEvent(new Event("seomi:open-crawl-map"));
            }
          : definition.action === "ai-assistant"
            ? () => openModal("ai")
            : definition.action === "ai-connection"
              ? () => openModal("subscription")
              : definition.action === "history"
                ? () => openModal("history")
                : definition.action === "settings"
                  ? () => openModal("settings")
                  : undefined,
    })),
  }));

  // The compact sidebar hides the search field. Do not leave the user trapped
  // in a filtered menu while it is hidden; keep the query in memory so the
  // expanded sidebar can restore it without losing the per-project preference.
  const normalizedNavQuery = sidebarCollapsed
    ? ""
    : navQuery.trim().toLocaleLowerCase();
  const visibleNavSections = navSections
    .map((section) => {
      if (!normalizedNavQuery) return section;
      const sectionMatches = t(section.titleKey)
        .toLocaleLowerCase()
        .includes(normalizedNavQuery);
      const items = sectionMatches
        ? section.items
        : section.items.filter((item) =>
            `${t(item.labelKey)} ${item.keywords}`
              .toLocaleLowerCase()
              .includes(normalizedNavQuery),
          );
      return items.length > 0 ? { ...section, items } : null;
    })
    .filter((section): section is NavSection => section !== null);

  // DataForSEO has a direct workspace entry in Google & Data even though it
  // remains an audit result tab. Keep the active section aligned with the
  // visible shortcut instead of highlighting the broader audit group.
  const activeSectionKey =
    pageAuditTabIds.includes(activeTab) && activeTab !== "dataforseo"
      ? "audit-workspace"
      : navSections.find((section) =>
          section.items.some((item) => item.id === activeTab),
        )?.key;

  useEffect(() => {
    if (lastNavigatedTab.current === activeTab) return;
    lastNavigatedTab.current = activeTab;
    if (
      sidebarCollapsed ||
      typeof document === "undefined" ||
      !activeSectionKey
    )
      return;
    if (collapsedSections[activeSectionKey]) {
      // A navigation jump can land inside a group the user had collapsed.
      // Reveal it so the selected destination remains visible and actionable.
      toggleSidebarSection(activeProjectId, activeSectionKey);
    }
    // The sidebar is independently scrollable from the report. Keep the
    // selected workflow discoverable after keyboard/command-palette jumps,
    // even when it sits below the fold in a long menu.
    const frame = window.requestAnimationFrame(() => {
      const activeItem = Array.from(
        document.querySelectorAll<HTMLElement>("[data-sidebar-tab]"),
      ).find((element) => element.dataset.sidebarTab === activeTab);
      activeItem?.scrollIntoView?.({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeProjectId,
    activeSectionKey,
    activeTab,
    collapsedSections,
    sidebarCollapsed,
    toggleSidebarSection,
  ]);

  return (
    <aside
      className={`h-full min-h-0 bg-slate-900/80 border-r border-slate-800/80 flex flex-col justify-between transition-all duration-200 pb-4 shrink-0 ${sidebarCollapsed ? "w-16" : "w-64"}`}
      aria-label={t("sidebar.navigation")}
    >
      <nav
        className="py-2 px-2 overflow-y-auto space-y-2 flex-1"
        aria-label={t("sidebar.modules")}
      >
        <button
          type="button"
          onClick={() => openModal("create-project")}
          className={`flex w-full items-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-2 text-xs font-semibold text-emerald-300 transition hover:border-emerald-400/55 hover:bg-emerald-500/15 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${sidebarCollapsed ? "justify-center" : "gap-2"}`}
          title={t("sidebar.newProject")}
          aria-label={t("sidebar.newProject")}
        >
          <FolderPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
          {!sidebarCollapsed && <span>{t("sidebar.newProject")}</span>}
        </button>
        <button
          type="button"
          onClick={() => {
            const selector = document.getElementById(
              "workspace-project-switcher",
            ) as HTMLSelectElement | null;
            selector?.focus();
            selector?.click();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              const selector = document.getElementById(
                "workspace-project-switcher",
              ) as HTMLSelectElement | null;
              selector?.focus();
              selector?.click();
            }
          }}
          className={`w-full rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] text-left transition hover:border-emerald-400/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${sidebarCollapsed ? "p-2" : "px-2.5 py-2"}`}
          aria-label={t("projects.activeProject")}
          title={
            activeProject
              ? `${activeProject.name}${activeProject.rootUrl ? ` · ${activeProject.rootUrl}` : ""}`
              : undefined
          }
        >
          <div
            className={`flex items-center ${sidebarCollapsed ? "justify-center" : "gap-2"}`}
          >
            <FolderKanban
              className="h-4 w-4 shrink-0 text-emerald-300"
              aria-hidden="true"
            />
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-emerald-300/80">
                  {t("projects.activeProject")}
                </p>
                <p className="truncate text-[11px] font-semibold text-slate-200">
                  {activeProject?.name || "—"}
                </p>
                {activeProject?.rootUrl && (
                  <p className="truncate text-[9px] text-slate-500">
                    {activeProject.rootUrl}
                  </p>
                )}
              </div>
            )}
          </div>
          {!sidebarCollapsed && (
            <span className="mt-1 block truncate text-left text-[9px] text-slate-500">
              {t("projects.changeProject")}
            </span>
          )}
        </button>
        {!sidebarCollapsed && (
          <div className="sticky top-0 z-10 bg-slate-900/95 pb-1 backdrop-blur-sm">
            <label className="sr-only" htmlFor="workspace-nav-search">
              {t("sidebar.menuSearch")}
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                aria-hidden="true"
              />
              <input
                id="workspace-nav-search"
                value={navQuery}
                onChange={(event) => updateNavQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") updateNavQuery("");
                }}
                placeholder={t("sidebar.menuSearchPlaceholder")}
                autoComplete="off"
                className="h-8 w-full rounded-lg border border-slate-800 bg-slate-950/70 pl-8 pr-8 text-[11px] text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30"
              />
              {navQuery && (
                <button
                  type="button"
                  onClick={() => updateNavQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  aria-label={t("sidebar.clearMenuSearch")}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        )}
        {visibleNavSections.map((section) => {
          // Search results must remain actionable even when the user had
          // previously collapsed that section for the normal compact view.
          const isSectionCollapsed =
            Boolean(collapsedSections[section.key]) && !normalizedNavQuery;
          const isSectionActive = activeSectionKey === section.key;
          const headingId = sectionId(section.key);
          const sectionBadge = section.badge?.();

          return (
            <section
              key={section.key}
              className={`space-y-1 rounded-xl ${isSectionActive && !sidebarCollapsed ? "bg-slate-800/20" : ""}`}
            >
              {!sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() =>
                    toggleSidebarSection(activeProjectId, section.key)
                  }
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${isSectionActive ? "text-emerald-300" : "text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"}`}
                  aria-expanded={!isSectionCollapsed}
                  aria-controls={headingId}
                >
                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                    {isSectionActive && (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                        aria-hidden="true"
                      />
                    )}
                    {t(section.titleKey)}
                  </span>
                  <span className="ml-2 flex shrink-0 items-center gap-1.5">
                    {sectionBadge !== null && sectionBadge !== undefined && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-mono ${isSectionActive ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-500"}`}
                      >
                        {sectionBadge}
                      </span>
                    )}
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${isSectionCollapsed ? "-rotate-90" : "rotate-0"}`}
                      aria-hidden="true"
                    />
                  </span>
                </button>
              )}

              <div
                id={headingId}
                className="space-y-0.5"
                hidden={!sidebarCollapsed && isSectionCollapsed}
              >
                {section.items.map((item, itemIndex) => {
                  const Icon = item.icon;
                  const isActive = Boolean(
                    item.id && activeTab === item.id && !item.action,
                  );
                  const badgeValue = item.badge?.();

                  return (
                    <button
                      key={`${item.id || item.labelKey}-${itemIndex}`}
                      type="button"
                      onClick={() => {
                        if (item.action) {
                          item.action();
                        } else if (item.id) {
                          setActiveTab(item.id);
                        }
                      }}
                      aria-current={isActive ? "page" : undefined}
                      data-sidebar-tab={item.id}
                      className={`w-full flex items-center rounded-lg px-2.5 py-2 text-xs font-medium transition-all group relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${isActive ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent"}`}
                      title={sidebarCollapsed ? t(item.labelKey) : undefined}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 transition ${isActive ? "text-emerald-400" : "text-slate-400 group-hover:text-slate-200"}`}
                        aria-hidden="true"
                      />
                      {!sidebarCollapsed && (
                        <span className="ml-2.5 truncate text-left flex-1">
                          {t(item.labelKey)}
                        </span>
                      )}
                      {!sidebarCollapsed &&
                        badgeValue !== null &&
                        badgeValue !== undefined && (
                          <span
                            className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-mono shrink-0 ${isActive ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-400"}`}
                          >
                            {badgeValue}
                          </span>
                        )}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {visibleNavSections.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-[11px] leading-5 text-slate-500">
            {t("sidebar.noMenuResults", { query: navQuery })}
          </p>
        )}
        {!sidebarCollapsed &&
          navQuery.trim() &&
          visibleNavSections.length > 0 && (
            <p className="sr-only" role="status" aria-live="polite">
              {t("sidebar.menuResultsCount", {
                count: visibleNavSections.length,
              })}
            </p>
          )}
      </nav>

      <div className="p-2 border-t border-slate-800/80 space-y-2 shrink-0">
        {!sidebarCollapsed && (
          <div
            onClick={() => openModal("subscription")}
            className="p-2.5 rounded-xl bg-gradient-to-r from-slate-900 to-slate-950 border border-slate-800 hover:border-emerald-500/40 transition cursor-pointer group"
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openModal("subscription");
              }
            }}
            aria-label={t("sidebar.aiConnection")}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles
                  className="w-3 h-3 text-emerald-400"
                  aria-hidden="true"
                />
                {isConnected
                  ? `${providerName} ${t("sidebar.connected")}`
                  : t("sidebar.aiConnection")}
              </span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${isConnected ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}
              >
                {isConnected ? t("sidebar.ready") : t("sidebar.connect")}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 leading-tight">
              {isConnected
                ? t("sidebar.aiConnectionReady")
                : t("sidebar.aiConnectionPrompt")}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          title={
            sidebarCollapsed
              ? t("sidebar.expandMenu")
              : t("sidebar.collapseMenu")
          }
          aria-label={
            sidebarCollapsed
              ? t("sidebar.expandMenu")
              : t("sidebar.collapseMenu")
          }
          aria-pressed={sidebarCollapsed}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          ) : (
            <div className="flex items-center space-x-1.5">
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              <span className="text-[11px] text-slate-400">
                {t("sidebar.collapseMenu")}
              </span>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
};
