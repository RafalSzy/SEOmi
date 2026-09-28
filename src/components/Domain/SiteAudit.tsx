import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Layers,
  Play,
  ArrowUp,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronRight,
  Download,
  Map,
} from "lucide-react";
import { useToolsStore } from "@/stores/toolsStore";
import { format } from "date-fns";
import { compareCrawlResults } from "@/services/crawlDiff";
import { TrendChart } from "@/components/Charts/TrendChart";
import { CrawlResultsTabs } from "@/components/Domain/CrawlResultsTabs";
import { localizeCrawlIssue } from "@/services/crawlIssueLocalization";
import {
  downloadCrawlImagesCsv,
  downloadCrawlIssuesCsv,
  downloadCrawlJson,
  downloadCrawlLinksCsv,
  downloadCrawlPagesCsv,
  downloadCrawlPdf,
  downloadCrawlResourcesCsv,
} from "@/services/export";
import { importUrlsFromCsv } from "@/services/csvUrls";
import {
  crawlErrorKinds,
  crawlErrorLabel,
  filterCrawlErrors,
} from "@/services/crawlErrors";
import { invokeTauriCommand, isTauriEnvironment } from "@/services/tauri";
import type {
  CrawlEnvironment,
  CrawlFilterValidationResult,
  CustomSearchDefinition,
} from "@/types";
import { ScheduledAuditsPanel } from "@/components/Domain/ScheduledAuditsPanel";
import { useProjectStore } from "@/stores/projectStore";
import { useUIStore } from "@/stores/uiStore";
import { notifyCrawlCompleted } from "@/services/desktopNotifications";
import {
  readEphemeralStorage,
  readJsonStorage,
  readStorage,
  removeEphemeralStorage,
  writeJsonStorage,
  writeStorage,
} from "@/services/storage";
import {
  DEFAULT_CRAWL_REPORT_TEMPLATE,
  REPORT_TEMPLATE_SECTIONS,
  deleteCrawlReportTemplate,
  loadCrawlReportTemplates,
  loadSelectedCrawlReportTemplateId,
  saveCrawlReportTemplate,
  saveSelectedCrawlReportTemplateId,
  type CrawlReportTemplate,
  type ReportTemplateSection,
} from "@/services/reportTemplates";

const formatCrawlElapsed = (elapsedMs: number | undefined): string => {
  const totalSeconds = Math.max(0, Math.floor((elapsedMs ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const focusCrawlStartForm = (): void => {
  if (typeof window === "undefined") return;
  const focus = () => {
    const form = document.getElementById("site-audit-crawl-form");
    form?.scrollIntoView?.({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
        ? "auto"
        : "smooth",
      block: "start",
    });
    document.getElementById("site-audit-start-url")?.focus();
  };
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(focus);
  } else {
    focus();
  }
};

export const SiteAudit: React.FC = () => {
  const { t } = useTranslation();
  const desktopAvailable = isTauriEnvironment();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const crawlUrl = useToolsStore((s) => s.crawlUrl);
  const crawlLimit = useToolsStore((s) => s.crawlLimit);
  const crawlResult = useToolsStore((s) => s.crawlResult);
  const crawlRuns = useToolsStore((s) => s.crawlRuns);
  const isCrawling = useToolsStore((s) => s.isCrawling);
  const isCrawlPaused = useToolsStore((s) => s.isCrawlPaused);
  const interruptedCrawl = useToolsStore((s) => s.interruptedCrawl);
  const crawlProgress = useToolsStore((s) => s.crawlProgress);
  const crawlProgressDetail = useToolsStore((s) => s.crawlProgressDetail);
  const crawlConfig = useToolsStore((s) => s.crawlConfig);
  const crawlRequestProfiles = useToolsStore((s) => s.crawlRequestProfiles);
  const isSavingCrawlRequestProfile = useToolsStore(
    (s) => s.isSavingCrawlRequestProfile,
  );
  const crawlError = useToolsStore((s) => s.crawlError);
  const crawlPersistenceError = useToolsStore((s) => s.crawlPersistenceError);
  const crawlPersistenceNotice = useToolsStore((s) => s.crawlPersistenceNotice);
  const crawlPersistenceCompacted = useToolsStore(
    (s) => s.crawlPersistenceCompacted,
  );
  const isRetryingCrawlPersistence = useToolsStore(
    (s) => s.isRetryingCrawlPersistence,
  );
  const selectedCrawlRunId = useToolsStore((s) => s.selectedCrawlRunId);
  const setCrawlUrl = useToolsStore((s) => s.setCrawlUrl);
  const setCrawlLimit = useToolsStore((s) => s.setCrawlLimit);
  const setCrawlConfig = useToolsStore((s) => s.setCrawlConfig);
  const saveCrawlRequestProfile = useToolsStore(
    (s) => s.saveCrawlRequestProfile,
  );
  const deleteCrawlRequestProfile = useToolsStore(
    (s) => s.deleteCrawlRequestProfile,
  );
  const startSiteCrawl = useToolsStore((s) => s.startSiteCrawl);
  const cancelSiteCrawl = useToolsStore((s) => s.cancelSiteCrawl);
  const pauseSiteCrawl = useToolsStore((s) => s.pauseSiteCrawl);
  const resumeSiteCrawl = useToolsStore((s) => s.resumeSiteCrawl);
  const resumeInterruptedCrawl = useToolsStore((s) => s.resumeInterruptedCrawl);
  const discardInterruptedCrawl = useToolsStore(
    (s) => s.discardInterruptedCrawl,
  );
  const retryCrawlPersistence = useToolsStore((s) => s.retryCrawlPersistence);
  const selectCrawlRun = useToolsStore((s) => s.selectCrawlRun);
  const deleteCrawlRun = useToolsStore((s) => s.deleteCrawlRun);

  const [inputUrl, setInputUrl] = useState(crawlUrl);
  const [selectedLimit, setSelectedLimit] = useState(crawlLimit);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [severityFilter, setSeverityFilter] = useState<
    "all" | "Critical" | "Warning" | "Info"
  >("all");
  const [errorKindFilter, setErrorKindFilter] = useState("all");
  const [comparisonRunId, setComparisonRunId] = useState("");
  const [seedImportRejected, setSeedImportRejected] = useState<string[]>([]);
  const [filterValidation, setFilterValidation] =
    useState<CrawlFilterValidationResult | null>(null);
  const [isCheckingFilters, setIsCheckingFilters] = useState(false);
  const [filterValidationError, setFilterValidationError] = useState<
    string | null
  >(null);
  const [requestProfileName, setRequestProfileName] = useState("");
  const [requestProfileHeaders, setRequestProfileHeaders] = useState("");
  const [requestProfileCookie, setRequestProfileCookie] = useState("");
  const [requestProfileProxyUrl, setRequestProfileProxyUrl] = useState("");
  const [requestProfileStatus, setRequestProfileStatus] = useState<
    string | null
  >(null);
  const [requestProfileStatusIsError, setRequestProfileStatusIsError] =
    useState(false);
  const [crawlPdfError, setCrawlPdfError] = useState<string | null>(null);
  const [mapNavigationRequest, setMapNavigationRequest] = useState(0);
  const [mapRequiresCrawl, setMapRequiresCrawl] = useState(false);
  const [comparisonByPath, setComparisonByPath] = useState(false);
  const [environmentUrls, setEnvironmentUrls] = useState<{
    staging: string;
    production: string;
  }>({ staging: "", production: "" });
  const [isEnvironmentComparisonRunning, setIsEnvironmentComparisonRunning] =
    useState(false);
  const [environmentComparisonError, setEnvironmentComparisonError] = useState<
    string | null
  >(null);
  const [reportTemplates, setReportTemplates] = useState<CrawlReportTemplate[]>(
    [DEFAULT_CRAWL_REPORT_TEMPLATE],
  );
  const [selectedReportTemplateId, setSelectedReportTemplateId] = useState(
    DEFAULT_CRAWL_REPORT_TEMPLATE.id,
  );
  const [reportTemplateName, setReportTemplateName] = useState("");
  const [reportTemplateSections, setReportTemplateSections] = useState<
    ReportTemplateSection[]
  >(DEFAULT_CRAWL_REPORT_TEMPLATE.sections);
  const [reportTemplateError, setReportTemplateError] = useState<string | null>(
    null,
  );
  const selectedRequestProfile = crawlRequestProfiles.find(
    (profile) => profile.id === crawlConfig.requestProfileId,
  );
  const renderedProfileHasTransportOverrides = Boolean(
    selectedRequestProfile?.hasHeaders || selectedRequestProfile?.hasProxy,
  );

  const selectedReportTemplate =
    reportTemplates.find(
      (template) => template.id === selectedReportTemplateId,
    ) || DEFAULT_CRAWL_REPORT_TEMPLATE;

  // The crawl store is project-scoped, while these controls are intentionally
  // local so typing and transient validation do not persist every keystroke.
  // Reconcile them whenever hydration changes the active project's snapshot;
  // otherwise switching projects could leave the previous project's URL or
  // page limit visible in the new workspace.
  useEffect(() => {
    setInputUrl(crawlUrl);
    setSelectedLimit(crawlLimit);
  }, [activeProjectId, crawlLimit, crawlUrl]);

  useEffect(() => {
    setExpandedRows({});
    setSeverityFilter("all");
    setErrorKindFilter("all");
    setComparisonRunId("");
    setSeedImportRejected([]);
    setFilterValidation(null);
    setFilterValidationError(null);
    // Request-profile drafts contain credentials and transport overrides. They
    // are intentionally transient and must never leak into another project
    // when the workspace changes.
    setRequestProfileName("");
    setRequestProfileHeaders("");
    setRequestProfileCookie("");
    setRequestProfileProxyUrl("");
    setRequestProfileStatus(null);
    setRequestProfileStatusIsError(false);
    setCrawlPdfError(null);
    setMapRequiresCrawl(false);
    setMapNavigationRequest(0);
    setEnvironmentComparisonError(null);
    setIsEnvironmentComparisonRunning(false);
  }, [activeProjectId]);

  useEffect(() => {
    const templates = loadCrawlReportTemplates(activeProjectId);
    const selectedId = loadSelectedCrawlReportTemplateId(activeProjectId);
    const selected =
      templates.find((template) => template.id === selectedId) ||
      templates[0] ||
      DEFAULT_CRAWL_REPORT_TEMPLATE;
    setReportTemplates(templates);
    setSelectedReportTemplateId(selected.id);
    setReportTemplateSections(selected.sections);
    setReportTemplateName(selected.builtIn ? "" : selected.name);
    setReportTemplateError(null);
  }, [activeProjectId]);

  const selectReportTemplate = (templateId: string) => {
    const template =
      reportTemplates.find((candidate) => candidate.id === templateId) ||
      DEFAULT_CRAWL_REPORT_TEMPLATE;
    setSelectedReportTemplateId(template.id);
    setReportTemplateSections(template.sections);
    setReportTemplateName(template.builtIn ? "" : template.name);
    setReportTemplateError(null);
    if (activeProjectId)
      saveSelectedCrawlReportTemplateId(activeProjectId, template.id);
  };

  const toggleReportTemplateSection = (section: ReportTemplateSection) => {
    setReportTemplateSections((current) =>
      current.includes(section)
        ? current.filter((item) => item !== section)
        : [...current, section],
    );
  };

  const createReportTemplate = () => {
    if (!activeProjectId) {
      setReportTemplateError(t("siteAudit.templateProjectRequired"));
      return;
    }
    try {
      const template = saveCrawlReportTemplate(activeProjectId, {
        name: reportTemplateName,
        sections: reportTemplateSections,
      });
      const templates = loadCrawlReportTemplates(activeProjectId);
      setReportTemplates(templates);
      setSelectedReportTemplateId(template.id);
      saveSelectedCrawlReportTemplateId(activeProjectId, template.id);
      setReportTemplateName(template.name);
      setReportTemplateError(null);
    } catch (error) {
      setReportTemplateError(
        error instanceof Error
          ? error.message
          : t("siteAudit.templateSaveError"),
      );
    }
  };

  const removeReportTemplate = () => {
    if (!activeProjectId || selectedReportTemplate.builtIn) return;
    deleteCrawlReportTemplate(activeProjectId, selectedReportTemplate.id);
    const templates = loadCrawlReportTemplates(activeProjectId);
    setReportTemplates(templates);
    selectReportTemplate(templates[0]?.id || DEFAULT_CRAWL_REPORT_TEMPLATE.id);
  };

  useEffect(() => {
    if (!activeProjectId) {
      setComparisonByPath(false);
      return;
    }
    setComparisonByPath(
      readStorage(`seomi_project_${activeProjectId}_crawl_compare_path_v1`) ===
        "true",
    );
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setEnvironmentUrls({ staging: "", production: "" });
      return;
    }
    const parsed = readJsonStorage<unknown>(
      `seomi_project_${activeProjectId}_crawl_environments_v1`,
      null,
    ) as { staging?: unknown; production?: unknown } | null;
    setEnvironmentUrls({
      staging: typeof parsed?.staging === "string" ? parsed.staging : "",
      production:
        typeof parsed?.production === "string" ? parsed.production : "",
    });
  }, [activeProjectId]);

  // The sidebar can open the semantic map directly even though the map lives
  // inside the crawl results workspace. Keep the request in session storage
  // until this view has a crawl result mounted, then let CrawlResultsTabs
  // perform the reliable two-frame scroll to the map panel.
  useEffect(() => {
    const requested = readEphemeralStorage("seomi_open_crawl_map_v1") === "1";
    if (!requested) return;
    removeEphemeralStorage("seomi_open_crawl_map_v1");
    if (crawlResult) {
      setMapNavigationRequest((value) => value + 1);
      return;
    }
    setMapRequiresCrawl(true);
    focusCrawlStartForm();
  }, [crawlResult]);

  useEffect(() => {
    const openMap = () => {
      if (useToolsStore.getState().crawlResult) {
        setMapNavigationRequest((value) => value + 1);
        return;
      }
      setMapRequiresCrawl(true);
      focusCrawlStartForm();
    };
    window.addEventListener("seomi:open-crawl-map", openMap);
    return () => window.removeEventListener("seomi:open-crawl-map", openMap);
  }, []);

  const updateComparisonByPath = (value: boolean) => {
    setComparisonByPath(value);
    if (!activeProjectId) return;
    writeStorage(
      `seomi_project_${activeProjectId}_crawl_compare_path_v1`,
      String(value),
    );
  };

  const updateEnvironmentUrl = (
    environment: Exclude<CrawlEnvironment, "default">,
    value: string,
  ) => {
    const next = { ...environmentUrls, [environment]: value };
    setEnvironmentUrls(next);
    if (!activeProjectId) return;
    writeJsonStorage(
      `seomi_project_${activeProjectId}_crawl_environments_v1`,
      next,
    );
  };

  const runEnvironmentComparison = async () => {
    if (!desktopAvailable) {
      setEnvironmentComparisonError(t("runtimeErrors.tauri.desktopOnly"));
      return;
    }
    const stagingUrl = environmentUrls.staging.trim();
    const productionUrl = environmentUrls.production.trim();
    if (
      !stagingUrl ||
      !productionUrl ||
      isEnvironmentComparisonRunning ||
      isCrawling
    )
      return;
    setIsEnvironmentComparisonRunning(true);
    setEnvironmentComparisonError(null);
    setComparisonByPath(true);
    try {
      const existingRunIds = new Set(
        useToolsStore.getState().crawlRuns.map((run) => run.id),
      );
      const stagingResult = await startSiteCrawl(
        stagingUrl,
        selectedLimit,
        undefined,
        "staging",
        false,
      );
      if (!stagingResult)
        throw new Error(
          useToolsStore.getState().crawlError || t("siteAudit.stagingNoResult"),
        );
      const stagingRun = useToolsStore
        .getState()
        .crawlRuns.find(
          (run) => !existingRunIds.has(run.id) && run.environment === "staging",
        );
      if (!stagingRun) throw new Error(t("siteAudit.stagingRunSaveError"));

      const existingProductionRunIds = new Set(
        useToolsStore.getState().crawlRuns.map((run) => run.id),
      );
      const productionResult = await startSiteCrawl(
        productionUrl,
        selectedLimit,
        undefined,
        "production",
        false,
      );
      if (!productionResult)
        throw new Error(
          useToolsStore.getState().crawlError ||
            t("siteAudit.productionNoResult"),
        );
      const productionRun = useToolsStore
        .getState()
        .crawlRuns.find(
          (run) =>
            !existingProductionRunIds.has(run.id) &&
            run.environment === "production" &&
            run.startUrl === productionUrl,
        );
      if (!productionRun)
        throw new Error(t("siteAudit.productionRunSaveError"));
      setComparisonRunId(stagingRun.id);
      if (activeProjectId)
        void notifyCrawlCompleted(
          activeProjectId,
          productionResult,
          stagingResult.health_score,
        );
    } catch (error) {
      setEnvironmentComparisonError(
        error instanceof Error
          ? error.message
          : t("siteAudit.environmentCompareError"),
      );
    } finally {
      setIsEnvironmentComparisonRunning(false);
    }
  };

  const scrollToResults = (behavior: ScrollBehavior = "smooth") => {
    const results = document.getElementById("crawl-results");
    results?.scrollIntoView({ behavior, block: "start" });
    if (results instanceof HTMLElement) {
      results.focus({ preventScroll: true });
    }
  };

  const filterPreviewUrls = useMemo(
    () =>
      Array.from(
        new Set(
          [
            inputUrl.trim(),
            ...(crawlConfig.seedUrls || []),
            ...(crawlResult?.sitemap_urls || []),
            ...(crawlResult?.pages.map((page) => page.final_url || page.url) ||
              []),
          ].filter(Boolean),
        ),
      ).slice(0, 500),
    [crawlConfig.seedUrls, crawlResult, inputUrl],
  );

  const importSeedUrls = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    const imported = importUrlsFromCsv(content);
    setSeedImportRejected(imported.rejected);
    setCrawlConfig({
      seedUrls: imported.urls.slice(0, 10_000),
      listMode: true,
    });
  };

  const validateFilters =
    async (): Promise<CrawlFilterValidationResult | null> => {
      setIsCheckingFilters(true);
      setFilterValidationError(null);
      try {
        const result = await invokeTauriCommand<CrawlFilterValidationResult>(
          "validate_crawl_filters",
          {
            includePatterns: crawlConfig.includePatterns,
            excludePatterns: crawlConfig.excludePatterns,
            previewUrls: filterPreviewUrls,
          },
        );
        setFilterValidation(result);
        return result;
      } catch (error) {
        setFilterValidation(null);
        setFilterValidationError(
          error instanceof Error
            ? error.message
            : t("siteAudit.filterCheckError"),
        );
        return null;
      } finally {
        setIsCheckingFilters(false);
      }
    };

  const setFilterPatterns = (
    field: "includePatterns" | "excludePatterns",
    value: string,
  ) => {
    setFilterValidation(null);
    setFilterValidationError(null);
    setCrawlConfig({
      [field]: value
        .split("\n")
        .map((pattern) => pattern.trim())
        .filter(Boolean),
    });
  };

  const setQueryParameterNames = (
    field: "allowedQueryParameters" | "deniedQueryParameters",
    value: string,
  ) => {
    setCrawlConfig({
      [field]: value
        .split(/[\n,]/)
        .map((name) => name.trim())
        .filter(Boolean),
    });
  };

  const setAllowedHosts = (value: string) => {
    setCrawlConfig({
      allowedHosts: value
        .split(/[\n,]/)
        .map((host) => host.trim())
        .filter(Boolean),
    });
  };

  const customSearches = crawlConfig.customSearches || [];
  const updateCustomSearch = (
    id: string,
    patch: Partial<CustomSearchDefinition>,
  ) => {
    setCrawlConfig({
      customSearches: customSearches.map((search) =>
        search.id === id ? { ...search, ...patch } : search,
      ),
    });
  };
  const addCustomSearch = () => {
    if (customSearches.length >= 10) return;
    const id =
      globalThis.crypto?.randomUUID?.() || `custom-search-${Date.now()}`;
    setCrawlConfig({
      customSearches: [
        ...customSearches,
        {
          id,
          name: t("crawl.customSearch.defaultName", {
            count: customSearches.length + 1,
          }),
          selectorType: "css",
          query: "h1",
          resultType: "text",
        },
      ],
    });
  };

  const saveRequestProfile = async () => {
    const headers = requestProfileHeaders
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const separator = line.indexOf(":");
        if (separator < 1)
          throw new Error(t("siteAudit.headerFormatError", { line }));
        return {
          name: line.slice(0, separator).trim(),
          value: line.slice(separator + 1).trim(),
        };
      });
    setRequestProfileStatus(null);
    setRequestProfileStatusIsError(false);
    try {
      await saveCrawlRequestProfile({
        name: requestProfileName,
        userAgent: crawlConfig.userAgent || "",
        headers,
        cookie: requestProfileCookie,
        proxyUrl: requestProfileProxyUrl,
      });
      setRequestProfileName("");
      setRequestProfileHeaders("");
      setRequestProfileCookie("");
      setRequestProfileProxyUrl("");
      setRequestProfileStatus(t("siteAudit.profileSaved"));
      setRequestProfileStatusIsError(false);
    } catch (error) {
      setRequestProfileStatusIsError(true);
      setRequestProfileStatus(
        error instanceof Error
          ? error.message
          : t("siteAudit.profileSaveError"),
      );
    }
  };

  const exportCrawlPdf = async () => {
    if (!selectedRun) return;
    setCrawlPdfError(null);
    try {
      await downloadCrawlPdf(selectedRun, selectedReportTemplate);
    } catch (error) {
      setCrawlPdfError(
        error instanceof Error ? error.message : t("siteAudit.pdfError"),
      );
    }
  };

  const selectRequestProfile = (id: string) => {
    const profile = crawlRequestProfiles.find(
      (candidate) => candidate.id === id,
    );
    setCrawlConfig({
      requestProfileId: id || undefined,
      userAgent: profile?.userAgent || crawlConfig.userAgent,
    });
    setRequestProfileStatusIsError(false);
    setRequestProfileStatus(
      profile ? t("siteAudit.profileSelected", { name: profile.name }) : null,
    );
  };

  const removeRequestProfile = async () => {
    if (!crawlConfig.requestProfileId) return;
    try {
      await deleteCrawlRequestProfile(crawlConfig.requestProfileId);
      setRequestProfileStatusIsError(false);
      setRequestProfileStatus(t("siteAudit.profileRemoved"));
    } catch (error) {
      setRequestProfileStatusIsError(true);
      setRequestProfileStatus(
        error instanceof Error
          ? error.message
          : t("siteAudit.profileRemoveError"),
      );
    }
  };

  const handleStartCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!desktopAvailable) return;
    if (!inputUrl.trim()) return;
    const validation = await validateFilters();
    if (!validation?.valid) return;
    setMapRequiresCrawl(false);
    setCrawlUrl(inputUrl.trim());
    setCrawlLimit(selectedLimit);
    void startSiteCrawl(inputUrl.trim(), selectedLimit);
  };

  const toggleRow = (url: string) => {
    setExpandedRows((prev) => ({ ...prev, [url]: !prev[url] }));
  };

  const crawlErrorRecords = [
    ...(crawlResult?.pages || []),
    ...(crawlResult?.resources || []),
  ];
  const availableErrorKinds = crawlErrorKinds(crawlErrorRecords);
  const activeErrorKindFilter = availableErrorKinds.includes(errorKindFilter)
    ? errorKindFilter
    : "all";
  const filteredPages = filterCrawlErrors(
    crawlResult?.pages.filter(
      (page) =>
        severityFilter === "all" ||
        page.issues.some((issue) => issue.severity === severityFilter),
    ) || [],
    activeErrorKindFilter,
  );
  const filteredResources = filterCrawlErrors(
    crawlResult?.resources || [],
    activeErrorKindFilter,
  );
  const selectedRun = crawlRuns.find((run) => run.id === selectedCrawlRunId);
  const comparisonRun = crawlRuns.find((run) => run.id === comparisonRunId);
  const comparison =
    crawlResult && comparisonRun && comparisonRun.result !== crawlResult
      ? compareCrawlResults(crawlResult, comparisonRun.result, {
          matchByPath: comparisonByPath,
        })
      : null;
  const chronologicalRuns = [...crawlRuns].reverse();
  const historyValue = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const sitemapOnlyUrls = crawlResult
    ? crawlResult.sitemap_urls.filter(
        (url) =>
          !crawlResult.pages.some(
            (page) => page.url === url || page.final_url === url,
          ),
      )
    : [];
  const crawlOnlyUrls = crawlResult
    ? crawlResult.pages
        .map((page) => page.url)
        .filter((url) => !crawlResult.sitemap_urls.includes(url))
    : [];
  const historyMetrics = [
    {
      label: t("siteAudit.processedUrls"),
      values: chronologicalRuns.map((run) =>
        historyValue(run.result.pages_crawled),
      ),
      colour: "text-emerald-300",
    },
    {
      label: t("siteAudit.criticalErrors"),
      values: chronologicalRuns.map((run) =>
        historyValue(run.result.critical_count),
      ),
      colour: "text-rose-300",
    },
    {
      label: t("siteAudit.warnings"),
      values: chronologicalRuns.map((run) =>
        historyValue(run.result.warning_count),
      ),
      colour: "text-amber-300",
    },
    {
      label: t("siteAudit.statuses2xx"),
      values: chronologicalRuns.map((run) =>
        historyValue(
          run.result.pages.filter(
            (page) => page.http_status >= 200 && page.http_status < 300,
          ).length,
        ),
      ),
      colour: "text-sky-300",
    },
    {
      label: t("siteAudit.indexableResponses"),
      values: chronologicalRuns.map((run) =>
        historyValue(
          run.result.pages.filter(
            (page) =>
              page.indexability_status === "Eligible from this response only",
          ).length,
        ),
      ),
      colour: "text-violet-300",
    },
    {
      label: t("siteAudit.contentWords"),
      values: chronologicalRuns.map((run) =>
        historyValue(
          run.result.pages.reduce((total, page) => total + page.word_count, 0),
        ),
      ),
      colour: "text-cyan-300",
    },
  ];
  const reportTemplateSectionLabel = (section: ReportTemplateSection): string =>
    t(`siteAudit.reportSections.${section}`);
  const reportTemplateSectionLabels = Object.fromEntries(
    REPORT_TEMPLATE_SECTIONS.map((section) => [
      section,
      reportTemplateSectionLabel(section),
    ]),
  ) as Record<ReportTemplateSection, string>;
  const crawlEnvironmentLabel = (environment?: CrawlEnvironment) =>
    environment === "staging"
      ? t("siteAudit.environmentStaging")
      : environment === "production"
        ? t("siteAudit.environmentProduction")
        : t("siteAudit.environmentStandard");

  return (
    <div
      className={`mx-auto max-w-7xl space-y-8 px-4 py-8 ${crawlResult ? "pb-28 sm:pb-24" : ""}`}
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              {t("siteAudit.headerBadge")}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {t("siteAudit.headerCrawler")}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white mt-1">
            {t("siteAudit.title")}
          </h1>
          <p className="text-sm text-slate-400">{t("siteAudit.description")}</p>
        </div>
        {crawlResult && (
          <button
            type="button"
            onClick={() => setMapNavigationRequest((request) => request + 1)}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-emerald-400/35 bg-emerald-400/10 px-3 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-300/70 hover:bg-emerald-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            aria-label={t("siteAudit.openMapAria", {
              count: crawlResult.pages_crawled,
            })}
          >
            <Map className="h-4 w-4" />
            <span>{t("siteAudit.openMap")}</span>
            <span className="rounded bg-slate-950/50 px-1.5 py-0.5 font-mono text-[11px] text-emerald-200">
              {crawlResult.pages_crawled}
            </span>
          </button>
        )}
      </div>

      {crawlResult && (
        <nav
          aria-label={t("siteAudit.resultsNavAria")}
          className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700/90 bg-slate-950/95 px-3 py-2 shadow-lg shadow-black/20 backdrop-blur supports-[backdrop-filter]:bg-slate-950/90"
        >
          <span className="text-[11px] font-medium text-slate-400">
            {t("siteAudit.resultsCount", { count: crawlResult.pages_crawled })}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <a
              href="#crawl-results"
              className="inline-flex h-8 items-center rounded-md border border-slate-700 px-2.5 text-[11px] font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              {t("siteAudit.resultsLink")}
            </a>
            <button
              type="button"
              onClick={() => setMapNavigationRequest((request) => request + 1)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-400/35 bg-emerald-400/10 px-2.5 text-[11px] font-medium text-emerald-200 transition hover:border-emerald-300/70 hover:bg-emerald-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              aria-label={t("siteAudit.openMapAria", {
                count: crawlResult.pages_crawled,
              })}
            >
              <Map className="h-3.5 w-3.5" />
              {t("siteAudit.mapLink")}
            </button>
          </div>
        </nav>
      )}

      {crawlResult && (
        <div
          className={`pointer-events-none fixed inset-x-3 z-50 md:right-4 ${sidebarCollapsed ? "md:left-[4.5rem]" : "md:left-[16.5rem]"}`}
          style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <nav
            aria-label={t("siteAudit.fixedNavAria")}
            className="pointer-events-auto mx-auto grid w-full max-w-5xl grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-slate-700/90 bg-slate-950/95 px-2.5 py-2 shadow-2xl shadow-black/40 backdrop-blur supports-[backdrop-filter]:bg-slate-950/85"
          >
            <span className="hidden shrink-0 items-center gap-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 sm:inline-flex">
              {t("siteAudit.auditCount")}
              <span className="font-mono text-slate-300">
                {crawlResult.pages_crawled}
              </span>
            </span>
            <div className="grid min-w-0 grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => scrollToResults()}
                title={t("siteAudit.backToResults")}
                className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-[11px] font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                aria-label={t("siteAudit.backToResults")}
              >
                <ArrowUp className="h-3.5 w-3.5" />
                <span className="sm:hidden">{t("siteAudit.resultsShort")}</span>
                <span className="hidden truncate sm:inline">
                  {t("siteAudit.resultsLong")}
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setMapNavigationRequest((request) => request + 1)
                }
                title={t("siteAudit.mapDirect")}
                className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-emerald-400/45 bg-emerald-400/10 px-2.5 text-[11px] font-semibold text-emerald-100 transition hover:border-emerald-300/80 hover:bg-emerald-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                aria-label={`${t("siteAudit.mapDirect")}, ${crawlResult.pages_crawled}`}
              >
                <Map className="h-3.5 w-3.5" />
                <span className="sm:hidden">{t("siteAudit.mapShort")}</span>
                <span className="hidden truncate sm:inline">
                  {t("siteAudit.mapLong")}
                </span>
              </button>
            </div>
          </nav>
        </div>
      )}

      {/* Crawl Control Form */}
      {mapRequiresCrawl && !crawlResult && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
        >
          {t("siteAudit.mapRequiresCrawl")}
        </p>
      )}

      <form
        id="site-audit-crawl-form"
        onSubmit={handleStartCrawl}
        className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col md:flex-row gap-3 shadow-lg"
      >
        <div className="flex-1 relative">
          <Layers className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            id="site-audit-start-url"
            type="text"
            value={inputUrl}
            aria-label={t("siteAudit.startUrlAria")}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder={t("siteAudit.urlPlaceholder")}
            className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg pl-11 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition font-mono"
          />
        </div>

        <div className="w-full md:w-44">
          <select
            aria-label={t("siteAudit.pageLimitAria")}
            value={selectedLimit}
            onChange={(e) => setSelectedLimit(Number(e.target.value))}
            className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg px-3 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-emerald-500 transition cursor-pointer"
          >
            {[25, 50, 100, 250, 500].map((limit) => (
              <option key={limit} value={limit}>
                {t("siteAudit.pageLimitOption", { count: limit })}
              </option>
            ))}
          </select>
        </div>

        <label className="w-full text-[11px] text-slate-400 md:w-52">
          {t("siteAudit.renderMode")}
          <select
            aria-label={t("siteAudit.renderModeAria")}
            value={crawlConfig.crawlMode || "http"}
            onChange={(event) =>
              setCrawlConfig({
                crawlMode: event.target.value as "http" | "browser-rendered",
              })
            }
            className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-400"
          >
            <option value="http">{t("siteAudit.renderModeHttp")}</option>
            <option value="browser-rendered">
              {t("siteAudit.renderModeBrowser")}
            </option>
          </select>
        </label>

        <button
          type="submit"
          disabled={isCrawling || !desktopAvailable}
          aria-disabled={isCrawling || !desktopAvailable}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-sm rounded-lg flex items-center justify-center space-x-2 transition shadow-md shadow-emerald-950"
        >
          {isCrawling ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {t("siteAudit.progress", {
                  completed: crawlProgressDetail?.completed ?? 0,
                  discovered: crawlProgressDetail?.discovered ?? 0,
                  rate: crawlProgressDetail?.pagesPerSecond
                    ? ` · ${t("siteAudit.rate", { value: crawlProgressDetail.pagesPerSecond.toFixed(1) })}`
                    : "",
                })}
              </span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>{t("siteAudit.crawlStart")}</span>
            </>
          )}
        </button>
      </form>

      {!desktopAvailable && (
        <p role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs text-amber-100">
          {t("runtimeErrors.tauri.desktopOnly")}
        </p>
      )}

      {filterValidationError && (
        <p
          role="alert"
          className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
        >
          {t("siteAudit.filterValidationError")}{" "}
          <span className="break-words text-rose-200">
            {filterValidationError}
          </span>
        </p>
      )}

      {activeProjectId && (
        <ScheduledAuditsPanel
          projectId={activeProjectId}
          initialUrl={crawlUrl || inputUrl}
          crawlConfig={crawlConfig}
          crawlLimit={selectedLimit}
        />
      )}

      {activeProjectId && (
        <section className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                {t("siteAudit.environmentComparisonTitle")}
              </h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
                {t("siteAudit.environmentComparisonDescription")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runEnvironmentComparison()}
              disabled={
                isEnvironmentComparisonRunning ||
                isCrawling ||
                !desktopAvailable ||
                !environmentUrls.staging.trim() ||
                !environmentUrls.production.trim()
              }
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isEnvironmentComparisonRunning
                ? t("siteAudit.environmentComparisonRunning")
                : t("siteAudit.environmentComparisonRun")}
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs text-slate-300">
              {t("siteAudit.environmentStagingUrl")}
              <input
                value={environmentUrls.staging}
                onChange={(event) =>
                  updateEnvironmentUrl("staging", event.target.value)
                }
                placeholder={t("siteAudit.environmentStagingPlaceholder")}
                className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950/80 px-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-sky-400"
              />
            </label>
            <label className="text-xs text-slate-300">
              {t("siteAudit.environmentProductionUrl")}
              <input
                value={environmentUrls.production}
                onChange={(event) =>
                  updateEnvironmentUrl("production", event.target.value)
                }
                placeholder={t("siteAudit.environmentProductionPlaceholder")}
                className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950/80 px-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-sky-400"
              />
            </label>
          </div>
          {environmentComparisonError && (
            <p
              role="alert"
              className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100"
            >
              {environmentComparisonError}
            </p>
          )}
          <p className="mt-3 text-[11px] leading-5 text-slate-500">
            {t("siteAudit.environmentComparisonNotice")}
          </p>
        </section>
      )}

      <details className="rounded-xl border border-slate-800 bg-slate-900/45">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400">
          <span>{t("siteAudit.scopeTitle")}</span>
          <span className="text-[11px] font-normal text-slate-500">
            {t("siteAudit.scopeLimit", { count: selectedLimit })} ·{" "}
            {crawlConfig.allowSubdomains
              ? t("siteAudit.scopeSubdomains")
              : t("siteAudit.scopeCurrentHost")}
          </span>
        </summary>
        <section className="grid gap-3 px-4 pb-4 md:grid-cols-3">
          {crawlConfig.crawlMode === "browser-rendered" && (
            <>
              <label className="text-xs text-slate-400">
                {t("siteAudit.renderWaitSelector")}{" "}
                <span className="text-slate-600">
                  {t("siteAudit.optionalMaxSeconds", { count: 8 })}
                </span>
                <input
                  aria-label={t("siteAudit.renderWaitSelectorAria")}
                  value={crawlConfig.renderWaitForSelector || ""}
                  maxLength={512}
                  onChange={(event) =>
                    setCrawlConfig({
                      renderWaitForSelector: event.target.value,
                    })
                  }
                  placeholder={t("siteAudit.renderWaitSelectorPlaceholder")}
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
                />
              </label>
              <label className="text-xs text-slate-400">
                {t("siteAudit.renderDelay")}
                <input
                  aria-label={t("siteAudit.renderDelayAria")}
                  type="number"
                  min="0"
                  max="10000"
                  step="100"
                  value={crawlConfig.renderWaitDelayMs ?? 0}
                  onChange={(event) =>
                    setCrawlConfig({
                      renderWaitDelayMs: Math.min(
                        10000,
                        Math.max(0, Number(event.target.value) || 0),
                      ),
                    })
                  }
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none focus:border-emerald-400"
                />
              </label>
              <label className="text-xs text-slate-400">
                {t("siteAudit.lazyScroll")}
                <input
                  aria-label={t("siteAudit.lazyScrollAria")}
                  type="number"
                  min="0"
                  max="40"
                  value={crawlConfig.renderLazyScrollCycles ?? 0}
                  onChange={(event) =>
                    setCrawlConfig({
                      renderLazyScrollCycles: Math.min(
                        40,
                        Math.max(0, Number(event.target.value) || 0),
                      ),
                    })
                  }
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none focus:border-emerald-400"
                />
              </label>
              <p className="text-xs leading-5 text-slate-500 md:col-span-3">
                {t("siteAudit.browserModeNotice")}
              </p>
              {crawlConfig.requestProfileId &&
                renderedProfileHasTransportOverrides && (
                  <p
                    role="alert"
                    className="text-xs text-amber-200 md:col-span-3"
                  >
                    {t("siteAudit.renderProfileWarning")}
                  </p>
                )}
            </>
          )}
          <label className="text-xs text-slate-400">
            {t("siteAudit.maxDepth")}{" "}
            <span className="text-slate-600">
              {t("siteAudit.emptyNoLimit")}
            </span>
            <input
              type="number"
              min="0"
              max="100"
              value={crawlConfig.maxDepth ?? ""}
              onChange={(event) =>
                setCrawlConfig({
                  maxDepth:
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                })
              }
              className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none focus:border-emerald-400"
            />
          </label>
          <label className="text-xs text-slate-400">
            {t("siteAudit.maxRedirects")}
            <input
              type="number"
              min="0"
              max="50"
              value={crawlConfig.maxRedirects ?? 10}
              onChange={(event) =>
                setCrawlConfig({ maxRedirects: Number(event.target.value) })
              }
              className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none focus:border-emerald-400"
            />
          </label>
          <label className="text-xs text-slate-400">
            {t("siteAudit.maxResponse")}
            <input
              type="number"
              min="1"
              max="50"
              value={Math.round(
                (crawlConfig.maxResponseBytes ?? 5_000_000) / 1_000_000,
              )}
              onChange={(event) =>
                setCrawlConfig({
                  maxResponseBytes: Number(event.target.value) * 1_000_000,
                })
              }
              className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none focus:border-emerald-400"
            />
          </label>
          <label className="text-xs text-slate-400">
            {t("siteAudit.maxRunTime")}
            <input
              type="number"
              min="1"
              max="3600"
              value={crawlConfig.maxRunSeconds ?? ""}
              onChange={(event) =>
                setCrawlConfig({
                  maxRunSeconds:
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                })
              }
              className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none focus:border-emerald-400"
            />
          </label>
          <label className="text-xs text-slate-400">
            {t("siteAudit.includeUrl")}
            <textarea
              value={crawlConfig.includePatterns.join("\n")}
              onChange={(event) =>
                setFilterPatterns("includePatterns", event.target.value)
              }
              placeholder={t('siteAudit.includeUrlPlaceholder')}
              rows={2}
              className="mt-1.5 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
            />
          </label>
          <label className="text-xs text-slate-400">
            {t("siteAudit.excludeUrl")}
            <textarea
              value={crawlConfig.excludePatterns.join("\n")}
              onChange={(event) =>
                setFilterPatterns("excludePatterns", event.target.value)
              }
              placeholder={t('siteAudit.excludeUrlPlaceholder')}
              rows={2}
              className="mt-1.5 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={crawlConfig.allowSubdomains}
              onChange={(event) =>
                setCrawlConfig({ allowSubdomains: event.target.checked })
              }
              className="accent-emerald-400"
            />
            {t("siteAudit.includeSubdomains")}
          </label>
          <label className="text-xs text-slate-400">
            {t("siteAudit.allowedHosts")}{" "}
            <span className="text-slate-600">
              {t("siteAudit.explicitOnePerLine")}
            </span>
            <textarea
              value={(crawlConfig.allowedHosts || []).join("\n")}
              onChange={(event) => setAllowedHosts(event.target.value)}
              placeholder={t('siteAudit.allowedHostsPlaceholder')}
              rows={2}
              className="mt-1.5 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
            />
          </label>
          <label className="text-xs text-slate-400">
            {t("siteAudit.scopeDirectory")}{" "}
            <span className="text-slate-600">{t("siteAudit.optional")}</span>
            <input
              value={crawlConfig.scopePath ?? ""}
              onChange={(event) =>
                setCrawlConfig({ scopePath: event.target.value || undefined })
              }
              placeholder={t('siteAudit.scopeDirectoryPlaceholder')}
              className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={crawlConfig.keepQueryStrings}
              onChange={(event) =>
                setCrawlConfig({ keepQueryStrings: event.target.checked })
              }
              className="accent-emerald-400"
            />
            {t("siteAudit.keepQueryStrings")}
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={Boolean(crawlConfig.trimTrailingSlash)}
              onChange={(event) =>
                setCrawlConfig({ trimTrailingSlash: event.target.checked })
              }
              className="accent-emerald-400"
            />
            {t("siteAudit.trimTrailingSlash")}
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={Boolean(crawlConfig.lowercasePath)}
              onChange={(event) =>
                setCrawlConfig({ lowercasePath: event.target.checked })
              }
              className="accent-emerald-400"
            />
            {t("siteAudit.lowercasePath")}
          </label>
          {crawlConfig.keepQueryStrings && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={Boolean(crawlConfig.stripTrackingParameters)}
                onChange={(event) =>
                  setCrawlConfig({
                    stripTrackingParameters: event.target.checked,
                  })
                }
                className="accent-emerald-400"
              />
              {t("siteAudit.stripTracking")}
            </label>
          )}
          {crawlConfig.keepQueryStrings && (
            <label className="text-xs text-slate-400">
              {t("siteAudit.allowedQueryNames")}{" "}
              <span className="text-slate-600">
                {t("siteAudit.optionalCommaLine")}
              </span>
              <textarea
                value={(crawlConfig.allowedQueryParameters || []).join("\n")}
                onChange={(event) =>
                  setQueryParameterNames(
                    "allowedQueryParameters",
                    event.target.value,
                  )
                }
                placeholder={t('siteAudit.pageExcludePlaceholder')}
                rows={2}
                className="mt-1.5 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
              />
            </label>
          )}
          {crawlConfig.keepQueryStrings && (
            <label className="text-xs text-slate-400">
              {t("siteAudit.deniedQueryNames")}{" "}
              <span className="text-slate-600">{t("siteAudit.denyFirst")}</span>
              <textarea
                value={(crawlConfig.deniedQueryParameters || []).join("\n")}
                onChange={(event) =>
                  setQueryParameterNames(
                    "deniedQueryParameters",
                    event.target.value,
                  )
                }
                placeholder={t('siteAudit.queryExcludePlaceholder')}
                rows={2}
                className="mt-1.5 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={crawlConfig.respectRobots}
              onChange={(event) =>
                setCrawlConfig({ respectRobots: event.target.checked })
              }
              className="accent-emerald-400"
            />
            {t("siteAudit.respectRobots")}
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={crawlConfig.respectCrawlDelay}
              onChange={(event) =>
                setCrawlConfig({ respectCrawlDelay: event.target.checked })
              }
              disabled={!crawlConfig.respectRobots}
              className="accent-emerald-400 disabled:opacity-40"
            />
            {t("siteAudit.respectCrawlDelay")}{" "}
            <span className="text-slate-600">
              {t("siteAudit.max60Seconds")}
            </span>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={crawlConfig.discoverSitemaps}
              onChange={(event) =>
                setCrawlConfig({ discoverSitemaps: event.target.checked })
              }
              className="accent-emerald-400"
            />
            {t("siteAudit.discoverSitemaps")}
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={crawlConfig.followNofollow}
              onChange={(event) =>
                setCrawlConfig({ followNofollow: event.target.checked })
              }
              className="accent-emerald-400"
            />
            {t("siteAudit.followNofollow")}
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={Boolean(crawlConfig.listMode)}
              onChange={(event) =>
                setCrawlConfig({ listMode: event.target.checked })
              }
              className="accent-emerald-400"
            />
            {t("siteAudit.listMode")}
          </label>
          <label className="text-xs text-slate-400">
            {t("siteAudit.focusPhrase")}{" "}
            <span className="text-slate-600">
              {t("siteAudit.optionalEvidence")}
            </span>
            <input
              aria-label={t("siteAudit.focusPhraseAria")}
              value={crawlConfig.focusPhrase || ""}
              maxLength={160}
              onChange={(event) =>
                setCrawlConfig({ focusPhrase: event.target.value })
              }
              placeholder={t("siteAudit.focusPhrasePlaceholder")}
              className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={Boolean(crawlConfig.crawlImages)}
              onChange={(event) =>
                setCrawlConfig({ crawlImages: event.target.checked })
              }
              className="accent-emerald-400"
            />
            {t("siteAudit.crawlImages")}
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={Boolean(crawlConfig.crawlStylesheets)}
              onChange={(event) =>
                setCrawlConfig({ crawlStylesheets: event.target.checked })
              }
              className="accent-emerald-400"
            />
            {t("siteAudit.crawlStylesheets")}
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={Boolean(crawlConfig.crawlScripts)}
              onChange={(event) =>
                setCrawlConfig({ crawlScripts: event.target.checked })
              }
              className="accent-emerald-400"
            />
            {t("siteAudit.crawlScripts")}
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={Boolean(crawlConfig.crawlOtherResources)}
              onChange={(event) =>
                setCrawlConfig({ crawlOtherResources: event.target.checked })
              }
              className="accent-emerald-400"
            />
            {t("siteAudit.crawlOtherResources")}
          </label>
          {(crawlConfig.crawlImages ||
            crawlConfig.crawlStylesheets ||
            crawlConfig.crawlScripts ||
            crawlConfig.crawlOtherResources) && (
            <>
              <label className="text-xs text-slate-400">
                {t("siteAudit.maxResources")}{" "}
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={crawlConfig.maxResourceRequests ?? 250}
                  onChange={(event) =>
                    setCrawlConfig({
                      maxResourceRequests: Number(event.target.value),
                    })
                  }
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none focus:border-emerald-400"
                />
              </label>
              <label className="text-xs text-slate-400">
                {t("siteAudit.resourceConcurrency")}{" "}
                <span className="text-slate-600">
                  {t("siteAudit.httpRequests")}
                </span>
                <input
                  type="number"
                  min="1"
                  max="16"
                  value={crawlConfig.maxConcurrentRequests ?? 4}
                  onChange={(event) =>
                    setCrawlConfig({
                      maxConcurrentRequests: Math.min(
                        16,
                        Math.max(1, Number(event.target.value) || 1),
                      ),
                    })
                  }
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none focus:border-emerald-400"
                />
              </label>
            </>
          )}
          <label className="text-xs text-slate-400">
            {t("siteAudit.importCsv")}{" "}
            <span className="text-slate-600">
              {t("siteAudit.csvColumnLimit")}
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void importSeedUrls(event.target.files?.[0])}
              className="mt-1.5 block w-full text-xs text-slate-400 file:mr-2 file:rounded-md file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-xs file:text-slate-200"
            />
            {crawlConfig.seedUrls?.length ? (
              <span className="mt-1 block text-[11px] text-emerald-300">
                {t("siteAudit.urlsLoaded", {
                  count: crawlConfig.seedUrls.length,
                })}
              </span>
            ) : null}
            {seedImportRejected.length ? (
              <span className="mt-1 block text-[11px] text-amber-300">
                {t("siteAudit.rowsRejected", {
                  count: seedImportRejected.length,
                })}
              </span>
            ) : null}
          </label>
          <p className="text-xs leading-5 text-slate-500">
            {t("siteAudit.normalizationNotice")}
          </p>
        </section>
      </details>

      <details className="rounded-xl border border-slate-800 bg-slate-900/45">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400">
          <span>{t("crawl.customSearch.label")}</span>
          <span className="text-[11px] font-normal text-slate-500">
            {t("crawl.customSearch.count", { count: customSearches.length })}
          </span>
        </summary>
        <section className="space-y-3 px-4 pb-4">
          <p className="text-xs leading-5 text-slate-500">
            {t("crawl.customSearch.description")}
          </p>
          {customSearches.map((search) => (
            <div
              key={search.id}
              className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 md:grid-cols-12"
            >
              <label className="text-[11px] text-slate-400 md:col-span-2">
                {t("crawl.customSearch.name")}
                <input
                  aria-label={`${t("crawl.customSearch.name")} ${search.name}`}
                  value={search.name}
                  maxLength={80}
                  onChange={(event) =>
                    updateCustomSearch(search.id, { name: event.target.value })
                  }
                  className="mt-1 h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400"
                />
              </label>
              <label className="text-[11px] text-slate-400 md:col-span-2">
                {t("crawl.customSearch.selectorType")}
                <select
                  aria-label={`${t("crawl.customSearch.selectorType")} ${search.name}`}
                  value={search.selectorType}
                  onChange={(event) => {
                    const selectorType = event.target.value as CustomSearchDefinition["selectorType"];
                    updateCustomSearch(search.id, {
                      selectorType,
                      ...(selectorType === "regex"
                        ? { resultType: "text", attribute: undefined }
                        : {}),
                    });
                  }}
                  className="mt-1 h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400"
                >
                  <option value="css">{t("crawl.customSearch.css")}</option>
                  <option value="xpath">{t("crawl.customSearch.xpath")}</option>
                  <option value="regex">{t("crawl.customSearch.regex")}</option>
                </select>
              </label>
              <label className="text-[11px] text-slate-400 md:col-span-4">
                {t("crawl.customSearch.selector")}
                <input
                  aria-label={`${t("crawl.customSearch.selector")} ${search.name}`}
                  value={search.query}
                  maxLength={512}
                  onChange={(event) =>
                    updateCustomSearch(search.id, { query: event.target.value })
                  }
                  placeholder={
                    search.selectorType === "css"
                      ? t("crawl.customSearch.cssPlaceholder")
                      : search.selectorType === "xpath"
                        ? t("crawl.customSearch.xpathPlaceholder")
                        : t("crawl.customSearch.regexPlaceholder")
                  }
                  className="mt-1 h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-slate-200 outline-none focus:border-emerald-400"
                />
              </label>
              <label className="text-[11px] text-slate-400 md:col-span-2">
                {t("crawl.customSearch.resultType")}
                <select
                  aria-label={`${t("crawl.customSearch.resultType")} ${search.name}`}
                  value={search.selectorType === "regex" ? "text" : search.resultType}
                  disabled={search.selectorType === "regex"}
                  onChange={(event) =>
                    updateCustomSearch(search.id, {
                      resultType: event.target
                        .value as CustomSearchDefinition["resultType"],
                    })
                  }
                  className="mt-1 h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400"
                >
                  <option value="text">{t("crawl.customSearch.text")}</option>
                  <option value="html">{t("crawl.customSearch.html")}</option>
                  <option value="attribute">{t("crawl.customSearch.attributeValue")}</option>
                </select>
              </label>
              {search.selectorType !== "regex" && search.resultType === "attribute" && (
                <label className="text-[11px] text-slate-400 md:col-span-1">
                  {t("crawl.customSearch.attribute")}
                  <input
                    aria-label={`${t("crawl.customSearch.attribute")} ${search.name}`}
                    value={search.attribute || ""}
                    maxLength={64}
                    onChange={(event) =>
                      updateCustomSearch(search.id, {
                        attribute: event.target.value,
                      })
                    }
                    placeholder={t('siteAudit.attributePlaceholder')}
                    className="mt-1 h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-slate-200 outline-none focus:border-emerald-400"
                  />
                </label>
              )}
              <div className="flex items-end md:col-span-1">
                <button
                  type="button"
                  onClick={() =>
                    setCrawlConfig({
                      customSearches: customSearches.filter(
                        (item) => item.id !== search.id,
                      ),
                    })
                  }
                  className="h-8 w-full rounded-md border border-rose-500/25 px-2 text-xs text-rose-300 hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                >
                  {t("crawl.customSearch.remove")}
                </button>
              </div>
            </div>
          ))}
          {customSearches.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
              {t("crawl.customSearch.empty")}
            </p>
          )}
          <button
            type="button"
            onClick={addCustomSearch}
            disabled={customSearches.length >= 10}
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + {t("crawl.customSearch.add")}
          </button>
        </section>
      </details>

      <details className="rounded-xl border border-slate-800 bg-slate-900/45">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400">
          <span>{t("siteAudit.urlRulesTitle")}</span>
          <span className="text-[11px] font-normal text-slate-500">
            {t("siteAudit.includeCount", { count: crawlConfig.includePatterns.length })} ·{" "}
            {t("siteAudit.excludeCount", { count: crawlConfig.excludePatterns.length })}
          </span>
        </summary>
        <section className="p-4 pt-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                {t("siteAudit.urlRulesHeading")}
              </h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
                {t("siteAudit.urlRulesDescription")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void validateFilters()}
              disabled={isCheckingFilters}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-emerald-500/35 px-3 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/10 disabled:cursor-wait disabled:opacity-60"
            >
              {isCheckingFilters
                ? t("siteAudit.checking")
                : t("siteAudit.checkRules")}
            </button>
          </div>
          {filterValidation && !filterValidation.valid && (
            <div className="mt-3 rounded-md border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              <p className="font-semibold">
                {t("siteAudit.invalidRulesBlock")}
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {filterValidation.errors.map((error, index) => (
                  <li key={`${error.filter}-${error.pattern}-${index}`}>
                    <span className="font-mono">
                      {error.filter}
                      {error.pattern ? `: ${error.pattern}` : ""}
                    </span>{" "}
                    — {error.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {filterValidation?.valid && (
            <div className="mt-3">
              <p className="text-xs text-emerald-300">
                {t("siteAudit.validRules")}{" "}
                {filterValidation.previews.length
                  ? t("siteAudit.previewChecked", {
                      count: filterValidation.previews.length,
                    })
                  : t("siteAudit.previewEmpty")}
              </p>
              {filterValidation.previews.length > 0 && (
                <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/60 text-xs">
                  {filterValidation.previews.map((preview) => (
                    <div
                      key={preview.url}
                      className="flex gap-2 border-b border-slate-800/80 px-3 py-2 last:border-b-0"
                    >
                      <span
                        className={`mt-0.5 shrink-0 font-semibold ${preview.included ? "text-emerald-300" : "text-amber-300"}`}
                      >
                        {preview.included
                          ? t("siteAudit.included")
                          : t("siteAudit.excluded")}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-slate-300"
                        title={preview.url}
                      >
                        {preview.url}
                      </span>
                      <span className="shrink-0 text-slate-500">
                        {preview.reason}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </details>

      <details className="rounded-xl border border-slate-800 bg-slate-900/45">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400">
          <span>{t("siteAudit.requestProfileTitle")}</span>
          <span className="text-[11px] font-normal text-slate-500">
            {crawlConfig.requestProfileId
              ? crawlRequestProfiles.find(
                  (profile) => profile.id === crawlConfig.requestProfileId,
                )?.name || t("siteAudit.requestProfileSummary")
              : t("siteAudit.requestProfileSummary")}
          </span>
        </summary>
        <section className="p-4 pt-0">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-slate-100">
              {t("siteAudit.requestProfileHeading")}
            </h2>
            <p className="text-xs leading-5 text-slate-500">
              {t("siteAudit.requestProfileDescription")}
            </p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-xs text-slate-400">
              {t("siteAudit.activeProfile")}
              <select
                value={crawlConfig.requestProfileId || ""}
                onChange={(event) => selectRequestProfile(event.target.value)}
                className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none focus:border-emerald-400"
              >
                <option value="">{t("siteAudit.noProfile")}</option>
                {crawlRequestProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                    {profile.hasCookie ? ` · ${t("siteAudit.cookies")}` : ""}
                    {profile.hasHeaders ? ` · ${t("siteAudit.headers")}` : ""}
                    {profile.hasProxy ? ` · ${t("siteAudit.proxy")}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              {t("urlBar.userAgent")}
              <input
                value={crawlConfig.userAgent || ""}
                onChange={(event) =>
                  setCrawlConfig({ userAgent: event.target.value })
                }
                maxLength={1024}
                placeholder={t("siteAudit.userAgentPlaceholder")}
                className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
              />
            </label>
          </div>
          {crawlConfig.requestProfileId && (
            <button
              type="button"
              onClick={() => void removeRequestProfile()}
              className="mt-3 text-xs font-medium text-rose-300 underline decoration-rose-500/40 underline-offset-4 hover:text-rose-200"
            >
              {t("siteAudit.removeProfile")}
            </button>
          )}
          <div className="mt-4 grid gap-3 border-t border-slate-800 pt-4 md:grid-cols-2">
            <label className="text-xs text-slate-400">
              {t("siteAudit.newProfileName")}
              <input
                value={requestProfileName}
                onChange={(event) => setRequestProfileName(event.target.value)}
                maxLength={80}
                placeholder={t("siteAudit.profileNamePlaceholder")}
                className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
              />
            </label>
            <label className="text-xs text-slate-400">
              {t("siteAudit.sessionCookies")}{" "}
              <span className="text-slate-600">{t("siteAudit.optional")}</span>
              <input
                type="password"
                value={requestProfileCookie}
                onChange={(event) =>
                  setRequestProfileCookie(event.target.value)
                }
                maxLength={16384}
                placeholder={t('siteAudit.sessionCookiesPlaceholder')}
                className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
              />
            </label>
            <label className="text-xs text-slate-400 md:col-span-2">
              {t("siteAudit.httpProxy")}{" "}
              <span className="text-slate-600">
                {t("siteAudit.proxyOptional")}
              </span>
              <input
                type="password"
                value={requestProfileProxyUrl}
                onChange={(event) =>
                  setRequestProfileProxyUrl(event.target.value)
                }
                maxLength={2048}
                placeholder={t('siteAudit.proxyUrlPlaceholder')}
                className="mt-1.5 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
              />
            </label>
            <label className="text-xs text-slate-400 md:col-span-2">
              {t("siteAudit.customHeaders")}{" "}
              <span className="text-slate-600">
                {t("siteAudit.oneHeaderPerLine")}
              </span>
              <textarea
                value={requestProfileHeaders}
                onChange={(event) =>
                  setRequestProfileHeaders(event.target.value)
                }
                rows={3}
                placeholder={t('siteAudit.customHeadersPlaceholder')}
                className="mt-1.5 w-full resize-y rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-400"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void saveRequestProfile()}
              disabled={isSavingCrawlRequestProfile}
              className="inline-flex h-9 items-center rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/15 disabled:cursor-wait disabled:opacity-60"
            >
              {isSavingCrawlRequestProfile
                ? t("siteAudit.saving")
                : t("siteAudit.saveProfile")}
            </button>
            <p className="text-[11px] text-slate-500">
              {t("siteAudit.profileSecretsNotice")}
            </p>
          </div>
          {requestProfileStatus && (
            <p
              className={`mt-3 rounded-md border px-3 py-2 text-xs ${requestProfileStatusIsError ? "border-rose-500/35 bg-rose-500/10 text-rose-100" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"}`}
            >
              {requestProfileStatus}
            </p>
          )}
        </section>
      </details>

      {interruptedCrawl && !isCrawling && (
        <section
          className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4"
          role="status"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-amber-100">
                {t("siteAudit.interruptedTitle")}
              </h2>
              <p className="mt-1 break-all text-xs leading-5 text-amber-200/80">
                {t("siteAudit.interruptedDescription", {
                  url: interruptedCrawl.url,
                  limit: interruptedCrawl.limit,
                  date: new Date(interruptedCrawl.startedAt).toLocaleString(),
                  completed:
                    interruptedCrawl.completedUrls?.length?.toLocaleString() ||
                    "",
                  frontier:
                    interruptedCrawl.frontierUrls?.length?.toLocaleString() ||
                    "",
                })}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => void resumeInterruptedCrawl()}
                className="rounded-md bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-200"
              >
                {t("siteAudit.resumeCrawl")}
              </button>
              <button
                type="button"
                onClick={discardInterruptedCrawl}
                className="rounded-md border border-amber-400/35 px-3 py-2 text-xs font-medium text-amber-100 transition hover:bg-amber-400/10"
              >
                {t("siteAudit.discard")}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Crawl Progress Bar */}
      {isCrawling && (
        <div className="p-5 rounded-xl bg-slate-900 border border-emerald-500/30 space-y-3">
          <div className="flex justify-between text-xs text-slate-300 font-mono">
            <span className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              {t("siteAudit.progressStatus")}
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  void (isCrawlPaused ? resumeSiteCrawl() : pauseSiteCrawl())
                }
                className="rounded border border-amber-500/40 px-2 py-1 text-[11px] font-semibold text-amber-200 transition hover:bg-amber-500/10"
              >
                {isCrawlPaused
                  ? t("siteAudit.resumeCrawl")
                  : t("siteAudit.pauseCrawl")}
              </button>
              <button
                type="button"
                onClick={() => void cancelSiteCrawl()}
                className="rounded border border-rose-500/40 px-2 py-1 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/10"
              >
                {t("siteAudit.cancelCrawl")}
              </button>
            </span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
              style={{ width: `${crawlProgress}%` }}
            />
          </div>
          {isCrawlPaused && (
            <p className="text-[11px] font-medium text-amber-200">
              {t("siteAudit.pausedNotice")}
            </p>
          )}
          {crawlProgressDetail?.currentUrl && (
            <p className="truncate text-[11px] font-mono text-slate-500">
              {crawlProgressDetail.currentUrl}
            </p>
          )}
          <div
            className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-3 text-[11px] text-slate-400 sm:grid-cols-4"
            aria-label={t("siteAudit.liveMetricsAria")}
            aria-live="polite"
          >
            <div>
              <span className="block text-[10px] uppercase tracking-wide text-slate-600">
                {t("siteAudit.processed")}
              </span>
              <span className="mt-1 block font-mono text-slate-200">
                {crawlProgressDetail?.completed ?? 0}/{crawlProgressDetail?.discovered ?? 0}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wide text-slate-600">
                {t("siteAudit.queued")}
              </span>
              <span className="mt-1 block font-mono text-slate-200">
                {crawlProgressDetail?.queued ?? 0}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wide text-slate-600">
                {t("siteAudit.elapsed")}
              </span>
              <span className="mt-1 block font-mono text-slate-200">
                {formatCrawlElapsed(crawlProgressDetail?.elapsedMs)}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wide text-slate-600">
                {t("siteAudit.throughput")}
              </span>
              <span className="mt-1 block font-mono text-slate-200">
                {t("siteAudit.rate", { value: (crawlProgressDetail?.pagesPerSecond ?? 0).toFixed(1) })}
              </span>
            </div>
          </div>
        </div>
      )}

      {crawlError && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-sm">
          {crawlError}
        </div>
      )}

      {crawlPersistenceError && (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-sm text-amber-100"
        >
          <p className="font-medium">{t("siteAudit.persistenceErrorTitle")}</p>
          <p className="mt-1 break-words text-xs text-amber-200/80">
            {crawlPersistenceError}
          </p>
          <button
            type="button"
            onClick={() => void retryCrawlPersistence()}
            disabled={isRetryingCrawlPersistence || !crawlRuns.length}
            className="mt-3 inline-flex h-8 items-center rounded-md border border-amber-300/40 px-3 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/10 disabled:cursor-wait disabled:opacity-60"
          >
            {isRetryingCrawlPersistence
              ? t("siteAudit.retryingSave")
              : t("siteAudit.retrySave")}
          </button>
        </div>
      )}

      {crawlPersistenceNotice && !crawlPersistenceError && (
        <div
          role="status"
          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100"
        >
          <p className="font-medium">
            {crawlPersistenceCompacted
              ? t("crawl.persistence.recoveredTitle")
              : t("crawl.persistence.savedTitle")}
          </p>
          <p className="mt-1 break-words text-xs text-amber-200/80">
            {crawlPersistenceNotice}
          </p>
        </div>
      )}

      {crawlResult?.timed_out && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-sm text-amber-100">
          {t("siteAudit.timedOut", { count: crawlResult.pages_crawled })}
        </div>
      )}

      {crawlResult && (
        <>
          <CrawlResultsTabs
            result={crawlResult}
            runs={crawlRuns}
            selectedRun={selectedRun}
            onSelectRun={selectCrawlRun}
            onDeleteRun={deleteCrawlRun}
            mapNavigationRequest={mapNavigationRequest}
          />
          <div className="hidden" aria-hidden="true">
            {crawlResult?.resources !== undefined && (
              <section className="rounded-xl border border-slate-800 bg-slate-900/45 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">
                      {t("siteAudit.resourcesTitle")}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {t("siteAudit.resourcesDescription")}
                    </p>
                  </div>
                  <div className="text-xs text-slate-400">
                    {t("siteAudit.resourceCount", {
                      count: crawlResult.resources.length,
                    })}
                    {crawlResult.resource_limit_reached
                      ? ` · ${t("siteAudit.resourceLimitReached")}`
                      : ""}
                  </div>
                </div>
                {crawlResult.resources.length > 0 ? (
                  <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-800">
                    <table className="w-full min-w-[880px] text-left text-xs">
                      <thead className="sticky top-0 bg-slate-950 text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">
                            {t("siteAudit.resourceType")}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {t("siteAudit.status")}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {t("siteAudit.resource")}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {t("siteAudit.sources")}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {t("siteAudit.contentTypeSize")}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {t("siteAudit.intrinsicDimensions")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredResources.map((resource) => (
                          <tr
                            key={resource.url}
                            className="border-t border-slate-800/80 text-slate-300"
                          >
                            <td className="px-3 py-2 capitalize text-slate-400">
                              {resource.resource_type}
                            </td>
                            <td
                              className={`px-3 py-2 font-mono ${resource.http_status && resource.http_status < 400 ? "text-emerald-300" : "text-rose-300"}`}
                            >
                              {resource.http_status
                                ? t("crawl.ui.httpStatus", { status: resource.http_status })
                                : resource.request_error_kind ||
                                  t("siteAudit.requestError")}
                            </td>
                            <td
                              className="max-w-[360px] truncate px-3 py-2 font-mono"
                              title={resource.url}
                            >
                              {resource.url}
                            </td>
                            <td className="px-3 py-2 text-slate-500">
                              {resource.source_urls.length}
                            </td>
                            <td className="px-3 py-2 text-slate-500">
                              {resource.content_type || t("siteAudit.none")}{" "}
                              {resource.content_length !== undefined
                                ? ` · ${resource.content_length.toLocaleString()} B`
                                : ""}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-500">
                              {resource.intrinsic_width &&
                              resource.intrinsic_height
                                ? `${resource.intrinsic_width} × ${resource.intrinsic_height} · ${resource.dimensions_source || t("crawlDeepUi.intrinsic")}`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredResources.length === 0 &&
                      activeErrorKindFilter !== "all" && (
                        <p className="p-3 text-xs text-slate-500">
                          {t("siteAudit.noFilteredResources", {
                            error: crawlErrorLabel(activeErrorKindFilter),
                          })}
                        </p>
                      )}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">
                    {t("siteAudit.noResources")}
                  </p>
                )}
              </section>
            )}

            {crawlRuns.length > 1 && (
              <section className="rounded-xl border border-slate-800 bg-slate-900/45 p-4">
                <div className="mb-3">
                  <h2 className="text-sm font-semibold text-slate-100">
                    {t("siteAudit.metricHistoryTitle")}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("siteAudit.metricHistoryDescription")}
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  {historyMetrics.map((metric) => (
                    <div
                      key={metric.label}
                      className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"
                    >
                      <p className={`text-xs font-medium ${metric.colour}`}>
                        {metric.label}
                      </p>
                      <p className="mt-1 text-xl font-semibold text-white">
                        {metric.values.at(-1) ?? "—"}
                      </p>
                      <TrendChart
                        values={metric.values}
                        label={t("siteAudit.historyChartLabel", {
                          metric: metric.label,
                        })}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {crawlRuns.length > 1 && crawlResult && (
              <section className="rounded-xl border border-slate-800 bg-slate-900/45 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">
                      {t("siteAudit.crawlComparisonTitle")}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {comparisonByPath
                        ? t("siteAudit.crawlComparisonPathMode")
                        : t("siteAudit.crawlComparisonUrlMode")}
                    </p>
                  </div>
                  <div className="flex flex-col items-stretch gap-2 sm:items-end">
                    <select
                      aria-label={t("siteAudit.comparisonSelectAria")}
                      value={comparisonRunId}
                      onChange={(event) =>
                        setComparisonRunId(event.target.value)
                      }
                      className="h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400 sm:w-96"
                    >
                      <option value="">
                        {t("siteAudit.comparisonSelectPlaceholder")}
                      </option>
                      {crawlRuns
                        .filter((run) => run.id !== selectedRun?.id)
                        .map((run) => (
                          <option key={run.id} value={run.id}>
                            {crawlEnvironmentLabel(run.environment)} ·{" "}
                            {format(
                              new Date(run.completedAt),
                              "yyyy-MM-dd HH:mm",
                            )}{" "}
                            · {t("crawl.ui.urlsCount", { count: run.result.pages_crawled })} · {run.startUrl}
                          </option>
                        ))}
                    </select>
                    <label className="flex items-center gap-2 text-[11px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={comparisonByPath}
                        onChange={(event) =>
                          updateComparisonByPath(event.target.checked)
                        }
                        className="accent-emerald-400"
                      />
                      {t("siteAudit.comparisonPathLabel")}
                    </label>
                  </div>
                </div>
                {comparisonByPath && (
                  <p
                    role="note"
                    className="mt-3 rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[11px] leading-5 text-sky-100"
                  >
                    {t("siteAudit.comparisonPathNotice")}
                  </p>
                )}
                {comparison && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <p className="text-xs text-emerald-300">
                        {t("siteAudit.comparisonAdded")}
                      </p>
                      <p className="mt-1 text-2xl font-bold text-white">
                        {comparison.added.length}
                      </p>
                    </div>
                    <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
                      <p className="text-xs text-rose-300">
                        {t("siteAudit.comparisonRemoved")}
                      </p>
                      <p className="mt-1 text-2xl font-bold text-white">
                        {comparison.removed.length}
                      </p>
                    </div>
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                      <p className="text-xs text-amber-300">
                        {t("siteAudit.comparisonChanged")}
                      </p>
                      <p className="mt-1 text-2xl font-bold text-white">
                        {comparison.changed.length}
                      </p>
                    </div>
                    <div className="sm:col-span-3 max-h-52 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
                      {[
                        ...comparison.added,
                        ...comparison.removed,
                        ...comparison.changed,
                      ].length === 0 ? (
                        <p className="text-slate-500">
                          {t("siteAudit.comparisonNoDifferences")}
                        </p>
                      ) : (
                        [
                          ...comparison.added,
                          ...comparison.removed,
                          ...comparison.changed,
                        ].map((change) => (
                          <p
                            key={`${change.kind}-${change.url}`}
                            className="truncate py-1 text-slate-300"
                          >
                            <span
                              className={
                                change.kind === "added"
                                  ? "text-emerald-300"
                                  : change.kind === "removed"
                                    ? "text-rose-300"
                                    : "text-amber-300"
                              }
                            >
                              {change.kind === "added"
                                ? t("siteAudit.comparisonAddedLabel")
                                : change.kind === "removed"
                                  ? t("siteAudit.comparisonRemovedLabel")
                                  : t("siteAudit.comparisonChangedLabel")}
                            </span>{" "}
                            · {change.url}
                            {change.matchedUrl &&
                            change.matchedUrl !== change.url
                              ? ` ↔ ${change.matchedUrl}`
                              : ""}
                            {change.fields.length
                              ? ` (${change.fields.join(", ")})`
                              : ""}
                          </p>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Crawl Result Dashboard */}
            {crawlResult && (
              <div className="space-y-8">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="flex items-center space-x-2 text-slate-400 text-xs font-medium mb-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{t("siteAudit.healthScore")}</span>
                    </div>
                    <div className="text-2xl font-bold text-white font-mono">
                      {crawlResult.health_score} / 100
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {t("siteAudit.healthIndex")}
                    </span>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="flex items-center space-x-2 text-slate-400 text-xs font-medium mb-1">
                      <Layers className="w-3.5 h-3.5 text-blue-400" />
                      <span>{t("siteAudit.pagesCrawled")}</span>
                    </div>
                    <div className="text-2xl font-bold text-white font-mono">
                      {crawlResult.pages_crawled}
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {t("siteAudit.internalTargets")}
                    </span>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="flex items-center space-x-2 text-slate-400 text-xs font-medium mb-1">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                      <span>{t("siteAudit.criticalIssues")}</span>
                    </div>
                    <div className="text-2xl font-bold text-rose-400 font-mono">
                      {crawlResult.critical_count}
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {t("siteAudit.immediateAction")}
                    </span>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="flex items-center space-x-2 text-slate-400 text-xs font-medium mb-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <span>{t("siteAudit.warningLabel")}</span>
                    </div>
                    <div className="text-2xl font-bold text-amber-400 font-mono">
                      {crawlResult.warning_count}
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {t("siteAudit.suboptimalPractices")}
                    </span>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="flex items-center space-x-2 text-slate-400 text-xs font-medium mb-1">
                      <Clock className="w-3.5 h-3.5 text-purple-400" />
                      <span>{t("siteAudit.crawlTime")}</span>
                    </div>
                    <div className="text-2xl font-bold text-white font-mono">
                      {crawlResult.duration_ms} {t("performance.milliseconds")}
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {t("siteAudit.asynchronousExecution")}
                    </span>
                  </div>
                </div>
                {crawlResult.cancelled && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    {t("siteAudit.cancelledNotice")}
                  </p>
                )}
                <p className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
                  {t("siteAudit.robotsStatus", {
                    status: crawlResult.robots_txt_status,
                    count: crawlResult.robots_blocked_count,
                  })}
                </p>
                <p className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
                  {t("siteAudit.sitemapStatus", {
                    status: crawlResult.sitemap_status,
                    count: crawlResult.sitemap_urls_discovered,
                  })}
                </p>
                {(crawlResult.rejected_urls?.length || 0) > 0 && (
                  <details className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                    <summary className="cursor-pointer font-medium">
                      {t("siteAudit.rejectedUrls", {
                        count: crawlResult.rejected_urls?.length,
                      })}
                    </summary>
                    <ul className="mt-2 max-h-40 space-y-1 overflow-auto font-mono text-[11px] text-slate-300">
                      {crawlResult.rejected_urls?.map((item) => (
                        <li key={`${item.url}-${item.reason}`}>
                          {item.url} —{" "}
                          <span className="text-amber-200">{item.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {selectedRun && (
                  <details className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-100">
                      {t("siteAudit.reportTemplate")} ·{" "}
                      {selectedReportTemplate.name}
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
                        <label className="text-[11px] text-slate-400">
                          {t("siteAudit.activeTemplate")}
                          <select
                            aria-label={t("siteAudit.activeTemplateAria")}
                            value={selectedReportTemplate.id}
                            onChange={(event) =>
                              selectReportTemplate(event.target.value)
                            }
                            className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                          >
                            <option value={DEFAULT_CRAWL_REPORT_TEMPLATE.id}>
                              {DEFAULT_CRAWL_REPORT_TEMPLATE.name}
                            </option>
                            {reportTemplates
                              .filter((template) => !template.builtIn)
                              .map((template) => (
                                <option key={template.id} value={template.id}>
                                  {template.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="text-[11px] text-slate-400">
                          {t("siteAudit.newTemplateName")}
                          <input
                            aria-label={t("siteAudit.newTemplateAria")}
                            value={reportTemplateName}
                            onChange={(event) =>
                              setReportTemplateName(event.target.value)
                            }
                            placeholder={t("siteAudit.templatePlaceholder")}
                            className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white placeholder:text-slate-600"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={createReportTemplate}
                          className="self-end rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                        >
                          {t("siteAudit.saveAsNew")}
                        </button>
                        {!selectedReportTemplate.builtIn && (
                          <button
                            type="button"
                            onClick={removeReportTemplate}
                            className="self-end rounded-md border border-rose-500/30 px-3 py-2 text-xs text-rose-300 hover:border-rose-400"
                          >
                            {t("siteAudit.remove")}
                          </button>
                        )}
                      </div>
                      <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {t("siteAudit.reportSectionsLegend")}
                        </legend>
                        {REPORT_TEMPLATE_SECTIONS.filter(
                          (section) => section !== "summary",
                        ).map((section) => (
                          <label
                            key={section}
                            className="flex items-center gap-2 text-xs text-slate-300"
                          >
                            <input
                              type="checkbox"
                              checked={reportTemplateSections.includes(section)}
                              onChange={() =>
                                toggleReportTemplateSection(section)
                              }
                            />
                            {reportTemplateSectionLabels[section]}
                          </label>
                        ))}
                      </fieldset>
                      <p className="text-[10px] leading-4 text-slate-500">
                        {t("siteAudit.reportTemplateDescription")}
                      </p>
                      {reportTemplateError && (
                        <p role="alert" className="text-xs text-rose-300">
                          {reportTemplateError}
                        </p>
                      )}
                    </div>
                  </details>
                )}
                {selectedRun ? (
                  <section className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-100">
                        {t("siteAudit.exportTitle")}
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {t("siteAudit.exportDescription")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          downloadCrawlJson(selectedRun, selectedReportTemplate)
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition hover:text-white"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("crawlDeepUi.exportJson")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportCrawlPdf()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition hover:text-white"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("crawlDeepUi.exportPdf")}
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadCrawlPagesCsv(selectedRun)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("siteAudit.urlCsv")}
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadCrawlLinksCsv(selectedRun)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition hover:text-white"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("siteAudit.linksCsv")}
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadCrawlImagesCsv(selectedRun)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition hover:text-white"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("siteAudit.imagesCsv")}
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadCrawlResourcesCsv(selectedRun)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition hover:text-white"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("siteAudit.resourcesCsv")}
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadCrawlIssuesCsv(selectedRun)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition hover:text-white"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("siteAudit.issuesCsv")}
                      </button>
                    </div>
                    {crawlPdfError && (
                      <p role="alert" className="text-xs text-rose-300">
                        {crawlPdfError}
                      </p>
                    )}
                  </section>
                ) : (
                  <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                    {t("siteAudit.legacyExportUnavailable")}
                  </p>
                )}
                {crawlResult.sitemap_urls_discovered > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                      <p className="text-xs text-sky-200">
                        {t("siteAudit.sitemapOnlyTitle")}
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-white">
                        {sitemapOnlyUrls.length}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {t("siteAudit.sitemapOnlyDescription")}
                      </p>
                    </div>
                    <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
                      <p className="text-xs text-violet-200">
                        {t("siteAudit.crawlOnlyTitle")}
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-white">
                        {crawlOnlyUrls.length}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {t("siteAudit.crawlOnlyDescription")}
                      </p>
                    </div>
                  </div>
                )}
                {/* Filter Bar */}
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">
                    {t("siteAudit.pagesInventory", {
                      count: filteredPages.length,
                    })}
                  </h3>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400">
                      {t("siteAudit.severity")}:
                    </span>
                    {(["all", "Critical", "Warning", "Info"] as const).map(
                      (mode) => (
                        <button
                          key={mode}
                          onClick={() => setSeverityFilter(mode)}
                          className={`text-xs px-2.5 py-1 rounded-md transition ${
                            severityFilter === mode
                              ? "bg-emerald-500/20 text-emerald-300 font-medium"
                              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                          }`}
                        >
                          {mode === "all"
                            ? t("siteAudit.allPages")
                            : t(`siteAudit.severityValues.${mode}`)}
                        </button>
                      ),
                    )}
                    <label className="ml-1 flex items-center gap-2 text-xs text-slate-400">
                      {t("siteAudit.errorType")}
                      <select
                        value={activeErrorKindFilter}
                        onChange={(event) =>
                          setErrorKindFilter(event.target.value)
                        }
                        className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400"
                      >
                        <option value="all">{t("siteAudit.all")}</option>
                        {availableErrorKinds.map((kind) => (
                          <option key={kind} value={kind}>
                            {crawlErrorLabel(kind)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                {/* Crawled Pages Table */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-md">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900 text-slate-400 uppercase font-semibold border-b border-slate-800">
                        <tr>
                          <th className="px-4 py-3 w-10"></th>
                          <th className="px-4 py-3">
                            {t("siteAudit.pageUrlTitle")}
                          </th>
                          <th className="px-4 py-3 text-center">
                            {t("siteAudit.status")}
                          </th>
                          <th className="px-4 py-3 text-center">
                            {t("siteAudit.depth")}
                          </th>
                          <th className="px-4 py-3 text-center">
                            {t("siteAudit.h1Count")}
                          </th>
                          <th className="px-4 py-3 text-right">
                            {t("siteAudit.speed")}
                          </th>
                          <th className="px-4 py-3 text-right">
                            {t("siteAudit.issues")}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {filteredPages.map((page) => {
                          const isExpanded = Boolean(expandedRows[page.url]);
                          return (
                            <React.Fragment key={page.url}>
                              <tr
                                onClick={() => toggleRow(page.url)}
                                className="hover:bg-slate-800/40 cursor-pointer transition"
                              >
                                <td className="px-4 py-3 text-slate-500">
                                  {page.issues.length > 0 &&
                                    (isExpanded ? (
                                      <ChevronDown className="w-4 h-4 text-emerald-400" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4" />
                                    ))}
                                </td>
                                <td className="px-4 py-3 max-w-md">
                                  <div className="font-medium text-slate-200 truncate">
                                    {page.title || t("siteAudit.noTitle")}
                                  </div>
                                  <div className="text-[11px] text-slate-500 font-mono truncate">
                                    {page.url}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span
                                    className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                                      page.http_status === 200
                                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                    }`}
                                  >
                                    {page.http_status}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center font-mono text-slate-400">
                                  {page.depth}
                                </td>
                                <td className="px-4 py-3 text-center font-mono text-slate-300">
                                  {page.h1_count}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-slate-400">
                                  {page.response_time_ms} {t("performance.milliseconds")}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                                      page.issues.length === 0
                                        ? "bg-emerald-500/10 text-emerald-400"
                                        : "bg-rose-500/10 text-rose-400"
                                    }`}
                                  >
                                    {t("crawl.ui.issueCount", {
                                      count: page.issues.length,
                                    })}
                                  </span>
                                </td>
                              </tr>

                              {isExpanded && page.issues.length > 0 && (
                                <tr className="bg-slate-950/80">
                                  <td
                                    colSpan={7}
                                    className="px-8 py-3 space-y-1.5"
                                  >
                                    <dl className="mb-3 grid gap-x-6 gap-y-1 rounded-md border border-slate-800 bg-slate-900/60 p-3 text-[11px] text-slate-400 sm:grid-cols-2">
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.detailTitle")}:{" "}
                                        </dt>
                                        <dd className="inline break-all text-slate-300">
                                          {page.title || t("siteAudit.none")}
                                          {page.title_length !== undefined
                                            ? ` · ${page.title_length} ${t("siteAudit.characters")}`
                                            : ""}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.detailMetaDescription")}
                                          :{" "}
                                        </dt>
                                        <dd className="inline break-all text-slate-300">
                                          {page.meta_description ||
                                            t("siteAudit.none")}
                                          {page.meta_description_length !==
                                          undefined
                                            ? ` · ${page.meta_description_length} ${t("siteAudit.characters")}`
                                            : ""}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.detailCanonical")}:{" "}
                                        </dt>
                                        <dd className="inline break-all text-slate-300">
                                          {page.canonical ||
                                            t("siteAudit.none")}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.detailMetaRobots")}
                                          :{" "}
                                        </dt>
                                        <dd className="inline text-slate-300">
                                          {page.meta_robots ||
                                            t("siteAudit.noDeclaration")}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.xRobotsTag")}{": "}
                                        </dt>
                                        <dd className="inline text-slate-300">
                                          {page.x_robots_tag ||
                                            t("siteAudit.noDeclaration")}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.detailIndexability")}
                                          :{" "}
                                        </dt>
                                        <dd className="inline text-slate-300">
                                          {page.indexability_status}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.contentType")}{": "}
                                        </dt>
                                        <dd className="inline text-slate-300">
                                          {page.content_type ||
                                            t("siteAudit.unknown")}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.detailResponseBody")}
                                          :{" "}
                                        </dt>
                                        <dd className="inline text-slate-300">
                                          {page.body_truncated
                                            ? t("siteAudit.truncatedBody")
                                            : t("siteAudit.completeBody")}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.detailContent")}:{" "}
                                        </dt>
                                        <dd className="inline text-slate-300">
                                          {page.content_hash
                                            ? `${page.word_count} ${t("siteAudit.words")} · ${t("siteAudit.contentHash")} ${page.content_hash.slice(0, 12)}…${page.content_simhash ? ` · ${t("siteAudit.simHash")} ${page.content_simhash}` : ""}`
                                            : t("siteAudit.contentUnavailable")}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.detailLinks")}:{" "}
                                        </dt>
                                        <dd className="inline text-slate-300">
                                          {t("siteAudit.linkCounts", {
                                            internal: page.internal_link_count,
                                            external: page.external_link_count,
                                            checked: page.links.filter(
                                              (link) =>
                                                link.is_internal &&
                                                link.target_http_status !==
                                                  undefined,
                                            ).length,
                                          })}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.detailImages")}:{" "}
                                        </dt>
                                        <dd className="inline text-slate-300">
                                          {t("siteAudit.imageCounts", {
                                            total: page.images.length,
                                            lazy: page.images.filter(
                                              (image) => image.lazy_loaded,
                                            ).length,
                                          })}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.schema")}:{" "}
                                        </dt>
                                        <dd className="inline text-slate-300">
                                          {page.schema_types.length
                                            ? page.schema_types.join(", ")
                                            : t("siteAudit.notDetected")}
                                          {page.schema_syntax_errors
                                            ? ` · ${t("siteAudit.schemaErrors", { count: page.schema_syntax_errors })}`
                                            : ""}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.language")}:{" "}
                                        </dt>
                                        <dd className="inline text-slate-300">
                                          {page.document_language ||
                                            t("siteAudit.noHtmlLanguage")}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.hreflang")}:{" "}
                                        </dt>
                                        <dd className="inline text-slate-300">
                                          {page.hreflangs.length
                                            ? page.hreflangs
                                                .map((item) => item.language)
                                                .join(", ")
                                            : t("siteAudit.none")}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt className="inline text-slate-500">
                                          {t("siteAudit.amp")}:{" "}
                                        </dt>
                                        <dd className="inline break-all text-slate-300">
                                          {page.amp_url || t("siteAudit.none")}
                                        </dd>
                                      </div>
                                    </dl>
                                    {page.images.length > 0 && (
                                      <div className="mb-3 rounded-md border border-slate-800 bg-slate-900/50 p-3">
                                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                          {t("siteAudit.firstImages")}
                                        </p>
                                        {page.images
                                          .slice(0, 5)
                                          .map((image) => (
                                            <p
                                              key={image.src}
                                              className="truncate text-[11px] text-slate-400"
                                            >
                                              <span
                                                className={
                                                  image.alt === undefined
                                                    ? "text-amber-300"
                                                    : "text-slate-500"
                                                }
                                              >
                                                {image.alt === undefined
                                                  ? t("siteAudit.altMissing")
                                                  : t("siteAudit.altValue", {
                                                      value:
                                                        image.alt ||
                                                        t("siteAudit.empty"),
                                                    })}
                                              </span>{" "}
                                              · {image.src}
                                            </p>
                                          ))}
                                      </div>
                                    )}
                                    {page.links.length > 0 && (
                                      <div className="mb-3 rounded-md border border-slate-800 bg-slate-900/50 p-3">
                                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                          {t("siteAudit.firstLinks")}
                                        </p>
                                        {page.links
                                          .slice(0, 5)
                                          .map((link, index) => (
                                            <p
                                              key={`${link.target_url}-${index}`}
                                              className="truncate text-[11px] text-slate-400"
                                            >
                                              <span
                                                className={
                                                  link.target_http_status !==
                                                    undefined &&
                                                  link.target_http_status >= 400
                                                    ? "text-rose-300"
                                                    : link.target_http_status !==
                                                        undefined
                                                      ? "text-emerald-300"
                                                      : "text-slate-500"
                                                }
                                              >
                                                {link.target_http_status !==
                                                undefined
                                                  ? t("crawl.ui.httpStatus", { status: link.target_http_status })
                                                  : t(
                                                      "siteAudit.notCheckedInRun",
                                                    )}
                                              </span>{" "}
                                              ·{" "}
                                              {link.anchor_text ||
                                                t("siteAudit.noAnchor")}{" "}
                                              → {link.target_url}
                                            </p>
                                          ))}
                                      </div>
                                    )}
                                    {page.redirect_chain.length > 0 && (
                                      <div className="mb-3 rounded-md border border-slate-800 bg-slate-900/50 p-3">
                                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                          {t("siteAudit.redirectChain")}
                                        </p>
                                        {page.redirect_chain.map(
                                          (hop, index) => (
                                            <p
                                              key={`${hop.from_url}-${index}`}
                                              className="truncate text-[11px] text-slate-400"
                                            >
                                              <span className="font-mono text-amber-300">
                                                {hop.http_status}
                                              </span>{" "}
                                              · {hop.from_url} → {hop.to_url}
                                            </p>
                                          ),
                                        )}
                                      </div>
                                    )}
                                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                      {t("siteAudit.identifiedIssues")}
                                    </div>
                                    {page.issues.map((issue, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center space-x-2 text-xs"
                                      >
                                        <span
                                          className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase ${
                                            issue.severity === "Critical"
                                              ? "bg-rose-500/20 text-rose-400"
                                              : "bg-amber-500/20 text-amber-400"
                                          }`}
                                        >
                                          {t(`siteAudit.severityValues.${issue.severity}`)}
                                        </span>
                                        <span className="text-slate-300">
                                          {localizeCrawlIssue(issue, t).displayMessage}
                                        </span>
                                      </div>
                                    ))}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
