import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  Activity,
  Braces,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileDown,
  FileText,
  Image,
  Languages,
  Link2,
  LoaderCircle,
  Map,
  Radar,
  Rows3,
  ScanSearch,
  Share2,
  ShieldCheck,
  FileWarning,
  Code2,
} from "lucide-react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import type {
  CrawlRunRecord,
  CrawledDiscoverySource,
  CrawledPageSummary,
  FaviconData,
  RenderedPageArtifact,
  SiteCrawlResult,
} from "@/types";
import { CrawlArchitectureGraph } from "@/components/Charts/CrawlArchitectureGraph";
import { CrawlerReadinessPanel } from "@/components/Results/CrawlerReadinessPanel";
import { TrendChart } from "@/components/Charts/TrendChart";
import { compareCrawlResults } from "@/services/crawlDiff";
import {
  downloadCrawlCustomSearchCsv,
  downloadCrawlImagesCsv,
  downloadCrawlIssuesCsv,
  downloadCrawlJson,
  downloadCrawlLinksCsv,
  downloadCrawlPagesCsv,
  downloadCrawlPdf,
  downloadCrawlResourcesCsv,
  downloadCrawlFramesCsv,
} from "@/services/export";
import { downloadText } from "@/services/export";
import {
  crawlLinksCsv,
  filterAndSortCrawlLinks,
  type CrawlLinkKindFilter,
  type CrawlLinkSort,
  type CrawlLinkStatusFilter,
} from "@/services/crawlLinkFilters";
import {
  crawlErrorKinds,
  crawlErrorLabel,
  filterCrawlErrors,
} from "@/services/crawlErrors";
import {
  buildCrawlResourceInventory,
  type CrawlResourceProvenanceStatus,
} from "@/services/crawlResources";
import { useProjectStore } from "@/stores/projectStore";
import { useToolsStore } from "@/stores/toolsStore";
import { captureRenderedArtifact } from "@/services/tauri";
import {
  readJsonStorage,
  readStorage,
  writeJsonStorage,
  writeStorage,
} from "@/services/storage";
import { copyText } from "@/services/clipboard";
import { localizeCrawlIssue } from "@/services/crawlIssueLocalization";
import { localizeStructuredDataFinding } from "@/services/schemaIssueLocalization";
import { localizeHtmlValidationFinding } from "@/services/htmlValidationLocalization";

type CrawlTab =
  | "overview"
  | "urls"
  | "crawlerReadiness"
  | "issues"
  | "content"
  | "metadata"
  | "customSearch"
  | "links"
  | "media"
  | "frames"
  | "social"
  | "directives"
  | "international"
  | "structured"
  | "validation"
  | "performance"
  | "visualisations"
  | "exports";
type CrawlSegment = "all" | "2xx" | "3xx" | "4xx" | "5xx" | "transport";
type CrawlSort =
  "url" | "status" | "title" | "depth" | "responseTime" | "issues";
type ResourceProvenanceFilter = "all" | CrawlResourceProvenanceStatus;
interface CrawlFilterPreset {
  id: string;
  name: string;
  severity: "all" | "Critical" | "Warning" | "Info";
  errorKind: string;
  segment: CrawlSegment;
  onlyProblems: boolean;
  query: string;
  sort: CrawlSort;
  descending: boolean;
}

type CrawlTabGroup = "core" | "content" | "technical" | "export";

type MetadataFacet =
  | "all"
  | "missing-title"
  | "empty-title"
  | "title-length"
  | "duplicate-title"
  | "missing-description"
  | "empty-description"
  | "description-length"
  | "duplicate-description";

const metadataFacetOptions: Array<{
  id: MetadataFacet;
  labelKey: string;
  descriptionKey: string;
}> = [
  { id: "all", labelKey: "all", descriptionKey: "allDescription" },
  {
    id: "missing-title",
    labelKey: "missingTitle",
    descriptionKey: "missingTitleDescription",
  },
  {
    id: "empty-title",
    labelKey: "emptyTitle",
    descriptionKey: "emptyTitleDescription",
  },
  {
    id: "title-length",
    labelKey: "titleLength",
    descriptionKey: "titleLengthDescription",
  },
  {
    id: "duplicate-title",
    labelKey: "duplicateTitle",
    descriptionKey: "duplicateTitleDescription",
  },
  {
    id: "missing-description",
    labelKey: "missingDescription",
    descriptionKey: "missingDescriptionDescription",
  },
  {
    id: "empty-description",
    labelKey: "emptyDescription",
    descriptionKey: "emptyDescriptionDescription",
  },
  {
    id: "description-length",
    labelKey: "descriptionLength",
    descriptionKey: "descriptionLengthDescription",
  },
  {
    id: "duplicate-description",
    labelKey: "duplicateDescription",
    descriptionKey: "duplicateDescriptionDescription",
  },
];

const metadataFacetIds = new Set<MetadataFacet>(
  metadataFacetOptions.map((facet) => facet.id),
);

const issueMessageIncludes = (
  page: CrawledPageSummary,
  needle: string,
): boolean =>
  page.issues.some((issue) =>
    issue.message.toLocaleLowerCase().includes(needle),
  );

const metadataFacetsForPage = (page: CrawledPageSummary): MetadataFacet[] => {
  // Metadata rules apply to HTML documents. Keep PDFs, feeds and other
  // non-HTML responses visible in the URL report without inventing missing
  // title/description findings for them.
  if (
    page.content_type &&
    !page.content_type.toLocaleLowerCase().includes("html")
  ) {
    return [];
  }
  const facets: MetadataFacet[] = [];
  // Native Rust snapshots encode optional strings as JSON null, while older
  // browser snapshots used undefined. Treat both representations identically
  // so a persisted crawl can never crash the metadata report.
  const title = typeof page.title === "string" ? page.title : undefined;
  const metaDescription =
    typeof page.meta_description === "string"
      ? page.meta_description
      : undefined;
  if (title === undefined) facets.push("missing-title");
  else if (title.trim() === "") facets.push("empty-title");
  if (
    title !== undefined &&
    title.trim() !== "" &&
    page.title_length != null &&
    !(page.title_length >= 30 && page.title_length <= 60)
  ) {
    facets.push("title-length");
  } else if (
    title !== undefined &&
    title.trim() !== "" &&
    issueMessageIncludes(page, "title length is")
  ) {
    // Older runs may not persist title_length, but retain the server finding.
    facets.push("title-length");
  }
  if (issueMessageIncludes(page, "duplicate title"))
    facets.push("duplicate-title");

  if (issueMessageIncludes(page, "missing meta description")) {
    facets.push("missing-description");
  } else if (issueMessageIncludes(page, "meta description is empty")) {
    facets.push("empty-description");
  } else if (metaDescription === undefined) {
    // Bounded/older snapshots may not retain the issue list. An absent
    // persisted value is still actionable as missing metadata; current runs
    // distinguish an explicitly empty tag above using the server finding.
    facets.push("missing-description");
  }
  if (
    metaDescription !== undefined &&
    metaDescription.trim() !== "" &&
    page.meta_description_length != null &&
    !(page.meta_description_length >= 70 && page.meta_description_length <= 160)
  ) {
    facets.push("description-length");
  } else if (
    metaDescription !== undefined &&
    metaDescription.trim() !== "" &&
    issueMessageIncludes(page, "meta description length is")
  ) {
    facets.push("description-length");
  }
  if (issueMessageIncludes(page, "duplicate meta description"))
    facets.push("duplicate-description");
  return facets;
};

interface CrawlResultsTabsProps {
  result: SiteCrawlResult;
  runs: CrawlRunRecord[];
  selectedRun?: CrawlRunRecord;
  onSelectRun: (id: string) => void;
  onDeleteRun?: (id: string) => Promise<void>;
  mapNavigationRequest?: number;
}

const tabs: Array<{ id: CrawlTab; labelKey: string; icon: typeof Rows3 }> = [
  { id: "overview", labelKey: "tabs.overview", icon: Radar },
  { id: "visualisations", labelKey: "tabs.visualisations", icon: Map },
  { id: "crawlerReadiness", labelKey: "tabs.crawlerReadiness", icon: Bot },
  { id: "urls", labelKey: "tabs.urls", icon: Rows3 },
  { id: "issues", labelKey: "tabs.issues", icon: CircleAlert },
  { id: "content", labelKey: "tabs.content", icon: FileText },
  { id: "metadata", labelKey: "tabs.metadata", icon: FileText },
  { id: "customSearch", labelKey: "customSearch.tab", icon: ScanSearch },
  { id: "links", labelKey: "tabs.links", icon: Link2 },
  { id: "media", labelKey: "tabs.media", icon: Image },
  { id: "frames", labelKey: "tabs.frames", icon: Image },
  { id: "social", labelKey: "tabs.social", icon: Share2 },
  { id: "directives", labelKey: "tabs.directives", icon: ShieldCheck },
  { id: "international", labelKey: "tabs.international", icon: Languages },
  { id: "structured", labelKey: "tabs.structured", icon: Braces },
  { id: "validation", labelKey: "tabs.validation", icon: FileWarning },
  { id: "performance", labelKey: "tabs.performance", icon: Activity },
  { id: "exports", labelKey: "tabs.exports", icon: FileDown },
];

const tabGroups: Array<{
  id: CrawlTabGroup;
  labelKey: string;
  shortLabelKey: string;
  tabs: CrawlTab[];
}> = [
  {
    id: "core",
    labelKey: "groups.core",
    shortLabelKey: "groups.coreShort",
    tabs: ["overview", "visualisations", "crawlerReadiness", "urls", "issues"],
  },
  {
    id: "content",
    labelKey: "groups.content",
    shortLabelKey: "groups.contentShort",
    tabs: [
      "content",
      "metadata",
      "customSearch",
      "links",
      "media",
      "frames",
      "social",
    ],
  },
  {
    id: "technical",
    labelKey: "groups.technical",
    shortLabelKey: "groups.technicalShort",
    tabs: [
      "directives",
      "international",
      "structured",
      "validation",
      "performance",
    ],
  },
  {
    id: "export",
    labelKey: "groups.export",
    shortLabelKey: "groups.exportShort",
    tabs: ["exports"],
  },
];

const tabGroupForTab = (tabId: CrawlTab): CrawlTabGroup =>
  tabGroups.find((group) => group.tabs.includes(tabId))?.id || "core";

interface CrawlNavigationPreferences {
  activeTab: CrawlTab;
  activeTabGroup: CrawlTabGroup;
  metadataFacet: MetadataFacet;
  validationQuery: string;
  validationSeverity: "all" | "Error" | "Warning";
}

const emptyCrawlNavigationPreferences = (): CrawlNavigationPreferences => ({
  activeTab: "overview",
  activeTabGroup: "core",
  metadataFacet: "all",
  validationQuery: "",
  validationSeverity: "all",
});

const readCrawlNavigationPreferences = (
  key: string | null,
): CrawlNavigationPreferences => {
  if (!key) return emptyCrawlNavigationPreferences();
  try {
    const parsed: unknown = readJsonStorage<unknown>(key, null);
    if (!parsed || typeof parsed !== "object")
      return emptyCrawlNavigationPreferences();
    const candidate = parsed as Partial<CrawlNavigationPreferences>;
    const activeTab = tabs.some((tab) => tab.id === candidate.activeTab)
      ? (candidate.activeTab as CrawlTab)
      : "overview";
    return {
      activeTab,
      // Derive the group from the tab so stale entries cannot restore a
      // visually inconsistent group selector after a release changes tabs.
      activeTabGroup: tabGroupForTab(activeTab),
      metadataFacet: metadataFacetIds.has(
        candidate.metadataFacet as MetadataFacet,
      )
        ? (candidate.metadataFacet as MetadataFacet)
        : "all",
      validationQuery:
        typeof candidate.validationQuery === "string"
          ? candidate.validationQuery.slice(0, 120)
          : "",
      validationSeverity:
        candidate.validationSeverity === "Error" ||
        candidate.validationSeverity === "Warning"
          ? candidate.validationSeverity
          : "all",
    };
  } catch {
    return emptyCrawlNavigationPreferences();
  }
};

interface CrawlLinkNavigationPreferences {
  query: string;
  kind: CrawlLinkKindFilter;
  status: CrawlLinkStatusFilter;
  sort: CrawlLinkSort;
  descending: boolean;
}

const emptyCrawlLinkNavigationPreferences =
  (): CrawlLinkNavigationPreferences => ({
    query: "",
    kind: "all",
    status: "all",
    sort: "source",
    descending: false,
  });

const readCrawlLinkNavigationPreferences = (
  key: string | null,
): CrawlLinkNavigationPreferences => {
  if (!key) return emptyCrawlLinkNavigationPreferences();
  const parsed = readJsonStorage<unknown>(key, null);
  if (!parsed || typeof parsed !== "object")
    return emptyCrawlLinkNavigationPreferences();
  const candidate = parsed as Partial<CrawlLinkNavigationPreferences>;
  return {
    query:
      typeof candidate.query === "string" ? candidate.query.slice(0, 160) : "",
    kind:
      candidate.kind === "internal" || candidate.kind === "external"
        ? candidate.kind
        : "all",
    status: ["unchecked", "ok", "redirect", "error", "blocked"].includes(
      candidate.status || "",
    )
      ? (candidate.status as CrawlLinkStatusFilter)
      : "all",
    sort:
      candidate.sort === "target" ||
      candidate.sort === "anchor" ||
      candidate.sort === "status"
        ? candidate.sort
        : "source",
    descending: candidate.descending === true,
  };
};

const cell = "px-3 py-2 align-top";
const tableHead =
  "sticky top-0 bg-slate-950 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500";

const downloadRenderedArtifact = (artifact: RenderedPageArtifact): void => {
  const binary = atob(artifact.dataBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(
    new Blob([bytes], { type: artifact.contentType }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
const tableWrap =
  "max-h-[min(62vh,680px)] overflow-auto rounded-lg border border-slate-800";
const formatNumber = (value: number): string =>
  Math.round(value).toLocaleString();
const normalizeLinkUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
};
const filterPresetsKey = (projectId: string) =>
  `seomi_project_${projectId}_crawl_filter_presets_v1`;
const loadFilterPresets = (projectId: string): CrawlFilterPreset[] => {
  try {
    const value: unknown = readJsonStorage<unknown>(
      filterPresetsKey(projectId),
      [],
    );
    return Array.isArray(value)
      ? value.filter((item): item is CrawlFilterPreset =>
          Boolean(
            item?.id &&
            item?.name &&
            ["all", "Critical", "Warning", "Info"].includes(item.severity) &&
            ["all", "2xx", "3xx", "4xx", "5xx", "transport"].includes(
              item.segment,
            ) &&
            typeof item.onlyProblems === "boolean" &&
            [
              "url",
              "status",
              "title",
              "depth",
              "responseTime",
              "issues",
            ].includes(item.sort),
          ),
        )
      : [];
  } catch {
    return [];
  }
};
const optional = (value?: string | number | null): string =>
  value === undefined || value === "" ? "—" : String(value);

const discoverySourcesForPage = (
  page: CrawledPageSummary,
): CrawledDiscoverySource[] => page.discovery_sources || [];
const Empty = ({ children }: { children: string }) => (
  <p className="rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-8 text-center text-sm text-slate-500">
    {children}
  </p>
);

const Table = ({
  children,
  minWidth = "min-w-[760px]",
}: {
  children: ReactNode;
  minWidth?: string;
}) => (
  <div className={tableWrap}>
    <table className={`w-full ${minWidth} text-left text-xs`}>{children}</table>
  </div>
);

export const CrawlResultsTabs = ({
  result,
  runs,
  selectedRun,
  onSelectRun,
  onDeleteRun,
  mapNavigationRequest = 0,
}: CrawlResultsTabsProps) => {
  const { t } = useTranslation();
  const resultsRef = useRef<HTMLElement>(null);
  const tabScrollerRef = useRef<HTMLDivElement>(null);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const navigationRunId =
    selectedRun?.id ??
    runs.find((run) => run.result === result)?.id ??
    "current";
  const navigationStorageKey = activeProjectId
    ? `seomi_project_${activeProjectId}_crawl_navigation_${encodeURIComponent(navigationRunId)}_v1`
    : null;
  const isCheckingExternalLinks = useToolsStore(
    (state) => state.isCheckingCrawlExternalLinks,
  );
  const externalLinkCheckProgress = useToolsStore(
    (state) => state.crawlExternalLinkCheckProgress,
  );
  const externalLinkCheckError = useToolsStore(
    (state) => state.crawlExternalLinkCheckError,
  );
  const checkExternalLinks = useToolsStore(
    (state) => state.checkCrawlExternalLinks,
  );
  const isCrawling = useToolsStore((state) => state.isCrawling);
  const initialNavigation =
    readCrawlNavigationPreferences(navigationStorageKey);
  const [activeTab, setActiveTab] = useState<CrawlTab>(
    initialNavigation.activeTab,
  );
  const [activeTabGroup, setActiveTabGroup] = useState<CrawlTabGroup>(
    initialNavigation.activeTabGroup,
  );
  const [loadedNavigationKey, setLoadedNavigationKey] =
    useState(navigationStorageKey);
  const [metadataFacet, setMetadataFacet] = useState<MetadataFacet>(
    initialNavigation.metadataFacet,
  );
  const [externalLinkLimit, setExternalLinkLimit] = useState(250);
  const [severity, setSeverity] = useState<
    "all" | "Critical" | "Warning" | "Info"
  >("all");
  const [errorKind, setErrorKind] = useState("all");
  const [segment, setSegment] = useState<CrawlSegment>("all");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CrawlSort>("url");
  const [descending, setDescending] = useState(false);
  const [validationQuery, setValidationQuery] = useState(
    initialNavigation.validationQuery,
  );
  const [validationSeverity, setValidationSeverity] = useState<
    "all" | "Error" | "Warning"
  >(initialNavigation.validationSeverity);
  const [filterPresets, setFilterPresets] = useState<CrawlFilterPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [newPresetName, setNewPresetName] = useState("");
  const [comparisonRunId, setComparisonRunId] = useState("");
  const [compareByPath, setCompareByPath] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [customSearchDisplayLimit, setCustomSearchDisplayLimit] = useState(200);
  const [resourceProvenanceFilter, setResourceProvenanceFilter] =
    useState<ResourceProvenanceFilter>("all");
  const linkNavigationKey = activeProjectId
    ? `seomi_project_${activeProjectId}_crawl_links_${encodeURIComponent(navigationRunId)}_v1`
    : null;
  const initialLinkNavigation =
    readCrawlLinkNavigationPreferences(linkNavigationKey);
  const [linkQuery, setLinkQuery] = useState(initialLinkNavigation.query);
  const [linkKind, setLinkKind] = useState<CrawlLinkKindFilter>(
    initialLinkNavigation.kind,
  );
  const [linkStatus, setLinkStatus] = useState<CrawlLinkStatusFilter>(
    initialLinkNavigation.status,
  );
  const [linkSort, setLinkSort] = useState<CrawlLinkSort>(
    initialLinkNavigation.sort,
  );
  const [linkDescending, setLinkDescending] = useState(
    initialLinkNavigation.descending,
  );
  const [linkEvidence, setLinkEvidence] = useState<{
    source: string;
    target: string;
  } | null>(null);
  const [renderedArtifactUrl, setRenderedArtifactUrl] = useState(
    result.start_url,
  );
  const [renderedArtifact, setRenderedArtifact] =
    useState<RenderedPageArtifact | null>(null);
  const [renderedArtifactKind, setRenderedArtifactKind] = useState<
    "screenshot" | "pdf" | null
  >(null);
  const [renderedArtifactError, setRenderedArtifactError] = useState<
    string | null
  >(null);
  const [copiedLinkSourceKey, setCopiedLinkSourceKey] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const nextNavigation = readCrawlNavigationPreferences(navigationStorageKey);
    setActiveTab(nextNavigation.activeTab);
    setActiveTabGroup(nextNavigation.activeTabGroup);
    setMetadataFacet(nextNavigation.metadataFacet);
    setValidationQuery(nextNavigation.validationQuery);
    setValidationSeverity(nextNavigation.validationSeverity);
    setLoadedNavigationKey(navigationStorageKey);
    const nextLinks = readCrawlLinkNavigationPreferences(linkNavigationKey);
    setLinkQuery(nextLinks.query);
    setLinkKind(nextLinks.kind);
    setLinkStatus(nextLinks.status);
    setLinkSort(nextLinks.sort);
    setLinkDescending(nextLinks.descending);
  }, [linkNavigationKey, navigationStorageKey]);

  useEffect(() => {
    setResourceProvenanceFilter("all");
  }, [navigationRunId]);

  useEffect(() => {
    // A rendered artifact belongs to the selected crawl run. Never keep a
    // screenshot/PDF target or a completed artifact from the previous run
    // visible after the user switches history entries.
    setSeverity("all");
    setErrorKind("all");
    setSegment("all");
    setOnlyProblems(false);
    setEvidenceUrl("");
    setQuery("");
    setSort("url");
    setDescending(false);
    setComparisonRunId("");
    setRenderedArtifactUrl(result.start_url);
    setRenderedArtifact(null);
    setRenderedArtifactKind(null);
    setRenderedArtifactError(null);
    setPdfError(null);
    setLinkEvidence(null);
  }, [navigationRunId, result.start_url]);

  useEffect(() => {
    if (!navigationStorageKey || loadedNavigationKey !== navigationStorageKey)
      return;
    writeJsonStorage(navigationStorageKey, {
      activeTab,
      activeTabGroup,
      metadataFacet,
      validationQuery: validationQuery.slice(0, 120),
      validationSeverity,
    } satisfies CrawlNavigationPreferences);
  }, [
    activeTab,
    activeTabGroup,
    loadedNavigationKey,
    metadataFacet,
    navigationStorageKey,
    validationQuery,
    validationSeverity,
  ]);

  useEffect(() => {
    if (!linkNavigationKey) return;
    writeJsonStorage(linkNavigationKey, {
      query: linkQuery.slice(0, 160),
      kind: linkKind,
      status: linkStatus,
      sort: linkSort,
      descending: linkDescending,
    } satisfies CrawlLinkNavigationPreferences);
  }, [
    linkDescending,
    linkKind,
    linkNavigationKey,
    linkQuery,
    linkSort,
    linkStatus,
  ]);

  const allErrorRecords = [...result.pages, ...(result.resources || [])];
  const errorKinds = crawlErrorKinds(allErrorRecords);
  const activeErrorKind = errorKinds.includes(errorKind) ? errorKind : "all";
  useEffect(() => {
    setFilterPresets(activeProjectId ? loadFilterPresets(activeProjectId) : []);
    setSelectedPresetId("");
  }, [activeProjectId]);
  useEffect(() => {
    if (!activeProjectId) {
      setCompareByPath(false);
      return;
    }
    setCompareByPath(
      readStorage(`seomi_project_${activeProjectId}_crawl_compare_path_v1`) ===
        "true",
    );
  }, [activeProjectId]);
  useEffect(() => {
    if (mapNavigationRequest === 0) return;
    setActiveTab("visualisations");
    const scrollToMap = () => {
      const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)")
        ?.matches
        ? "auto"
        : "smooth";
      const mapSection = document.getElementById("crawl-map-section");
      if (mapSection) {
        mapSection.scrollIntoView?.({ behavior, block: "start" });
        return;
      }
      resultsRef.current?.scrollIntoView?.({ behavior, block: "start" });
    };
    // The map panel is mounted by the tab switch. Two frames keep the jump
    // reliable when the crawl results are long or the user is already near
    // the bottom of the document.
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(scrollToMap),
      );
    } else {
      scrollToMap();
    }
  }, [mapNavigationRequest]);
  useEffect(() => {
    const nextGroup = tabGroupForTab(activeTab);
    setActiveTabGroup((current) =>
      current === nextGroup ? current : nextGroup,
    );
    const activeButton = document.getElementById(`crawl-tab-${activeTab}`);
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)")
      ?.matches
      ? "auto"
      : "smooth";
    activeButton?.scrollIntoView?.({
      behavior,
      block: "nearest",
      inline: "center",
    });
  }, [activeTab]);
  useEffect(() => {
    const openEvidence = () => {
      const prefix = "#crawl-evidence?";
      if (!window.location.hash.startsWith(prefix)) return;
      const params = new URLSearchParams(
        window.location.hash.slice(prefix.length),
      );
      const projectId = params.get("project");
      const runId = params.get("run");
      const url = params.get("url");
      const tab = params.get("tab");
      const source = params.get("source");
      const target = params.get("target");
      if (!projectId || !runId || !url) return;
      if (projectId !== activeProjectId) {
        if (
          useProjectStore
            .getState()
            .projects.some((project) => project.id === projectId)
        ) {
          useProjectStore.getState().selectProject(projectId);
        }
        return;
      }
      const run = runs.find((candidate) => candidate.id === runId);
      if (!run) return;
      if (tab === "links" && source && target) {
        // Link evidence is a separate focus target from the page evidence
        // deep-link. Reset transient facets so the exact row cannot be
        // hidden by a stale project/run filter.
        setActiveTab("links");
        setLinkQuery("");
        setLinkKind("all");
        setLinkStatus("all");
        setLinkEvidence({ source, target });
        onSelectRun(run.id);
        return;
      }
      setActiveTab("urls");
      setSeverity("all");
      setErrorKind("all");
      setSegment("all");
      setOnlyProblems(false);
      setQuery(url);
      setEvidenceUrl(url);
      onSelectRun(run.id);
      window.requestAnimationFrame(() =>
        document
          .getElementById(`crawl-row-${encodeURIComponent(url)}`)
          ?.scrollIntoView?.({ block: "center" }),
      );
    };
    openEvidence();
    window.addEventListener("hashchange", openEvidence);
    return () => window.removeEventListener("hashchange", openEvidence);
  }, [activeProjectId, onSelectRun, runs]);
  useEffect(() => {
    if (activeTab !== "links" || !linkEvidence || typeof window === "undefined")
      return;
    const scrollToLink = () => {
      const row = Array.from(
        document.querySelectorAll<HTMLElement>("[data-crawl-link-row]"),
      ).find(
        (element) =>
          element.dataset.sourceUrl === linkEvidence.source &&
          element.dataset.targetUrl === linkEvidence.target,
      );
      row?.scrollIntoView?.({ block: "center" });
    };
    const firstFrame = window.requestAnimationFrame(() =>
      window.requestAnimationFrame(scrollToLink),
    );
    return () => window.cancelAnimationFrame(firstFrame);
  }, [activeTab, linkEvidence, navigationRunId, result.pages]);
  const pages = useMemo(
    () =>
      filterCrawlErrors(
        result.pages.filter(
          (page) =>
            severity === "all" ||
            page.issues.some((issue) => issue.severity === severity),
        ),
        activeErrorKind,
      )
        .filter((page) => {
          const status = page.http_status;
          const inSegment =
            segment === "all" ||
            (segment === "transport" && Boolean(page.request_error_kind)) ||
            (segment === "2xx" && status >= 200 && status < 300) ||
            (segment === "3xx" && status >= 300 && status < 400) ||
            (segment === "4xx" && status >= 400 && status < 500) ||
            (segment === "5xx" && status >= 500 && status < 600);
          const needle = query.trim().toLocaleLowerCase();
          const hasProblems =
            page.issues.length > 0 ||
            Boolean(page.request_error_kind) ||
            page.http_status >= 400;
          return (
            inSegment &&
            (!onlyProblems || hasProblems) &&
            (!needle ||
              `${page.url} ${page.title || ""} ${page.http_status || ""} ${page.request_error_kind || ""}`
                .toLocaleLowerCase()
                .includes(needle))
          );
        })
        .sort((left, right) => {
          const compare =
            sort === "status"
              ? (left.http_status || 0) - (right.http_status || 0)
              : sort === "depth"
                ? left.depth - right.depth
                : sort === "responseTime"
                  ? left.response_time_ms - right.response_time_ms
                  : sort === "issues"
                    ? left.issues.length - right.issues.length
                    : (sort === "title"
                        ? left.title || ""
                        : left.url
                      ).localeCompare(
                        sort === "title" ? right.title || "" : right.url,
                        undefined,
                        { sensitivity: "base" },
                      );
          return descending ? -compare : compare;
        }),
    [
      activeErrorKind,
      descending,
      onlyProblems,
      query,
      result.pages,
      segment,
      severity,
      sort,
    ],
  );
  const resources = filterCrawlErrors(result.resources || [], activeErrorKind);
  const resourceErrorUrls = new Set(resources.map((resource) => resource.url));
  const resourceInventory = useMemo(
    () => buildCrawlResourceInventory(result),
    [result],
  );
  const visibleResourceInventory = resourceInventory.filter(
    (row) =>
      resourceErrorUrls.has(row.resource.url) &&
      (resourceProvenanceFilter === "all" ||
        row.status === resourceProvenanceFilter),
  );
  const currentRun = selectedRun || runs.find((run) => run.result === result);
  const deleteCurrentRun = async (): Promise<void> => {
    if (!currentRun || !onDeleteRun || typeof window === "undefined") return;
    const confirmed = window.confirm(t("crawl.ui.deleteRunConfirm"));
    if (!confirmed) return;
    await onDeleteRun(currentRun.id);
  };
  const baseRun = runs.find(
    (run) => run.id === comparisonRunId && run.id !== currentRun?.id,
  );
  const comparison = baseRun
    ? compareCrawlResults(result, baseRun.result, {
        matchByPath: compareByPath,
      })
    : null;
  const updateCompareByPath = (value: boolean) => {
    setCompareByPath(value);
    if (!activeProjectId) return;
    writeStorage(
      `seomi_project_${activeProjectId}_crawl_compare_path_v1`,
      String(value),
    );
  };
  const renderedArtifactUrls = Array.from(
    new Set(
      [
        result.start_url,
        ...result.pages.map((page) => page.final_url || page.url),
      ].filter(Boolean),
    ),
  );
  useEffect(() => {
    setRenderedArtifactUrl(result.start_url);
    setRenderedArtifact(null);
    setRenderedArtifactKind(null);
    setRenderedArtifactError(null);
  }, [currentRun?.id, result.start_url]);

  const createRenderedArtifact = async (
    kind: "screenshot" | "pdf",
  ): Promise<void> => {
    if (result.crawl_mode !== "browser-rendered") return;
    setRenderedArtifactKind(kind);
    setRenderedArtifactError(null);
    try {
      const config = currentRun?.config;
      const artifact = await captureRenderedArtifact({
        url: renderedArtifactUrl,
        allowSubdomains: config?.allowSubdomains ?? false,
        scopePath: config?.scopePath,
        waitForSelector: config?.renderWaitForSelector,
        waitDelayMs: config?.renderWaitDelayMs,
        lazyScrollCycles: config?.renderLazyScrollCycles,
        kind,
        runId: currentRun?.id,
      });
      setRenderedArtifact(artifact);
      downloadRenderedArtifact(artifact);
    } catch (error) {
      setRenderedArtifactError(
        error instanceof Error
          ? error.message
          : t("crawl.ui.renderArtifactError"),
      );
    } finally {
      setRenderedArtifactKind(null);
    }
  };
  const chronologicalRuns = [...runs].reverse();
  const crawledUrlSet = new Set(
    result.pages.flatMap((page) => [page.url, page.final_url]),
  );
  const sitemapOnlyCount = result.sitemap_urls.filter(
    (url) => !crawledUrlSet.has(url),
  ).length;
  const crawlOnlyCount = result.pages.filter(
    (page) => !result.sitemap_urls.includes(page.url),
  ).length;
  const metadataRows = result.pages
    .filter(
      (page) =>
        !page.content_type ||
        page.content_type.toLocaleLowerCase().includes("html"),
    )
    .map((page) => ({
      page,
      facets: metadataFacetsForPage(page),
    }));
  const filteredMetadataRows = metadataRows.filter(({ facets }) =>
    metadataFacet === "all" ? true : facets.includes(metadataFacet),
  );
  const metadataFacetCounts = metadataFacetOptions.reduce<
    Record<MetadataFacet, number>
  >(
    (counts, facet) => {
      counts[facet.id] =
        facet.id === "all"
          ? metadataRows.length
          : metadataRows.filter(({ facets }) => facets.includes(facet.id))
              .length;
      return counts;
    },
    {} as Record<MetadataFacet, number>,
  );

  const tabCounts: Record<CrawlTab, number> = {
    overview: result.pages_crawled,
    crawlerReadiness: result.pages.length,
    urls: result.pages.length,
    issues: result.pages.reduce((count, page) => count + page.issues.length, 0),
    content: result.pages.filter(
      (page) => page.content_hash || page.title || page.meta_description,
    ).length,
    metadata: metadataRows.filter(({ facets }) => facets.length > 0).length,
    customSearch: result.pages.reduce(
      (total, page) =>
        total +
        (page.custom_search_results || []).reduce(
          (count, item) => count + item.values.length,
          0,
        ),
      0,
    ),
    links: result.pages.reduce((count, page) => count + page.links.length, 0),
    media:
      result.pages.reduce((count, page) => count + page.images.length, 0) +
      (result.resources?.length || 0),
    frames: result.pages.reduce(
      (count, page) => count + (page.frames?.length || 0),
      0,
    ),
    social: result.pages.filter(
      (page) =>
        (page.favicons?.length || page.favicon_metadata?.length || 0) > 0 ||
        (page.social_meta_tags?.length || 0) > 0,
    ).length,
    directives: result.pages.length,
    international: result.pages.filter(
      (page) => page.document_language || page.hreflangs.length || page.amp_url,
    ).length,
    structured: result.pages.filter(
      (page) =>
        page.schema_types.length ||
        page.schema_syntax_errors > 0 ||
        Boolean(page.schema_validation_findings?.length),
    ).length,
    validation: result.pages.reduce(
      (count, page) => count + (page.html_validation_findings?.length || 0),
      0,
    ),
    performance: result.pages.filter((page) =>
      Number.isFinite(page.response_time_ms),
    ).length,
    visualisations: result.pages.length,
    exports: currentRun ? 9 : 0,
  };

  const localizedTabLabel = (tab: (typeof tabs)[number]): string =>
    t(`crawl.${tab.labelKey}`);
  const localizedGroupLabel = (group: (typeof tabGroups)[number]): string =>
    t(`crawl.${group.labelKey}`);
  const localizedGroupShortLabel = (
    group: (typeof tabGroups)[number],
  ): string => t(`crawl.${group.shortLabelKey}`);
  const localizedFacetLabel = (
    facet: (typeof metadataFacetOptions)[number],
  ): string => t(`crawl.metadataFacets.${facet.labelKey}`);
  const localizedFacetDescription = (
    facet: (typeof metadataFacetOptions)[number],
  ): string => t(`crawl.metadataFacets.${facet.descriptionKey}`);
  const activeTabMeta = tabs.find((tab) => tab.id === activeTab) || tabs[0];
  const activeGroupMeta =
    tabGroups.find((group) => group.id === activeTabGroup) || tabGroups[0];
  const copyLinkSource = async (key: string, source: string) => {
    const copied = await copyText(source);
    if (!copied) return;
    setCopiedLinkSourceKey(key);
    window.setTimeout(
      () =>
        setCopiedLinkSourceKey((current) => (current === key ? null : current)),
      1600,
    );
  };
  const scrollTabStrip = (direction: "left" | "right" | "start" | "end") => {
    const scroller = tabScrollerRef.current;
    if (!scroller) return;
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)")
      ?.matches
      ? "auto"
      : "smooth";
    if (direction === "start" || direction === "end") {
      scroller.scrollTo?.({
        left: direction === "start" ? 0 : scroller.scrollWidth,
        behavior,
      });
      return;
    }
    scroller.scrollBy({
      left: direction === "left" ? -280 : 280,
      behavior,
    });
  };

  // Crawl results can contain very large tables and the map is intentionally
  // rendered in the same scrollable workspace. Keep explicit page anchors in
  // the sticky navigation so users never have to drag a scrollbar to recover
  // the beginning or end of a result, especially after opening a map node.
  const scrollResults = (direction: "start" | "end") => {
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)")
      ?.matches
      ? "auto"
      : "smooth";
    const scrollContainer = resultsRef.current?.closest<HTMLElement>("main");
    if (scrollContainer?.scrollTo) {
      scrollContainer.scrollTo({
        top: direction === "start" ? 0 : scrollContainer.scrollHeight,
        behavior,
      });
      return;
    }
    if (direction === "start") {
      resultsRef.current?.scrollIntoView?.({ behavior, block: "start" });
    } else {
      const lastElement = resultsRef.current?.lastElementChild;
      lastElement?.scrollIntoView?.({ behavior, block: "end" });
    }
  };

  const openMapSection = () => {
    setActiveTab("visualisations");
    const scrollToMap = () => {
      const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)")
        ?.matches
        ? "auto"
        : "smooth";
      const mapSection = document.getElementById("crawl-map-section");
      if (mapSection) {
        mapSection.scrollIntoView?.({ behavior, block: "start" });
        return;
      }
      resultsRef.current?.scrollIntoView?.({ behavior, block: "start" });
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(scrollToMap),
      );
    } else {
      scrollToMap();
    }
  };

  const selectTabByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? tabs[0] : tabs[tabs.length - 1];
      setActiveTab(next.id);
      document.getElementById(`crawl-tab-${next.id}`)?.focus();
      scrollTabStrip(event.key === "Home" ? "start" : "end");
      return;
    }
    const direction =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
    const next = tabs[(currentIndex + direction + tabs.length) % tabs.length];
    setActiveTab(next.id);
    document.getElementById(`crawl-tab-${next.id}`)?.focus();
  };

  const exportPdf = async () => {
    if (!currentRun) return;
    setPdfError(null);
    try {
      await downloadCrawlPdf(currentRun);
    } catch (error) {
      setPdfError(
        error instanceof Error ? error.message : t("crawl.ui.pdfError"),
      );
    }
  };

  const persistFilterPresets = (next: CrawlFilterPreset[]) => {
    setFilterPresets(next);
    if (activeProjectId) {
      writeJsonStorage(filterPresetsKey(activeProjectId), next);
    }
  };

  const saveFilterPreset = () => {
    const name = newPresetName.trim();
    if (!activeProjectId || !name || name.length > 60) return;
    const preset: CrawlFilterPreset = {
      id: globalThis.crypto?.randomUUID?.() || `filter-${Date.now()}`,
      name,
      severity,
      errorKind: activeErrorKind,
      segment,
      onlyProblems,
      query,
      sort,
      descending,
    };
    persistFilterPresets(
      [
        preset,
        ...filterPresets.filter(
          (item) => item.name.toLocaleLowerCase() !== name.toLocaleLowerCase(),
        ),
      ].slice(0, 30),
    );
    setSelectedPresetId(preset.id);
    setNewPresetName("");
  };

  const applyFilterPreset = (id: string) => {
    setSelectedPresetId(id);
    const preset = filterPresets.find((item) => item.id === id);
    if (!preset) return;
    setSeverity(preset.severity);
    setErrorKind(preset.errorKind);
    setSegment(preset.segment);
    setOnlyProblems(preset.onlyProblems);
    setQuery(preset.query);
    setSort(preset.sort);
    setDescending(preset.descending);
  };

  const evidenceHref = (url: string) => {
    const params = new URLSearchParams({
      project: activeProjectId || "",
      run: currentRun?.id || "",
      url,
    });
    return `#crawl-evidence?${params.toString()}`;
  };

  const linkEvidenceHref = (source: string, target: string) => {
    const params = new URLSearchParams({
      project: activeProjectId || "",
      run: currentRun?.id || "",
      url: source,
      tab: "links",
      source,
      target,
    });
    return `#crawl-evidence?${params.toString()}`;
  };

  const historyValue = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const historyMetrics = [
    {
      label: t("crawl.ui.processedUrls"),
      values: chronologicalRuns.map((run) =>
        historyValue(run.result.pages_crawled),
      ),
      colour: "text-emerald-300",
    },
    {
      label: t("crawl.ui.criticalIssues"),
      values: chronologicalRuns.map((run) =>
        historyValue(run.result.critical_count),
      ),
      colour: "text-rose-300",
    },
    {
      label: t("crawl.ui.warnings"),
      values: chronologicalRuns.map((run) =>
        historyValue(run.result.warning_count),
      ),
      colour: "text-amber-300",
    },
    {
      label: t("crawl.ui.successStatuses"),
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
      label: t("crawl.ui.indexable"),
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
      label: t("crawl.ui.contentWords"),
      values: chronologicalRuns.map((run) =>
        historyValue(
          run.result.pages.reduce((total, page) => total + page.word_count, 0),
        ),
      ),
      colour: "text-cyan-300",
    },
  ];

  const summaryRows = (
    <>
      <tr>
        <th className={cell}>{t("crawl.ui.address")}</th>
        <td className={`${cell} break-all font-mono text-slate-300`}>
          {result.start_url}
        </td>
      </tr>
      <tr>
        <th className={cell}>{t("crawl.ui.healthScore")}</th>
        <td className={`${cell} font-mono text-white`}>
          {result.health_score} / 100
        </td>
      </tr>
      <tr>
        <th className={cell}>{t("crawl.ui.processedUrls")}</th>
        <td className={`${cell} font-mono text-slate-300`}>
          {result.pages_crawled}
        </td>
      </tr>
      {result.discovery_provenance_truncated ? (
        <tr>
          <th className={cell}>{t("crawl.ui.provenance")}</th>
          <td className={`${cell} text-amber-200`}>
            {t("crawl.ui.provenanceTruncated")}
          </td>
        </tr>
      ) : null}
      {result.limit_reasons?.length ? (
        <tr>
          <th className={cell}>{t("crawl.ui.limitReasons")}</th>
          <td className={`${cell} text-amber-200`}>
            {t("crawl.ui.limitReasonsValue", {
              reasons: result.limit_reasons.join(", "),
            })}
          </td>
        </tr>
      ) : null}
      <tr>
        <th className={cell}>{t("crawl.ui.issues")}</th>
        <td className={`${cell} text-slate-300`}>
          {t("crawl.ui.issueSummary", {
            critical: result.critical_count,
            warnings: result.warning_count,
            notices: result.notice_count,
          })}
        </td>
      </tr>
      <tr>
        <th className={cell}>{t("crawl.ui.runDuration")}</th>
        <td className={`${cell} font-mono text-slate-300`}>
          {formatNumber(result.duration_ms)} {t("performance.milliseconds")}
        </td>
      </tr>
      <tr>
        <th className={cell}>{t("crawl.ui.robotsTxt")}</th>
        <td className={`${cell} text-slate-300`}>
          {t("crawl.ui.robotsSummary", {
            status: result.robots_txt_status,
            blocked: result.robots_blocked_count,
          })}
        </td>
      </tr>
      <tr>
        <th className={cell}>{t("crawl.ui.robotsUserAgent")}</th>
        <td className={`${cell} break-all font-mono text-slate-300`}>
          {result.robots_user_agent || t("crawl.ui.noDataOlderRun")}
        </td>
      </tr>
      <tr>
        <th className={cell}>{t("crawl.ui.robotsRules")}</th>
        <td className={`${cell} text-slate-300`}>
          {result.robots_applicable_rules?.length ? (
            <ul className="space-y-1">
              {result.robots_applicable_rules.map((rule, index) => (
                <li
                  key={`${rule.directive}-${rule.path}-${index}`}
                  className="font-mono"
                >
                  {rule.directive.toUpperCase()}: {rule.path}
                </li>
              ))}
            </ul>
          ) : (
            t("crawl.ui.noRulesOlderRun")
          )}
        </td>
      </tr>
      {result.robots_agent_matrix?.length ? (
        <tr>
          <th className={cell}>{t("crawl.ui.robotsUserAgent")}</th>
          <td className={`${cell} text-slate-300`}>
            <ul className="space-y-2">
              {result.robots_agent_matrix.map((agent) => (
                <li key={agent.user_agent} className="rounded border border-slate-800 bg-slate-950/40 p-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-slate-200">{agent.user_agent}</span>
                    <span className="text-slate-500">{agent.applicable_rules.length} {t("crawl.ui.robotsRules").toLocaleLowerCase()}</span>
                    <span className={agent.specific_group ? "text-emerald-300" : "text-slate-500"}>
                      {agent.specific_group ? "✓" : "*"}
                    </span>
                    {agent.crawl_delay_ms != null ? <span className="font-mono text-slate-500">{agent.crawl_delay_ms} {t("performance.milliseconds")}</span> : null}
                  </div>
                  {agent.applicable_rules.length ? (
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[10px] text-slate-500">
                      {agent.applicable_rules.slice(0, 12).map((rule, index) => <span key={`${agent.user_agent}-${rule.directive}-${rule.path}-${index}`}>{rule.directive.toUpperCase()}: {rule.path}</span>)}
                      {agent.applicable_rules.length > 12 ? <span>+{agent.applicable_rules.length - 12}</span> : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
      <tr>
        <th className={cell}>{t("crawl.ui.robotsSitemap")}</th>
        <td className={`${cell} text-slate-300`}>
          {result.robots_sitemap_directives?.length ? (
            <ul className="space-y-1">
              {result.robots_sitemap_directives.map((url, index) => (
                <li key={`${url}-${index}`} className="break-all font-mono">
                  {url}
                </li>
              ))}
            </ul>
          ) : (
            t("crawl.ui.noDeclarationsOlderRun")
          )}
        </td>
      </tr>
      <tr>
        <th className={cell}>{t("crawl.ui.sitemapXml")}</th>
        <td className={`${cell} text-slate-300`}>
          {t("crawl.ui.sitemapSummary", {
            status: result.sitemap_status,
            count: result.sitemap_urls_discovered,
          })}
        </td>
      </tr>
      {result.sitemap_urls_discovered > 0 && (
        <tr>
          <th className={cell}>{t("crawl.ui.sitemapComparison")}</th>
          <td className={`${cell} text-slate-300`}>
            {t("crawl.ui.sitemapComparisonValue", {
              sitemapOnly: sitemapOnlyCount,
              crawlOnly: crawlOnlyCount,
            })}
          </td>
        </tr>
      )}
      <tr>
        <th className={cell}>{t("crawl.ui.links")}</th>
        <td className={`${cell} text-slate-300`}>
          {result.pages.reduce(
            (total, page) => total + page.internal_link_count,
            0,
          )}{" "}
          {t("crawl.ui.internalLinks")} ·{" "}
          {result.pages.reduce(
            (total, page) => total + page.external_link_count,
            0,
          )}{" "}
          {t("crawl.ui.externalLinks")}
        </td>
      </tr>
      {result.cancelled && (
        <tr>
          <th className={`${cell} text-amber-300`}>
            {t("crawl.ui.cancelled")}
          </th>
          <td className={`${cell} text-amber-200`}>
            {t("crawl.ui.cancelledValue")}
          </td>
        </tr>
      )}
      {result.timed_out && (
        <tr>
          <th className={`${cell} text-amber-300`}>{t("crawl.ui.timedOut")}</th>
          <td className={`${cell} text-amber-200`}>
            {t("crawl.ui.timedOutValue")}
          </td>
        </tr>
      )}
    </>
  );

  const renderPageTable = (rows: CrawledPageSummary[]) =>
    rows.length ? (
      <Table minWidth="min-w-[1040px]">
        <thead className={tableHead}>
          <tr>
            {[
              ["status", t("crawl.ui.status")],
              ["url", t("crawl.ui.url")],
              ["source", t("crawl.ui.source")],
              ["title", t("crawl.ui.title")],
              ["depth", t("crawl.ui.depth")],
              ["h1", t("uiUnits.headingLevel", { level: 1 })],
              ["words", t("crawl.ui.words")],
              ["complexity", t("crawl.ui.complexity")],
              ["readability", t("crawl.ui.readability")],
              [
                "timing",
                result.crawl_mode === "browser-rendered"
                  ? t("crawl.ui.navigation")
                  : t("crawl.ui.httpTime"),
              ],
              ["issues", t("crawl.ui.issues")],
              ["redirects", t("crawl.ui.redirects")],
            ].map(([column, label]) => {
              const key = (
                {
                  status: "status",
                  url: "url",
                  title: "title",
                  depth: "depth",
                  timing: "responseTime",
                  issues: "issues",
                } as Partial<Record<string, CrawlSort>>
              )[column];
              return (
                <th
                  key={column}
                  className={cell}
                  aria-sort={
                    key
                      ? sort === key
                        ? descending
                          ? "descending"
                          : "ascending"
                        : "none"
                      : undefined
                  }
                >
                  {key ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (sort === key) setDescending((value) => !value);
                        else {
                          setSort(key);
                          setDescending(false);
                        }
                      }}
                      className="font-semibold hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      {label}
                      {sort === key ? (descending ? " ↓" : " ↑") : ""}
                    </button>
                  ) : (
                    label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((page) => (
            <tr
              key={page.url}
              id={`crawl-row-${encodeURIComponent(page.url)}`}
              className={`border-t border-slate-800/80 text-slate-300 ${evidenceUrl === page.url ? "bg-emerald-500/10 ring-1 ring-inset ring-emerald-400/40" : ""}`}
            >
              <td className={cell}>
                <span
                  className={
                    page.request_error_kind || page.http_status >= 400
                      ? "text-rose-300"
                      : "text-emerald-300"
                  }
                  title={
                    page.request_error_kind
                      ? `${crawlErrorLabel(page.request_error_kind)} (${page.request_error_kind})`
                      : undefined
                  }
                >
                  {page.http_status ||
                    (page.request_error_kind
                      ? crawlErrorLabel(page.request_error_kind)
                      : "—")}
                </span>
                {page.request_error_kind && (
                  <span className="ml-1 font-mono text-[10px] text-rose-300/70">
                    ({page.request_error_kind})
                  </span>
                )}
              </td>
              <td
                className={`${cell} max-w-[360px] truncate font-mono`}
                title={page.url}
              >
                {activeProjectId && currentRun ? (
                  <a
                    href={evidenceHref(page.url)}
                    className="text-emerald-200 underline decoration-emerald-500/40 underline-offset-2 hover:text-white"
                    aria-label={t("crawl.ui.openEvidence", { url: page.url })}
                  >
                    {page.url}
                  </a>
                ) : (
                  page.url
                )}
              </td>
              <td className={`${cell} max-w-64`}>
                {discoverySourcesForPage(page).length ? (
                  <div className="space-y-1 text-[10px]">
                    {discoverySourcesForPage(page)
                      .slice(0, 2)
                      .map((source, index) => (
                        <div
                          key={`${source.kind}-${source.source_url || "none"}-${index}`}
                        >
                          <span className="font-medium text-sky-200">
                            {t(`mapUi.discovery.${source.kind}`)}
                          </span>
                          {source.source_url && (
                            <span
                              className="ml-1 break-all font-mono text-slate-500"
                              title={source.source_url}
                            >
                              ← {source.source_url}
                            </span>
                          )}
                          {source.anchor_text && (
                            <span
                              className="block truncate text-slate-400"
                              title={source.anchor_text}
                            >
                              „{source.anchor_text}”
                            </span>
                          )}
                        </div>
                      ))}
                    {discoverySourcesForPage(page).length > 2 && (
                      <span className="text-slate-500">
                        {t("crawl.ui.moreSources", {
                          count: discoverySourcesForPage(page).length - 2,
                        })}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-[10px] text-slate-600">
                    {t("crawl.ui.notSavedRun")}
                  </span>
                )}
              </td>
              <td className={`${cell} max-w-56 truncate`} title={page.title ?? undefined}>
                {page.title || "—"}
              </td>
              <td className={`${cell} text-center font-mono`}>{page.depth}</td>
              <td className={`${cell} text-center font-mono`}>
                {page.h1_count}
              </td>
              <td
                className={`${cell} text-right font-mono`}
                title={
                  page.sentence_count == null
                    ? undefined
                    : t("crawlDeepUi.sentenceCount", { count: page.sentence_count })
                }
              >
                {page.word_count}
              </td>
              <td className={`${cell} text-right font-mono`}>
                {page.complexity_score == null
                  ? "—"
                  : `${page.complexity_score}/100`}
                {page.complexity_label ? (
                  <span className="ml-1 text-[10px] text-slate-500">
                    {page.complexity_label}
                  </span>
                ) : null}
              </td>
              <td
                className={`${cell} text-right font-mono`}
                title={
                  page.readability_grade == null
                    ? undefined
                    : `${t("crawl.ui.grade")} ${page.readability_grade.toFixed(1)}${page.readability_method ? ` · ${t("crawl.ui.formula")} ${page.readability_method}` : ""}`
                }
              >
                {page.readability_ease_score == null
                  ? "—"
                  : `${page.readability_ease_score.toFixed(0)}/100`}
                {page.readability_label ? (
                  <span className="ml-1 text-[10px] text-slate-500">
                    {page.readability_label}
                  </span>
                ) : null}
              </td>
              <td className={`${cell} text-right font-mono`}>
                {page.response_time_ms} {t("performance.milliseconds")}
              </td>
              <td className={`${cell} text-right font-mono`}>
                {page.issues.length}
              </td>
              <td className={cell}>
                <details open={evidenceUrl === page.url}>
                  <summary className="cursor-pointer text-emerald-200">
                    {evidenceUrl === page.url
                      ? t("crawl.ui.pageEvidence")
                      : t("crawl.ui.showEvidence")}
                  </summary>
                  <div className="mt-2 min-w-56 space-y-1.5 text-[11px] text-slate-400">
                    <p>
                      {t("crawl.ui.status")}:{" "}
                      <span className="font-mono text-slate-200">
                        {page.http_status ||
                          (page.request_error_kind
                            ? crawlErrorLabel(page.request_error_kind)
                            : undefined) ||
                          t("crawl.ui.noResponse")}
                      </span>{" "}
                      · {t("crawl.ui.depth")} {page.depth} ·{" "}
                      {t("crawl.ui.response")} {page.response_time_ms} {t("performance.milliseconds")}
                    </p>
                    {page.request_error_kind && (
                      <p>
                        {t("crawl.ui.transport")}:{" "}
                        <span className="text-rose-200">
                          {crawlErrorLabel(page.request_error_kind)}
                        </span>{" "}
                        <span className="font-mono text-slate-400">
                          ({page.request_error_kind})
                        </span>
                      </p>
                    )}
                    <p>
                      {t("crawl.ui.finalUrl")}:{" "}
                      <span className="break-all font-mono text-slate-300">
                        {page.final_url || page.url}
                      </span>
                    </p>
                    <p>
                      {t("crawl.ui.indexability")}:{" "}
                      {page.indexability_status || t("crawl.ui.notDetermined")}
                      {page.canonical ? ` · canonical: ${page.canonical}` : ""}
                    </p>
                    {page.indexability_verdict ? (
                      <p className="text-slate-400">
                        {t("crawl.ui.indexabilityVerdict")}: {page.indexability_verdict.status}
                        {page.indexability_verdict.reasons.length
                          ? ` · ${page.indexability_verdict.reasons.join(", ")}`
                          : ""}
                      </p>
                    ) : null}
                    {(page.sentence_count != null ||
                      page.complexity_score != null) && (
                      <p>
                        {t("crawl.ui.content")} {page.word_count}{" "}
                        {t("crawl.ui.words")}
                        {page.sentence_count != null
                          ? ` · ${page.sentence_count} ${t("crawl.ui.sentences")}`
                          : ""}
                        {page.average_words_per_sentence != null
                          ? ` · ${page.average_words_per_sentence.toFixed(1)} ${t("crawl.ui.wordsPerSentence")}`
                          : ""}
                        {page.complexity_score != null
                          ? ` · ${t("crawl.ui.complexity")} ${page.complexity_score}/100${page.complexity_label ? ` (${page.complexity_label})` : ""}`
                          : ""}
                        {page.readability_ease_score != null
                          ? ` · ${t("crawl.ui.readability")} ${page.readability_ease_score.toFixed(0)}/100${page.readability_grade != null ? ` · ${t("crawl.ui.grade")} ${page.readability_grade.toFixed(1)}` : ""}`
                          : ""}
                      </p>
                    )}
                    {page.focus_phrase && (
                      <p>
                        {t("crawl.ui.focusPhrase", {
                          phrase: page.focus_phrase.phrase,
                          body: page.focus_phrase.body_occurrences,
                          density:
                            page.focus_phrase.body_density_percent.toFixed(1),
                          title: page.focus_phrase.title_occurrences,
                          meta: page.focus_phrase.meta_description_occurrences,
                          h1: page.focus_phrase.h1_occurrences,
                        })}
                      </p>
                    )}
                    {discoverySourcesForPage(page).length > 0 && (
                      <div className="space-y-1 border-t border-slate-800 pt-1.5">
                        <p className="font-medium text-sky-200">
                          {t("crawl.ui.urlDiscovery")}
                        </p>
                        {discoverySourcesForPage(page).map((source, index) => (
                          <p
                            key={`${source.kind}-${source.source_url || "none"}-${index}`}
                            className="break-all"
                          >
                            <span className="text-sky-200">
                              {t(`crawl.discovery.${source.kind}`)}
                            </span>
                            {source.source_url ? ` · ${source.source_url}` : ""}
                            {source.anchor_text
                              ? ` · anchor: „${source.anchor_text}”`
                              : ""}
                          </p>
                        ))}
                      </div>
                    )}
                    {page.issues.length ? (
                      <ul className="list-inside list-disc space-y-1 text-amber-200">
                        {page.issues.map((issue, index) => (
                          <li key={`${issue.severity}-${index}`}>
                            <span className="font-semibold">
                              {t(`crawl.ui.severityValues.${issue.severity.toLowerCase()}`)}:
                            </span>{" "}
                            {localizeCrawlIssue(issue, t).displayMessage}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>{t("crawl.ui.noIssuesForUrl")}</p>
                    )}
                    {page.redirect_chain.length > 0 && (
                      <div className="space-y-1 border-t border-slate-800 pt-1.5">
                        {page.redirect_chain.map((hop, index) => (
                          <p
                            key={`${hop.from_url}-${index}`}
                            className="break-all"
                          >
                            <span className="font-mono text-amber-300">
                              {t("exportUi.statuses.http", { status: hop.http_status })}
                            </span>{" "}
                            · {hop.from_url} → {hop.to_url}
                            {hop.response_time_ms == null
                              ? ` · ${t("exportUi.statuses.timingUnavailable")}`
                              : ` · ${hop.response_time_ms} ${t("performance.milliseconds")}`}
                          </p>
                        ))}
                      </div>
                    )}
                    {page.redirect_stop_reason ? (
                      <p className="border-t border-slate-800 pt-1.5 text-amber-200">
                        <span className="font-medium">{t("crawl.ui.redirectStopReason")}:</span>{" "}
                        {page.redirect_stop_reason}
                      </p>
                    ) : null}
                  </div>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    ) : (
      <Empty>{t("crawl.ui.noUrlsForFilters")}</Empty>
    );

  const renderContent = () => {
    switch (activeTab) {
      case "overview":
        return (
          <div className="space-y-4">
            <Table minWidth="min-w-[520px]">
              <tbody>{summaryRows}</tbody>
            </Table>
            {(result.rejected_urls?.length || 0) > 0 && (
              <details className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                <summary className="cursor-pointer font-medium">
                  {t("siteAudit.rejectedUrls", {
                    count: result.rejected_urls?.length || 0,
                  })}
                </summary>
                <ul className="mt-2 max-h-48 space-y-1 overflow-auto font-mono text-[11px] text-slate-300">
                  {result.rejected_urls?.map((item) => (
                    <li key={`${item.url}-${item.reason}`}>
                      {item.url} — {item.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="text-[11px] text-slate-500">
              {t("crawl.ui.savedHttpValues")}
            </p>
          </div>
        );
      case "crawlerReadiness":
        return <CrawlerReadinessPanel result={result} />;
      case "urls":
        return (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs text-slate-400">
                {t("crawl.ui.searchUrlTitle")}
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("crawl.ui.searchLinkPlaceholder")}
                  className="mt-1 h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400"
                />
              </label>
              <label className="text-xs text-slate-400">
                {t("crawl.ui.httpSegment")}
                <select
                  value={segment}
                  onChange={(event) =>
                    setSegment(event.target.value as CrawlSegment)
                  }
                  className="mt-1 h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400"
                >
                  <option value="all">{t("legacyUi.overview.allStatuses")}</option>
                  <option value="2xx">{t("crawl.ui.successStatuses")}</option>
                  <option value="3xx">{t("crawl.ui.redirects")}</option>
                  <option value="4xx">{t("crawl.ui.errorKinds.http")}</option>
                  <option value="5xx">{t("crawl.ui.errorKinds.http")}</option>
                  <option value="transport">
                    {t("crawl.ui.transport")}
                  </option>
                </select>
              </label>
              <label className="text-xs text-slate-400">
                {t("crawlDeepUi.sortBy")}
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as CrawlSort)}
                  className="mt-1 h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400"
                >
                  <option value="url">{t("crawl.ui.url")}</option>
                  <option value="status">{t("crawl.ui.httpStatusLabel")}</option>
                  <option value="title">{t("crawl.ui.title")}</option>
                  <option value="depth">{t("crawl.ui.depth")}</option>
                  <option value="responseTime">
                    {t("crawl.ui.responseTime")}
                  </option>
                  <option value="issues">{t("crawl.ui.issueCount")}</option>
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setDescending((value) => !value)}
                  aria-pressed={descending}
                  className="h-8 rounded-md border border-slate-700 px-2.5 text-xs text-slate-300 hover:border-emerald-400/50"
                >
                  {descending
                    ? `${t("crawl.ui.descending")} ↓`
                    : `${t("crawl.ui.ascending")} ↑`}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={onlyProblems}
                  onChange={(event) => setOnlyProblems(event.target.checked)}
                  className="accent-emerald-400"
                />
                {t("crawl.ui.onlyProblems")}
              </label>
              <span className="text-xs text-slate-400">
                {t("crawl.ui.severity")}:
              </span>
              {(["all", "Critical", "Warning", "Info"] as const).map(
                (value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSeverity(value)}
                    aria-pressed={severity === value}
                    className={`rounded-md px-2.5 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${severity === value ? "bg-emerald-500/20 font-medium text-emerald-300" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}
                  >
                    {value === "all"
                      ? t("crawl.ui.all")
                      : t(`crawl.ui.severityValues.${value.toLowerCase()}`)}
                  </button>
                ),
              )}
              <label className="ml-auto flex items-center gap-2 text-xs text-slate-400">
                {t("crawl.ui.errorType")}
                <select
                  aria-label={t("crawl.ui.errorTypeAria")}
                  value={activeErrorKind}
                  onChange={(event) => setErrorKind(event.target.value)}
                  className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400"
                >
                  <option value="all">{t("crawl.ui.all")}</option>
                  {errorKinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {crawlErrorLabel(kind)}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-xs text-slate-500">
                {pages.length} / {result.pages.length}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2">
              <label className="text-xs text-slate-400">
                {t("crawl.ui.projectFilters")}
                <select
                  aria-label={t("crawl.ui.savedProjectFilters")}
                  value={selectedPresetId}
                  onChange={(event) => applyFilterPreset(event.target.value)}
                  className="ml-2 h-8 max-w-56 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                >
                  <option value="">{t("crawl.ui.notSaved")}</option>
                  {filterPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
              <input
                aria-label={t("crawl.ui.savedFilterName")}
                value={newPresetName}
                onChange={(event) => setNewPresetName(event.target.value)}
                maxLength={60}
                placeholder={t("crawl.ui.newFilterName")}
                className="h-8 min-w-40 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
              />
              <button
                type="button"
                disabled={!activeProjectId || !newPresetName.trim()}
                onClick={saveFilterPreset}
                className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white disabled:opacity-40"
              >
                {t("crawl.ui.saveFilter")}
              </button>
              {selectedPresetId && (
                <button
                  type="button"
                  onClick={() => {
                    persistFilterPresets(
                      filterPresets.filter(
                        (preset) => preset.id !== selectedPresetId,
                      ),
                    );
                    setSelectedPresetId("");
                  }}
                  className="h-8 rounded-md border border-slate-700 px-2.5 text-xs text-slate-300"
                >
                  {t("crawl.ui.removeFilter")}
                </button>
              )}
              {!activeProjectId && (
                <span className="text-[11px] text-amber-300">
                  {t("crawl.ui.chooseProjectForFilters")}
                </span>
              )}
            </div>
            {renderPageTable(pages)}
          </div>
        );
      case "issues": {
        const issues = result.pages.flatMap((page) =>
          page.issues.map((issue, index) => ({
            page,
            issue,
            key: `${page.url}-${index}`,
          })),
        );
        return issues.length ? (
          <Table minWidth="min-w-[760px]">
            <thead className={tableHead}>
              <tr>
                <th className={cell}>{t("crawl.ui.severity")}</th>
                <th className={cell}>{t("crawl.ui.problem")}</th>
                <th className={cell}>{t("crawl.ui.url")}</th>
              </tr>
            </thead>
            <tbody>
              {issues.map(({ page, issue, key }) => (
                <tr key={key} className="border-t border-slate-800/80">
                  <td
                    className={`${cell} ${issue.severity === "Critical" ? "text-rose-300" : issue.severity === "Warning" ? "text-amber-300" : "text-slate-400"}`}
                  >
                    {t(`crawl.ui.severityValues.${issue.severity.toLowerCase()}`)}
                  </td>
                  <td className={`${cell} text-slate-200`}>
                    {localizeCrawlIssue(issue, t).displayMessage}
                  </td>
                  <td
                    className={`${cell} max-w-[360px] truncate font-mono text-slate-400`}
                    title={page.url}
                  >
                    {page.url}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>{t("crawl.ui.noIssues")}</Empty>
        );
      }
      case "content":
        return (
          <Table minWidth="min-w-[1480px]">
            <caption className="caption-top p-3 text-left text-[11px] leading-5 text-slate-500">
              {t("crawl.ui.contentHeuristicNote")}
            </caption>
            <thead className={tableHead}>
              <tr>
                {[
                  t("crawl.ui.url"),
                  t("crawl.ui.title"),
                  t("crawl.ui.metaDescription"),
                  t("crawl.ui.words"),
                  t("crawl.ui.sentences"),
                  t("crawl.ui.textHtml"),
                  t("crawl.ui.complexity"),
                  t("crawl.ui.readability"),
                  t("crawl.ui.topTerms"),
                  t("crawl.ui.focusPhraseLabel"),
                  t("crawl.ui.language"),
                  t("crawl.ui.duplicateHeadings"),
                  t("crawl.ui.fingerprint"),
                ].map((label) => (
                  <th key={label} className={cell}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.pages.map((page) => (
                <tr
                  key={page.url}
                  className="border-t border-slate-800/80 text-slate-300"
                >
                  <td
                    className={`${cell} max-w-64 truncate font-mono`}
                    title={page.url}
                  >
                    {page.url}
                  </td>
                  <td
                    className={`${cell} max-w-48 truncate`}
                    title={page.title ?? undefined}
                  >
                    {page.title || "—"}
                  </td>
                  <td
                    className={`${cell} max-w-56 truncate`}
                    title={page.meta_description ?? undefined}
                  >
                    {page.meta_description || "—"}
                  </td>
                  <td className={`${cell} text-right font-mono`}>
                    {page.word_count}
                  </td>
                  <td className={`${cell} text-right font-mono`}>
                    {page.sentence_count ?? "—"}
                  </td>
                  <td className={`${cell} text-right font-mono`}>
                    {optional(page.text_ratio_percent)}
                    {page.text_ratio_percent != null ? "%" : ""}
                  </td>
                  <td className={`${cell} text-right font-mono`}>
                    {page.complexity_score == null
                      ? "—"
                      : `${page.complexity_score}/100`}
                    {page.complexity_label ? (
                      <span className="ml-1 text-[10px] text-slate-500">
                        {page.complexity_label}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={`${cell} text-right font-mono`}
                    title={
                      page.readability_method
                        ? `${t("crawl.ui.formula")}: ${page.readability_method}`
                        : undefined
                    }
                  >
                    {page.readability_ease_score == null
                      ? "—"
                      : `${page.readability_ease_score.toFixed(0)}/100`}
                    {page.readability_label ? (
                      <span className="ml-1 text-[10px] text-slate-500">
                        {page.readability_label}
                      </span>
                    ) : null}
                  </td>
                  <td className={`${cell} max-w-80 text-[11px]`}>
                    {page.content_terms?.length
                      ? page.content_terms
                          .slice(0, 8)
                          .map(
                            (term) =>
                              `${term.term} ${term.density_percent.toFixed(1)}%`,
                          )
                          .join(" · ")
                      : "—"}
                  </td>
                  <td className={`${cell} max-w-72 text-[11px]`}>
                    {page.focus_phrase
                      ? `${page.focus_phrase.phrase}: body ${page.focus_phrase.body_occurrences} (${page.focus_phrase.body_density_percent.toFixed(1)}%) · title ${page.focus_phrase.title_occurrences} · H1 ${page.focus_phrase.h1_occurrences}`
                      : "—"}
                  </td>
                  <td className={cell}>{page.document_language || "—"}</td>
                  <td className={`${cell} max-w-72`}>
                    {page.duplicate_headings?.length
                      ? page.duplicate_headings.map((heading, index) => (
                          <div
                            key={`${heading.text}-${index}`}
                            title={heading.text}
                          >
                            {heading.levels
                              .map((level) => `H${level}`)
                              .join("/")}{" "}
                            × {heading.occurrences}: {heading.text}
                          </div>
                        ))
                      : "—"}
                  </td>
                  <td className={`${cell} font-mono text-slate-500`}>
                    {page.content_hash
                      ? `${page.content_hash.slice(0, 12)}…${page.content_simhash ? ` / ${page.content_simhash}` : ""}`
                      : t("crawlDeepUi.noTextComparison")}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        );
      case "metadata":
        return (
          <div className="space-y-4">
            <section
              aria-label={t("crawl.ui.metadataFilters")}
              className="rounded-lg border border-slate-800 bg-slate-950/45 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    {t("crawl.ui.metadataReport")}
                  </h3>
                  <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">
                    {t("crawl.ui.metadataDescription")}
                  </p>
                </div>
                <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300">
                  {t("crawl.ui.urlCount", {
                    visible: filteredMetadataRows.length,
                    total: metadataRows.length,
                  })}
                </span>
              </div>
              <div
                className="mt-3 flex flex-wrap gap-1.5"
                role="group"
                aria-label={t("crawl.ui.metadataIssueFilter")}
              >
                {metadataFacetOptions.map((facet) => {
                  const selected = metadataFacet === facet.id;
                  return (
                    <button
                      key={facet.id}
                      type="button"
                      aria-pressed={selected}
                      title={localizedFacetDescription(facet)}
                      onClick={() => setMetadataFacet(facet.id)}
                      className={`rounded-md border px-2.5 py-1.5 text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${selected ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100" : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"}`}
                    >
                      {localizedFacetLabel(facet)} ·{" "}
                      {metadataFacetCounts[facet.id]}
                    </button>
                  );
                })}
              </div>
            </section>
            {filteredMetadataRows.length ? (
              <Table minWidth="min-w-[1040px]">
                <thead className={tableHead}>
                  <tr>
                    <th className={cell}>{t("crawl.ui.url")}</th>
                    <th className={cell}>{t("crawl.ui.title")}</th>
                    <th className={cell}>{t("crawl.ui.titleCharacters")}</th>
                    <th className={cell}>{t("crawl.ui.metaDescription")}</th>
                    <th className={cell}>
                      {t("crawl.ui.descriptionCharacters")}
                    </th>
                    <th className={cell}>{t("crawl.ui.signals")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMetadataRows.map(({ page, facets }) => (
                    <tr
                      key={page.url}
                      className="border-t border-slate-800/80 text-slate-300"
                    >
                      <td className={`${cell} max-w-72 break-all font-mono`}>
                        {page.url}
                      </td>
                      <td className={`${cell} max-w-64 break-words`}>
                        {typeof page.title !== "string"
                          ? t("crawl.ui.missingTag")
                          : page.title || t("crawl.ui.emptyValue")}
                      </td>
                      <td className={`${cell} whitespace-nowrap font-mono`}>
                        {page.title_length ??
                          (typeof page.title !== "string"
                            ? "—"
                            : page.title.trim().length)}
                      </td>
                      <td className={`${cell} max-w-72 break-words`}>
                        {typeof page.meta_description !== "string"
                          ? t("crawl.ui.missingTagOrData")
                          : page.meta_description || t("crawl.ui.emptyValue")}
                      </td>
                      <td className={`${cell} whitespace-nowrap font-mono`}>
                        {page.meta_description_length ??
                          (typeof page.meta_description !== "string"
                            ? "—"
                            : page.meta_description.trim().length)}
                      </td>
                      <td className={`${cell} max-w-80`}>
                        {facets.length ? (
                          <div className="flex flex-wrap gap-1">
                            {facets.map((facetId) => (
                              <span
                                key={facetId}
                                className="rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-[10px] text-amber-200"
                              >
                                {metadataFacetOptions.find(
                                  (facet) => facet.id === facetId,
                                ) &&
                                  localizedFacetLabel(
                                    metadataFacetOptions.find(
                                      (facet) => facet.id === facetId,
                                    )!,
                                  )}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-emerald-300">
                            {t("crawl.ui.noSignals")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Empty>{t("crawl.ui.noUrlsForMetadata")}</Empty>
            )}
          </div>
        );
      case "customSearch": {
        const searches = currentRun?.config.customSearches || [];
        if (searches.length === 0)
          return <Empty>{t("crawl.customSearch.notConfigured")}</Empty>;
        const rows = result.pages.flatMap((page) =>
          searches.flatMap((search) => {
            const extraction = page.custom_search_results?.find(
              (item) => item.id === search.id,
            );
            if (!extraction)
              return [
                {
                  key: `${page.url}-${search.id}-missing`,
                  url: page.url,
                  search,
                  value: t("crawl.customSearch.noResult"),
                  match: "",
                  status: t("crawl.customSearch.oldRun"),
                },
              ];
            if (extraction.error)
              return [
                {
                  key: `${page.url}-${search.id}-error`,
                  url: page.url,
                  search,
                  value: extraction.error,
                  match: "",
                  status: t("crawl.customSearch.selectorError"),
                },
              ];
            if (extraction.values.length === 0)
              return [
                {
                  key: `${page.url}-${search.id}-empty`,
                  url: page.url,
                  search,
                  value: "—",
                  match: "",
                  status: t("crawl.customSearch.noMatch"),
                },
              ];
            return extraction.values.map((value, index) => ({
              key: `${page.url}-${search.id}-${index}`,
              url: page.url,
              search,
              value,
              match: String(index + 1),
              status: extraction.truncated
                ? t("crawl.customSearch.bounded")
                : t("crawl.customSearch.ok"),
            }));
          }),
        );
        return (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  {t("crawl.customSearch.previewTitle", {
                    count: searches.length,
                  })}
                </h3>
                <p className="mt-1 text-[11px] text-slate-500">
                  {t("crawl.customSearch.previewDescription")}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  currentRun && downloadCrawlCustomSearchCsv(currentRun)
                }
                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-emerald-500/30 px-3 text-xs font-medium text-emerald-200 hover:bg-emerald-500/10"
              >
                <FileDown className="h-3.5 w-3.5" />
                {t("crawl.customSearch.export")}
              </button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {searches.map((search) => (
                <div
                  key={search.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
                >
                  <p className="text-xs font-semibold text-slate-200">
                    {search.name} · {search.resultType}
                    {search.resultType === "attribute"
                      ? ` (${search.attribute || t("crawl.customSearch.attribute")})`
                      : ""}
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-emerald-200">
                    {search.selectorType.toUpperCase()}: {search.query}
                  </p>
                </div>
              ))}
            </div>
            {rows.length === 0 ? (
              <Empty>{t("crawl.customSearch.noPages")}</Empty>
            ) : (
              <>
                <Table minWidth="min-w-[1040px]">
                  <thead className={tableHead}>
                    <tr>
                      {[
                        t("crawl.ui.url"),
                        t("crawl.customSearch.label"),
                        t("crawl.customSearch.resultType"),
                        t("crawl.ui.match"),
                        t("crawl.ui.preview"),
                        t("crawl.ui.status"),
                      ].map((label) => (
                        <th key={label} className={cell}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, customSearchDisplayLimit).map((row) => (
                      <tr
                        key={row.key}
                        className="border-t border-slate-800/80 text-slate-300"
                      >
                        <td
                          className={`${cell} max-w-64 truncate font-mono`}
                          title={row.url}
                        >
                          {row.url}
                        </td>
                        <td className={cell}>{row.search.name}</td>
                        <td className={`${cell} font-mono text-slate-400`}>
                          {row.search.selectorType.toUpperCase()} ·{" "}
                          {row.search.resultType}
                        </td>
                        <td className={`${cell} text-center font-mono`}>
                          {row.match || "—"}
                        </td>
                        <td
                          className={`${cell} max-w-[520px] whitespace-pre-wrap break-all font-mono text-[11px]`}
                          title={row.value}
                        >
                          {row.value}
                        </td>
                        <td className={`${cell} text-slate-400`}>
                          {row.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {rows.length > customSearchDisplayLimit && (
                  <button
                    type="button"
                    onClick={() =>
                      setCustomSearchDisplayLimit((limit) => limit + 200)
                    }
                    className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-emerald-400/40"
                  >
                    {t("crawl.customSearch.more", { count: rows.length })}
                  </button>
                )}
              </>
            )}
          </div>
        );
      }
      case "links": {
        const allLinks = result.pages.flatMap((page) =>
          page.links.map((link, index) => ({
            sourceUrl: page.url,
            link,
            key: `${page.url}-${link.target_url}-${index}`,
          })),
        );
        const links = filterAndSortCrawlLinks(allLinks, {
          query: linkQuery,
          kind: linkKind,
          status: linkStatus,
          sort: linkSort,
          descending: linkDescending,
        });
        const internalLinks = allLinks.filter(({ link }) => link.is_internal);
        const uniqueInternalTargets = new Set(
          internalLinks.map(({ link }) => normalizeLinkUrl(link.target_url)),
        );
        const checkedInternalTargets = new Set(
          internalLinks
            .filter(({ link }) => link.target_http_status !== undefined)
            .map(({ link }) => normalizeLinkUrl(link.target_url)),
        );
        const brokenInternalTargets = new Set(
          internalLinks
            .filter(
              ({ link }) =>
                link.target_http_status !== undefined &&
                (link.target_http_status === 0 ||
                  link.target_http_status >= 400),
            )
            .map(({ link }) => normalizeLinkUrl(link.target_url)),
        );
        const uncheckedInternalCount = Math.max(
          0,
          uniqueInternalTargets.size - checkedInternalTargets.size,
        );
        const externalLinks = allLinks.filter(({ link }) => !link.is_internal);
        const uncheckedExternalCount = new Set(
          externalLinks
            .filter(({ link }) => !link.target_checked_at)
            .map(({ link }) => normalizeLinkUrl(link.target_url)),
        ).size;
        const checkedExternalCount = new Set(
          externalLinks
            .filter(
              ({ link }) =>
                link.target_checked_at &&
                !["blocked", "invalid"].includes(
                  link.target_request_error_kind || "",
                ),
            )
            .map(({ link }) => normalizeLinkUrl(link.target_url)),
        ).size;
        const blockedExternalCount = new Set(
          externalLinks
            .filter(({ link }) => link.target_request_error_kind === "blocked")
            .map(({ link }) => normalizeLinkUrl(link.target_url)),
        ).size;
        const invalidExternalCount = new Set(
          externalLinks
            .filter(({ link }) => link.target_request_error_kind === "invalid")
            .map(({ link }) => normalizeLinkUrl(link.target_url)),
        ).size;
        const externalError = externalLinkCheckError;
        return (
          <div className="space-y-3">
            <section
              className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"
              aria-label={t("crawl.ui.linkFilters")}
            >
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid min-w-56 flex-1 gap-1 text-[11px] text-slate-400">
                  {t("crawl.ui.searchLink")}
                  <input
                    aria-label={t("crawl.ui.searchLink")}
                    value={linkQuery}
                    onChange={(event) => setLinkQuery(event.target.value)}
                    placeholder={t("crawl.ui.searchLinkPlaceholder")}
                    className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-200 outline-none focus:border-emerald-500"
                  />
                </label>
                <label className="grid gap-1 text-[11px] text-slate-400">
                  {t("crawl.ui.type")}
                  <select
                    aria-label={t("crawl.ui.linkType")}
                    value={linkKind}
                    onChange={(event) =>
                      setLinkKind(event.target.value as CrawlLinkKindFilter)
                    }
                    className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                  >
                    <option value="all">{t("crawl.ui.all")}</option>
                    <option value="internal">
                      {t("crawl.ui.internalPlural")}
                    </option>
                    <option value="external">
                      {t("crawl.ui.externalPlural")}
                    </option>
                  </select>
                </label>
                <label className="grid gap-1 text-[11px] text-slate-400">
                  {t("crawl.ui.status")}
                  <select
                    aria-label={t("crawl.ui.linkStatus")}
                    value={linkStatus}
                    onChange={(event) =>
                      setLinkStatus(event.target.value as CrawlLinkStatusFilter)
                    }
                    className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                  >
                    <option value="all">{t("crawl.ui.all")}</option>
                    <option value="unchecked">
                      {t("crawl.ui.notChecked")}
                    </option>
                    <option value="ok">{t("crawl.customSearch.ok")}</option>
                    <option value="redirect">{t("crawl.ui.redirect")}</option>
                    <option value="error">{t("crawl.ui.error")}</option>
                    <option value="blocked">
                      {t("crawl.ui.blockedInvalid")}
                    </option>
                  </select>
                </label>
                <label className="grid gap-1 text-[11px] text-slate-400">
                  {t("crawl.ui.sortBy")}
                  <select
                    aria-label={t("crawl.ui.linkSort")}
                    value={linkSort}
                    onChange={(event) =>
                      setLinkSort(event.target.value as CrawlLinkSort)
                    }
                    className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                  >
                    <option value="source">{t("crawl.ui.source")}</option>
                    <option value="target">{t("crawl.ui.target")}</option>
                    <option value="anchor">{t("crawl.ui.anchor")}</option>
                    <option value="status">{t("crawl.ui.status")}</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setLinkDescending((value) => !value)}
                  aria-pressed={linkDescending}
                  className="h-8 rounded-md border border-slate-700 px-2.5 text-[11px] text-slate-300 hover:bg-slate-800"
                >
                  {linkDescending
                    ? t("crawl.ui.descending")
                    : t("crawl.ui.ascending")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadText(
                      `seomi-crawl-links-${navigationRunId}.csv`,
                      crawlLinksCsv(links),
                      "text/csv",
                    )
                  }
                  disabled={!links.length}
                  className="h-8 rounded-md border border-slate-700 px-2.5 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                >
                  {t("crawl.ui.exportViewCsv")}
                </button>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                {t("crawl.ui.linksShown", {
                  visible: links.length,
                  total: allLinks.length,
                })}
              </p>
            </section>
            {internalLinks.length > 0 && (
              <section className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <h3 className="text-xs font-semibold text-slate-200">
                  {t("crawl.ui.internalTargetCheck")}
                </h3>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  {t("crawl.ui.internalTargetSummary", {
                    unique: uniqueInternalTargets.size,
                    checked: checkedInternalTargets.size,
                    broken: brokenInternalTargets.size,
                    unchecked: uncheckedInternalCount,
                  })}
                </p>
                {uncheckedInternalCount > 0 ? (
                  <p className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[10px] leading-4 text-amber-200">
                    {t("crawl.ui.uncheckedTargetNote")}
                  </p>
                ) : (
                  <p className="mt-2 text-[10px] text-emerald-300">
                    {t("crawl.ui.allInternalChecked")}
                  </p>
                )}
              </section>
            )}
            {externalLinks.length > 0 && (
              <section className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-slate-200">
                    {t("crawl.ui.externalTargetCheck")}
                  </h3>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">
                    {t("crawl.ui.externalTargetSummary", {
                      checked: checkedExternalCount,
                      blocked: blockedExternalCount,
                      invalid: invalidExternalCount,
                      unchecked: uncheckedExternalCount,
                    })}
                  </p>
                  {isCheckingExternalLinks && externalLinkCheckProgress && (
                    <p
                      role="status"
                      className="mt-1 max-w-xl truncate text-[11px] text-emerald-300"
                    >
                      {t("crawl.ui.liveProgress", {
                        completed: externalLinkCheckProgress.completed,
                        total: externalLinkCheckProgress.total,
                      })}{" "}
                      {externalLinkCheckProgress.currentUrl ||
                        t("crawl.ui.connecting")}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <label className="text-[11px] text-slate-400">
                    {t("crawl.ui.limit")}
                    <select
                      aria-label={t("crawl.ui.externalLinkLimit")}
                      value={externalLinkLimit}
                      onChange={(event) =>
                        setExternalLinkLimit(Number(event.target.value))
                      }
                      className="ml-2 h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                    >
                      <option value={100}>100</option>
                      <option value={250}>250</option>
                      <option value={500}>500</option>
                      <option value={1000}>1000</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={
                      !currentRun ||
                      isCheckingExternalLinks
                    }
                    onClick={() => {
                      if (!currentRun) return;
                      if (uncheckedExternalCount) {
                        void checkExternalLinks(currentRun.id, externalLinkLimit);
                      } else {
                        void checkExternalLinks(currentRun.id, externalLinkLimit, true);
                      }
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isCheckingExternalLinks && (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    )}
                    {isCheckingExternalLinks
                      ? t("crawl.ui.checking")
                      : t("crawl.ui.checkExternalLinks")}
                  </button>
                </div>
                {externalError && (
                  <p
                    role="status"
                    className="text-xs text-amber-300 sm:basis-full"
                  >
                    {externalError}
                  </p>
                )}
              </section>
            )}
            {links.length ? (
              <Table minWidth="min-w-[900px]">
                <thead className={tableHead}>
                  <tr>
                    {[
                      t("crawl.ui.sourceUrl"),
                      t("crawl.ui.type"),
                      t("crawl.ui.targetStatus"),
                      t("crawl.ui.anchor"),
                      t("crawl.ui.target"),
                      t("crawl.ui.rel"),
                    ].map((label) => (
                      <th key={label} className={cell}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {links.map(({ sourceUrl, link, key }) => {
                    const status =
                      link.target_http_status !== undefined
                        ? t("crawl.ui.httpStatus", { status: link.target_http_status })
                        : link.target_request_error_kind === "blocked"
                          ? t("crawl.ui.blockedPrivateAddress")
                          : link.target_request_error_kind === "invalid"
                            ? t("crawl.ui.invalidAddress")
                            : link.target_request_error_kind
                              ? t("crawl.ui.requestError", {
                                  kind: link.target_request_error_kind,
                                })
                              : t("crawl.ui.notChecked");
                    const hasRequestFailure = Boolean(
                      link.target_request_error_kind &&
                      link.target_request_error_kind !== "blocked",
                    );
                    return (
                      <tr
                        key={key}
                        data-crawl-link-row
                        data-source-url={sourceUrl}
                        data-target-url={link.target_url}
                        className={`border-t border-slate-800/80 text-slate-300 ${linkEvidence?.source === sourceUrl && linkEvidence.target === link.target_url ? "bg-emerald-500/10 ring-1 ring-inset ring-emerald-400/40" : ""}`}
                      >
                        <td
                          className={`${cell} max-w-72 font-mono`}
                          title={sourceUrl}
                        >
                          <a
                            href={linkEvidenceHref(sourceUrl, link.target_url)}
                            className="block truncate text-sky-200 underline-offset-2 hover:text-sky-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                            title={t("crawl.ui.openLinkEvidence")}
                          >
                            {sourceUrl}
                          </a>
                          {link.source_excerpt ? (
                            <details className="mt-1 max-w-72 font-sans">
                              <summary className="flex cursor-pointer items-center gap-1 text-[10px] text-sky-200">
                                <Code2 className="h-3 w-3" aria-hidden="true" />
                                {t("crawl.ui.showSourceCode")}
                              </summary>
                              <div className="mt-1 rounded-md border border-slate-800 bg-slate-950/80 p-2">
                                <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-4 text-slate-400">
                                  {link.source_excerpt}
                                </pre>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void copyLinkSource(
                                      key,
                                      link.source_excerpt || "",
                                    )
                                  }
                                  className="mt-1 rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-emerald-400/50 hover:text-emerald-200"
                                >
                                  {copiedLinkSourceKey === key
                                    ? t("crawl.ui.copied")
                                    : t("crawl.ui.copyCode")}
                                </button>
                              </div>
                            </details>
                          ) : (
                            <span className="text-[10px] font-sans text-slate-600">
                              {t("crawl.ui.noExcerptOlderRun")}
                            </span>
                          )}
                        </td>
                        <td className={cell}>
                          {link.is_internal
                            ? t("crawl.ui.internal")
                            : t("crawl.ui.external")}
                        </td>
                        <td
                          className={`${cell} font-mono ${(link.target_http_status !== undefined && link.target_http_status >= 400) || hasRequestFailure ? "text-rose-300" : link.target_http_status !== undefined && link.target_http_status >= 300 ? "text-amber-300" : link.target_checked_at && link.target_request_error_kind !== "blocked" ? "text-emerald-300" : "text-slate-400"}`}
                        >
                          <span>{status}</span>
                          {link.target_redirect_url && (
                            <div
                              className="mt-1 max-w-48 truncate text-[10px] text-amber-300"
                              title={link.target_redirect_url}
                            >
                              → {link.target_redirect_url}
                            </div>
                          )}
                          {link.target_response_time_ms !== undefined && (
                            <div className="mt-1 text-[10px] text-slate-500">
                              {link.target_response_time_ms} {t("performance.milliseconds")}
                            </div>
                          )}
                        </td>
                        <td
                          className={`${cell} max-w-48 truncate`}
                          title={link.anchor_text}
                        >
                          {link.anchor_text || "—"}
                        </td>
                        <td
                          className={`${cell} max-w-64 truncate font-mono`}
                          title={link.target_url}
                        >
                          {link.target_url}
                        </td>
                        <td className={cell}>{link.rel || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <Empty>{t("crawl.ui.noLinks")}</Empty>
            )}
          </div>
        );
      }
      case "media": {
        const images = result.pages.flatMap((page) =>
          page.images.map((image, index) => ({
            page,
            image,
            key: `${page.url}-${image.src}-${index}`,
          })),
        );
        return (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t("crawl.ui.imagesCount", { count: images.length })}
              </h3>
              <p className="mb-2 text-[11px] text-slate-500">
                {t("crawl.ui.imagesDescription")}
              </p>
              {images.length ? (
                <Table minWidth="min-w-[1120px]">
                  <thead className={tableHead}>
                    <tr>
                      {[
                        t("crawl.ui.sourcePage"),
                        t("crawl.ui.imageSrcset"),
                        t("crawl.ui.httpStatusLabel"),
                        t("crawl.ui.bytes"),
                        t("crawl.ui.alt"),
                        t("crawl.ui.formatHint"),
                        t("crawl.ui.dimensionsSource"),
                        t("crawl.ui.loading"),
                      ].map((label) => (
                        <th key={label} className={cell}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {images.map(({ page, image, key }) => (
                      <tr
                        key={key}
                        className="border-t border-slate-800/80 align-top text-slate-300"
                      >
                        <td
                          className={`${cell} max-w-52 truncate font-mono`}
                          title={page.url}
                        >
                          {page.url}
                        </td>
                        <td
                          className={`${cell} max-w-72 font-mono`}
                          title={image.src}
                        >
                          <p className="truncate">{image.src}</p>
                          {image.srcset_resource_checks?.length ? (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-[10px] text-emerald-200">
                                {t("uiUnits.srcsetVariants", { count: image.srcset_resource_checks.length })}
                              </summary>
                              <ul className="mt-1 space-y-1">
                                {image.srcset_resource_checks.map(
                                  (candidate, index) => (
                                    <li
                                      key={`${candidate.url}-${index}`}
                                      className="break-all text-[10px]"
                                    >
                                      <span
                                        className={
                                          candidate.request_error_kind ||
                                          (candidate.http_status &&
                                            candidate.http_status >= 400)
                                            ? "text-rose-300"
                                            : candidate.checked_in_run
                                              ? "text-emerald-300"
                                              : "text-slate-500"
                                        }
                                      >
                                        {candidate.checked_in_run
                                          ? candidate.http_status
                                            ? t("crawl.ui.httpStatus", { status: candidate.http_status })
                                            : candidate.request_error_kind ||
                                              t("crawl.ui.checked")
                                          : t("crawl.ui.notChecked")}
                                      </span>
                                      {candidate.content_length == null
                                        ? ""
                                        : ` · ${formatNumber(candidate.content_length)} B`}{" "}
                                      · {candidate.url}
                                    </li>
                                  ),
                                )}
                              </ul>
                              {image.srcset_resource_checks_truncated && (
                                <p className="mt-1 text-amber-300">
                                  {t("crawl.ui.srcsetTruncated")}
                                </p>
                              )}
                            </details>
                          ) : (
                            image.srcset && (
                              <p
                                className="mt-1 truncate text-[10px] text-slate-500"
                                title={image.srcset}
                              >
                                {t("crawl.ui.srcsetNoVariants")}
                              </p>
                            )
                          )}
                        </td>
                        <td
                          className={`${cell} font-mono ${image.request_error_kind || (image.http_status && image.http_status >= 400) ? "text-rose-300" : image.checked_in_run ? "text-emerald-300" : "text-slate-500"}`}
                        >
                          {!image.checked_in_run
                            ? t("crawl.ui.notChecked")
                            : image.http_status
                              ? t("crawl.ui.httpStatus", { status: image.http_status })
                              : image.request_error_kind ||
                                t("crawl.ui.noStatus")}
                        </td>
                        <td className={`${cell} text-right font-mono`}>
                          {image.content_length === undefined ||
                          image.content_length === null
                            ? "—"
                            : `${formatNumber(image.content_length)} B`}
                        </td>
                        <td
                          className={`${cell} max-w-48 truncate ${image.alt === undefined ? "text-rose-300" : "text-slate-300"}`}
                        >
                          {image.alt === undefined
                            ? t("crawl.ui.missingAlt")
                            : image.alt || t("crawl.ui.emptyAlt")}
                        </td>
                        <td className={cell}>{image.format || "—"}</td>
                        <td className={`${cell} font-mono`}>
                          {image.width || "—"} × {image.height || "—"}
                          {image.dimensions_source && (
                            <span className="ml-1 text-[10px] text-slate-500">
                              ·{" "}
                              {t(
                                `crawl.ui.dimensionSources.${image.dimensions_source === "intrinsic-data-uri" ? "dataUri" : image.dimensions_source === "intrinsic-http" ? "http" : image.dimensions_source === "mixed" ? "mixed" : "attributes"}`,
                              )}
                            </span>
                          )}
                        </td>
                        <td className={cell}>
                          {image.lazy_loaded
                            ? t("crawl.ui.lazy")
                            : t("crawl.ui.standard")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <Empty>{t("crawl.ui.noImages")}</Empty>
              )}
            </section>
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {t("crawl.ui.httpResources", {
                    visible: visibleResourceInventory.length,
                    total: resourceInventory.length,
                  })}
                </h3>
                {result.resource_limit_reached ? (
                  <span className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-200">
                    {t("siteAudit.resourceLimitReached")}
                  </span>
                ) : null}
                <div
                  className="flex flex-wrap gap-1"
                  role="group"
                  aria-label={t("crawl.ui.resourceProvenanceFilter")}
                >
                  {(
                    [
                      ["all", t("crawl.ui.all")],
                      ["orphaned", t("crawl.ui.orphaned")],
                      ["partial", t("crawl.ui.partialEvidence")],
                      ["unknown", t("crawl.ui.noEvidence")],
                    ] as Array<[ResourceProvenanceFilter, string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={resourceProvenanceFilter === value}
                      onClick={() => setResourceProvenanceFilter(value)}
                      className={`rounded-md border px-2 py-1 text-[10px] transition ${resourceProvenanceFilter === value ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mb-2 text-[11px] text-slate-500">
                {t("crawlDeepUi.resourceTimingNote")}
              </p>
              {visibleResourceInventory.length > 0 ? (
                <Table minWidth="min-w-[980px]">
                  <thead className={tableHead}>
                    <tr>
                      {[
                        t("crawlDeepUi.resourceType"),
                        t("crawl.ui.status"),
                        t("crawl.ui.resource"),
                        t("crawl.ui.sources"),
                        t("siteAudit.contentType"),
                        t("crawl.ui.size"),
                        t("crawl.ui.intrinsicDimensions"),
                        t("crawl.ui.httpTime"),
                        t("crawl.ui.provenance"),
                      ].map((label) => (
                        <th key={label} className={cell}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResourceInventory.map(
                      ({ resource, status, sourceUrls, knownSourceUrls }) => (
                        <tr
                          key={resource.url}
                          className="border-t border-slate-800/80 text-slate-300"
                        >
                          <td className={cell}>{resource.resource_type}</td>
                          <td
                            className={`${cell} font-mono ${resource.request_error_kind || (resource.http_status && resource.http_status >= 400) ? "text-rose-300" : "text-emerald-300"}`}
                          >
                            {resource.http_status
                          ? t("crawl.ui.httpStatus", { status: resource.http_status })
                              : resource.request_error_kind ||
                                t("crawlDeepUi.noStatus")}
                          </td>
                          <td
                            className={`${cell} max-w-72 truncate font-mono`}
                            title={resource.url}
                          >
                            {resource.url}
                          </td>
                          <td className={`${cell} text-right`}>
                            {sourceUrls.length}
                          </td>
                          <td className={cell}>
                            {resource.content_type || "—"}
                          </td>
                          <td className={`${cell} text-right font-mono`}>
                            {resource.content_length === undefined
                              ? "—"
                              : `${formatNumber(resource.content_length)} B`}
                          </td>
                          <td className={`${cell} text-right font-mono`}>
                            {resource.intrinsic_width &&
                            resource.intrinsic_height
                              ? `${resource.intrinsic_width} × ${resource.intrinsic_height} · ${resource.dimensions_source || t("crawlDeepUi.intrinsic")}`
                              : "—"}
                          </td>
                          <td className={`${cell} text-right font-mono`}>
                            {resource.response_time_ms === undefined
                              ? "—"
                              : `${resource.response_time_ms} ms`}
                          </td>
                          <td className={`${cell} max-w-56`}>
                            <span
                              className={
                                status === "orphaned"
                                  ? "text-rose-300"
                                  : status === "partial"
                                    ? "text-amber-300"
                                    : status === "unknown"
                                      ? "text-slate-500"
                                      : "text-emerald-300"
                              }
                              title={t("crawl.ui.resourceEvidenceTitle", {
                                sources: sourceUrls.length,
                                matched: knownSourceUrls.length,
                              })}
                            >
                              {t(`crawl.resources.provenance.${status}`)}
                            </span>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </Table>
              ) : (
                <Empty>
                  {resourceInventory.length > 0
                    ? t("crawl.ui.noResourcesForFilter")
                    : t("crawl.ui.noAdditionalResources")}
                </Empty>
              )}
            </section>
          </div>
        );
      }
      case "frames": {
        const frames = result.pages.flatMap((page) =>
          (page.frames || []).map((frame, index) => ({
            page,
            frame,
            key: `${page.url}-${frame.resolved_url || frame.src || "blank"}-${index}`,
          })),
        );
        return (
          <div className="space-y-3">
            <p className="text-[11px] leading-5 text-slate-500">
              {t("crawl.ui.framesDescription")}
            </p>
            {frames.length ? (
              <>
                <Table minWidth="min-w-[900px]">
                  <thead className={tableHead}>
                    <tr>
                      {[
                        t("crawl.ui.sourcePage"),
                        t("crawl.ui.declaredSrc"),
                        t("crawl.ui.resolvedUrl"),
                        t("crawl.ui.httpStatusLabel"),
                        t("crawl.ui.title"),
                        t("crawl.ui.name"),
                        t("crawl.ui.loading"),
                        t("crawl.ui.sandbox"),
                      ].map((label) => (
                        <th key={label} className={cell}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {frames.map(({ page, frame, key }) => {
                      const status = frame.checked_in_run
                        ? frame.http_status
                          ? t("crawl.ui.httpStatus", { status: frame.http_status })
                          : frame.request_error_kind
                            ? t("crawl.ui.requestError", {
                                kind: frame.request_error_kind,
                              })
                            : t("crawl.ui.checkedNoStatus")
                        : frame.resolved_url
                          ? t("crawl.ui.notChecked")
                          : t("crawl.ui.noHttpTarget");
                      return (
                        <tr
                          key={key}
                          className="border-t border-slate-800/80 align-top text-slate-300"
                        >
                          <td
                            className={`${cell} max-w-56 truncate font-mono`}
                            title={page.url}
                          >
                            {page.url}
                          </td>
                          <td
                            className={`${cell} max-w-56 break-all font-mono`}
                          >
                            {frame.src || t("crawl.ui.noSrcBlank")}
                          </td>
                          <td
                            className={`${cell} max-w-64 break-all font-mono`}
                          >
                            {frame.resolved_url || "—"}
                          </td>
                          <td
                            className={`${cell} font-mono ${frame.request_error_kind || (frame.http_status && frame.http_status >= 400) ? "text-rose-300" : frame.checked_in_run ? "text-emerald-300" : "text-slate-500"}`}
                          >
                            {status}
                          </td>
                          <td className={cell}>{frame.title || "—"}</td>
                          <td className={cell}>{frame.name || "—"}</td>
                          <td className={cell}>{frame.loading || "—"}</td>
                          <td
                            className={`${cell} max-w-48 break-all font-mono`}
                          >
                            {frame.sandbox ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                {result.pages.some((page) => page.frames_truncated) && (
                  <p className="text-[11px] text-amber-300">
                    {t("crawl.ui.framesTruncated")}
                  </p>
                )}
              </>
            ) : (
              <Empty>{t("crawl.ui.noFrames")}</Empty>
            )}
          </div>
        );
      }
      case "social": {
        const socialPages = result.pages.filter(
          (page) =>
            (page.favicons?.length || page.favicon_metadata?.length || 0) > 0 ||
            (page.social_meta_tags?.length || 0) > 0,
        );
        if (!socialPages.length)
          return <Empty>{t("crawl.social.empty")}</Empty>;
        const resourceStatus = (
          check: NonNullable<
            CrawledPageSummary["favicon_resource_checks"]
          >[number],
        ) => {
          if (!check.checked_in_run) return t("crawl.social.notChecked");
          if (check.request_error_kind)
            return t("crawl.social.requestError", {
              kind: check.request_error_kind,
            });
          return [
            check.http_status == null
              ? t("crawl.social.noHttpStatus")
              : t("crawl.ui.httpStatus", { status: check.http_status }),
            check.content_length == null
              ? null
              : `${formatNumber(check.content_length)} B`,
            check.intrinsic_width && check.intrinsic_height
              ? `${check.intrinsic_width} × ${check.intrinsic_height} · ${check.dimensions_source || t("crawl.social.intrinsic")}`
              : null,
            check.content_type || null,
          ]
            .filter(Boolean)
            .join(" · ");
        };
        const renderTags = (
          page: CrawledPageSummary,
          prefix: "og:" | "twitter:",
        ) => {
          const tags = (page.social_meta_tags || []).filter((tag) =>
            tag.key.startsWith(prefix),
          );
          return tags.length ? (
            <div className="max-w-[420px] space-y-2">
              {tags.map((tag, index) => (
                <div key={`${tag.key}-${index}`} className="break-words">
                  <p>
                    <span className="font-mono text-slate-500">
                      {tag.key}:{" "}
                    </span>
                    {tag.content === undefined || tag.content === null ? (
                      <span className="italic text-amber-300">
                        {t("crawl.social.missingContent")}
                      </span>
                    ) : tag.content === "" ? (
                      <span className="italic text-amber-300">
                        {t("crawl.social.emptyContent")}
                      </span>
                    ) : (
                      tag.content
                    )}
                  </p>
                  {tag.resource_check && (
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {resourceStatus(tag.resource_check)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-slate-500">
              {t("crawl.social.noDeclaration")}
            </span>
          );
        };
        return (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-500">
              {t("crawl.social.disclaimer")}
            </p>
            <Table minWidth="min-w-[1080px]">
              <thead className={tableHead}>
                <tr>
                  {[
                    t("crawl.social.sourceUrl"),
                    t("crawl.social.faviconColumn"),
                    t("crawl.social.openGraphColumn"),
                    t("crawl.social.twitterColumn"),
                  ].map((label) => (
                    <th key={label} className={cell}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {socialPages.map((page) => (
                  <tr
                    key={page.url}
                    className="border-t border-slate-800/80 text-slate-300"
                  >
                    <td
                      className={`${cell} max-w-64 truncate font-mono`}
                      title={page.url}
                    >
                      {page.url}
                    </td>
                    <td className={cell}>
                      {page.favicons?.length ||
                      page.favicon_metadata?.length ? (
                        <div className="max-w-64 space-y-2">
                          {(
                            (page.favicon_metadata?.length
                              ? page.favicon_metadata
                              : (page.favicons || []).map(
                                  (href): FaviconData => ({ href, rel: "" }),
                                )) as FaviconData[]
                          ).map((favicon, index) => {
                            const check = page.favicon_resource_checks?.find(
                              (candidate) => candidate.url === favicon.href,
                            );
                            return (
                              <div
                                key={`${favicon.href}-${favicon.rel}-${index}`}
                              >
                                <p className="break-all font-mono">
                                  {favicon.href}
                                </p>
                                {(favicon.rel ||
                                  favicon.declared_type ||
                                  favicon.declared_sizes ||
                                  favicon.inferred_format) && (
                                  <p className="mt-0.5 text-[10px] text-slate-500">
                                    {[
                                      favicon.rel
                                        ? t("crawl.social.faviconRel", {
                                            value: favicon.rel,
                                          })
                                        : null,
                                      favicon.declared_type
                                        ? t("crawl.social.faviconType", {
                                            value: favicon.declared_type,
                                          })
                                        : null,
                                      favicon.declared_sizes
                                        ? t("crawl.social.faviconSizes", {
                                            value: favicon.declared_sizes,
                                          })
                                        : null,
                                      favicon.inferred_format
                                        ? t("crawl.social.faviconFormat", {
                                            value: favicon.inferred_format,
                                          })
                                        : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                )}
                                <p className="mt-0.5 text-[10px] text-slate-500">
                                  {check
                                    ? resourceStatus(check)
                                    : t("crawl.social.noResourceStatus")}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-slate-500">
                          {t("crawl.social.noDeclaration")}
                        </span>
                      )}
                    </td>
                    <td className={cell}>{renderTags(page, "og:")}</td>
                    <td className={cell}>{renderTags(page, "twitter:")}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        );
      }
      case "directives": {
        const redirectMechanism = (source: string): string => {
          const keyBySource: Record<string, string> = {
            "meta-refresh": "crawlDeepUi.mechanismMetaRefresh",
            "http-refresh": "crawlDeepUi.mechanismHttpRefresh",
            javascript: "crawlDeepUi.mechanismJavascript",
            "javascript-inline": "crawlDeepUi.mechanismJavascriptInline",
          };
          const key = keyBySource[source];
          return key ? t(key, { defaultValue: source }) : source;
        };
        const redirects = result.pages.flatMap((page) =>
          (page.client_redirects || []).map((redirect, index) => ({
            page,
            redirect,
            key: `${page.url}-${redirect.source}-${index}`,
          })),
        );
        return (
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t("crawlDeepUi.clientRedirects", { count: redirects.length })}
              </h3>
              {redirects.length ? (
                <Table minWidth="min-w-[900px]">
                  <thead className={tableHead}>
                    <tr>
                      {[
                        t("crawlDeepUi.sourceUrl"),
                        t("crawlDeepUi.mechanism"),
                        t("crawlDeepUi.delay"),
                        t("crawlDeepUi.declaration"),
                        t("crawlDeepUi.resolvedHttpTarget"),
                      ].map((label) => (
                        <th key={label} className={cell}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {redirects.map(({ page, redirect, key }) => (
                      <tr
                        key={key}
                        className="border-t border-slate-800/80 text-slate-300"
                      >
                        <td
                          className={`${cell} max-w-64 truncate font-mono`}
                          title={page.url}
                        >
                          {page.url}
                        </td>
                        <td className={cell}>{redirectMechanism(redirect.source)}</td>
                        <td className={`${cell} font-mono`}>
                          {redirect.delay_seconds === undefined ||
                          redirect.delay_seconds === null
                            ? t("crawlDeepUi.undetermined")
                            : `${redirect.delay_seconds} s`}
                        </td>
                        <td className={`${cell} max-w-72 break-all font-mono`}>
                          {redirect.declaration}
                        </td>
                        <td className={`${cell} max-w-72 break-all font-mono`}>
                          {redirect.target_url ||
                            t("crawlDeepUi.noValidHttpTarget")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <Empty>{t("crawlDeepUi.noClientRedirects")}</Empty>
              )}
            </section>
            <Table minWidth="min-w-[1280px]">
              <thead className={tableHead}>
                <tr>
                  {[
                    t("crawl.ui.url"),
                    t("crawl.ui.httpStatusLabel"),
                    t("crawlDeepUi.indexability"),
                    t("crawlDeepUi.canonicalRelation"),
                    t("crawlDeepUi.canonicalTargets"),
                    t("crawlDeepUi.canonicalConflict"),
                    t("crawlDeepUi.metaRobots"),
                    t("crawlDeepUi.xRobotsTag"),
                    t("crawlDeepUi.robotsVerdict"),
                  ].map((label) => (
                    <th key={label} className={cell}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.pages.map((page) => (
                  <tr
                    key={page.url}
                    className="border-t border-slate-800/80 text-slate-300"
                  >
                    <td
                      className={`${cell} max-w-64 truncate font-mono`}
                      title={page.url}
                    >
                      {page.url}
                    </td>
                    <td className={`${cell} font-mono`}>
                      {page.http_status || page.request_error_kind || "—"}
                    </td>
                    <td className={`${cell} max-w-48`}>
                      {page.indexability_status}
                    </td>
                    <td className={`${cell} font-mono`}>
                      {page.canonical_relation
                        ? `${page.canonical_relation} · ${page.canonical_declaration_count ?? "—"}`
                        : page.canonical
                          ? t("crawlDeepUi.legacyUnavailable")
                          : t("crawlDeepUi.legacyNoData")}
                    </td>
                    <td className={cell}>
                      {page.canonical_targets?.length ? (
                        <div className="max-w-[420px] space-y-1">
                          {page.canonical_targets.map((target, index) => (
                            <p
                              key={`${target.url}-${index}`}
                              className="break-all font-mono"
                            >
                              <span className="text-slate-500">
                                {target.relation} ·{" "}
                              </span>
                              {target.url}
                              <span className="ml-1 text-slate-400">
                                {target.checked_in_run
                                  ? target.http_status === 0
                                    ? `· ${t("crawlDeepUi.noResponse")}`
                                    : `· ${t("crawl.ui.httpStatus", { status: target.http_status })}`
                                  : `· ${t("crawlDeepUi.notCheckedThisRun")}`}
                              </span>
                            </p>
                          ))}
                        </div>
                      ) : page.canonical ? (
                        <span className="break-all font-mono">
                          {page.canonical} ·{" "}
                          {t("crawlDeepUi.targetStatusUnavailable")} ·{" "}
                          {t("crawlDeepUi.legacyUnavailable")}
                        </span>
                      ) : (
                        <span className="text-slate-500">
                          {t("crawl.ui.noCanonical")}
                        </span>
                      )}
                    </td>
                    <td className={cell}>
                      {page.canonical_robots_conflict === undefined ? (
                        t("crawlDeepUi.legacyNoData")
                      ) : page.canonical_robots_conflict ? (
                        <span className="text-amber-300">
                          {t("crawlDeepUi.yes")} ·{" "}
                          {t("crawlDeepUi.canonicalNoindex")}
                        </span>
                      ) : (
                        t("crawlDeepUi.notDetected")
                      )}
                    </td>
                    <td className={cell}>
                      {page.meta_robots || t("crawlDeepUi.noDirectives")}
                    </td>
                    <td className={cell}>
                      {result.crawl_mode === "browser-rendered"
                        ? t("crawlDeepUi.legacyUnavailable")
                        : page.x_robots_tag || t("crawlDeepUi.noDirectives")}
                    </td>
                    <td className={`${cell} min-w-56`}>
                      {page.robots_decision ? (
                        <div className="space-y-1 text-[10px]">
                          <p className="font-semibold text-sky-200">
                            {page.robots_decision.indexability} ·{" "}
                            {page.robots_decision.link_following}
                          </p>
                          <p className="text-slate-400">
                            {(page.robots_decision.directives || []).join(
                              ", ",
                            ) || t("crawlDeepUi.defaults")}
                          </p>
                          <p className="text-slate-500">
                            {t("crawl.ui.source")}:{" "}
                            {(page.robots_decision.sources || []).join(", ") ||
                              t("crawlDeepUi.noDirectives")}
                            {page.robots_decision.response_headers_available
                              ? ` · ${t("crawlDeepUi.headersAvailable")}`
                              : ` · ${t("crawlDeepUi.headersUnavailable")}`}
                          </p>
                        </div>
                      ) : (
                        <span className="text-slate-600">
                          {t("crawl.ui.noDataOlderRun")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        );
      }
      case "international": {
        const pagesWithInternational = result.pages.filter(
          (page) =>
            page.document_language || page.hreflangs.length || page.amp_url,
        );
        const paginatedPages = result.pages.filter(
          (page) =>
            page.pagination_declaration_count ||
            page.pagination_links?.length ||
            page.pagination_next ||
            page.pagination_prev,
        );
        return pagesWithInternational.length || paginatedPages.length ? (
          <div className="space-y-5">
            {pagesWithInternational.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {t("crawlDeepUi.languageHreflangAmp")}
                </h3>
                <Table minWidth="min-w-[900px]">
                  <thead className={tableHead}>
                    <tr>
                      {[
                        t("crawl.ui.url"),
                        t("crawl.ui.language"),
                        t("crawlDeepUi.hreflang"),
                        t("crawlDeepUi.amp"),
                        t("crawlDeepUi.ampStatus"),
                        t("crawlDeepUi.canonicalAlignment"),
                      ].map((label) => (
                        <th key={label} className={cell}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagesWithInternational.map((page) => (
                      <tr
                        key={page.url}
                        className="border-t border-slate-800/80 text-slate-300"
                      >
                        <td
                          className={`${cell} max-w-56 truncate font-mono`}
                          title={page.url}
                        >
                          {page.url}
                        </td>
                        <td className={cell}>
                          {page.document_language || "—"}
                        </td>
                        <td className={`${cell} max-w-72`}>
                          {page.hreflangs.length
                            ? page.hreflangs.map((item) => (
                                <div
                                  key={`${item.language}-${item.target_url}`}
                                  className="break-all"
                                >
                                  <span className="text-slate-500">
                                    {item.language} ·{" "}
                                  </span>
                                  {item.target_url}
                                  <span className="block text-[10px] text-slate-500">
                                    {item.target_checked_in_run
                                      ? t("crawl.ui.httpStatus", { status: item.target_http_status ?? t("crawlDeepUi.noResponse") })
                                      : t("crawlDeepUi.statusOutsideRun")}{" "}
                                    ·{" "}
                                    {item.reciprocal_in_run == null
                                      ? t("crawlDeepUi.reciprocityUnchecked")
                                      : item.reciprocal_in_run
                                        ? t("crawlDeepUi.yes")
                                        : t("crawlDeepUi.noReciprocal")}{" "}
                                    ·{" "}
                                    {item.target_canonical_alignment ||
                                      t("crawlDeepUi.canonicalOutsideRun")}
                                  </span>
                                </div>
                              ))
                            : "—"}
                        </td>
                        <td
                          className={`${cell} max-w-52 break-all font-mono`}
                          title={page.amp_url ?? undefined}
                        >
                          {page.amp_url || "—"}
                        </td>
                        <td className={`${cell} font-mono`}>
                          {page.amp_url
                            ? page.amp_target_checked_in_run
                              ? page.amp_target_http_status == null
                                ? t("crawlDeepUi.noResponse")
                                : t("crawl.ui.httpStatus", { status: page.amp_target_http_status })
                              : t("crawlDeepUi.notCheckedThisRun")
                            : t("crawlDeepUi.noDirectives")}
                        </td>
                        <td className={cell}>
                          {page.amp_url
                            ? page.amp_target_canonical_alignment ===
                              "canonical-to-source"
                              ? t("crawlDeepUi.yes")
                              : page.amp_target_canonical_alignment ===
                                  "missing-canonical"
                                ? t("crawlDeepUi.noDirectives")
                                : page.amp_target_canonical_alignment
                                  ? t("crawlDeepUi.no")
                                  : t("crawlDeepUi.canonicalOutsideRun")
                            : t("crawlDeepUi.noDirectives")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </section>
            )}
            {paginatedPages.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {t("crawlDeepUi.pagination")}
                </h3>
                <Table minWidth="min-w-[1100px]">
                  <thead className={tableHead}>
                    <tr>
                      {[
                        t("crawl.ui.url"),
                        t("crawlDeepUi.declarations"),
                        t("crawlDeepUi.invalid"),
                        t("crawlDeepUi.canonicalAlignment"),
                        t("crawlDeepUi.relation"),
                        t("crawlDeepUi.target"),
                        t("crawlDeepUi.statusInRun"),
                        t("crawlDeepUi.reciprocal"),
                        t("crawlDeepUi.queryChanges"),
                      ].map((label) => (
                        <th key={label} className={cell}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedPages.flatMap((page) =>
                      (page.pagination_links || []).map((link, index) => (
                        <tr
                          key={`${page.url}-${link.relation}-${index}`}
                          className="border-t border-slate-800/80 text-slate-300"
                        >
                          <td
                            className={`${cell} max-w-56 truncate font-mono`}
                            title={page.url}
                          >
                            {page.url}
                          </td>
                          <td className={`${cell} text-center font-mono`}>
                            {page.pagination_declaration_count ??
                              t("crawlDeepUi.legacyUnavailable")}
                          </td>
                          <td
                            className={`${cell} text-center font-mono ${page.pagination_invalid_declaration_count ? "text-amber-300" : ""}`}
                          >
                            {page.pagination_invalid_declaration_count ??
                              t("crawlDeepUi.legacyUnavailable")}
                          </td>
                          <td className={`${cell} font-mono`}>
                            {page.pagination_canonical_alignment ||
                              t("crawlDeepUi.legacyUnavailable")}
                          </td>
                          <td className={`${cell} font-mono`}>
                            {link.relation}
                          </td>
                          <td
                            className={`${cell} max-w-72 break-all font-mono`}
                          >
                            {link.target_url}
                          </td>
                          <td className={`${cell} font-mono`}>
                            {link.checked_in_run
                              ? link.http_status == null
                                ? t("crawlDeepUi.noResponse")
                                : t("crawl.ui.httpStatus", { status: link.http_status })
                              : t("crawlDeepUi.notCheckedThisRun")}
                          </td>
                          <td className={`${cell} font-mono`}>
                            {link.reciprocal_in_run === undefined ||
                            link.reciprocal_in_run === null
                              ? t("crawlDeepUi.reciprocityUnchecked")
                              : link.reciprocal_in_run
                                ? t("crawlDeepUi.yes")
                                : t("crawlDeepUi.no")}
                          </td>
                          <td className={`${cell} max-w-72`}>
                            {link.query_parameter_changes.length
                              ? link.query_parameter_changes.join(" · ")
                              : t("crawlDeepUi.noQueryChanges")}
                          </td>
                        </tr>
                      )),
                    )}
                    {paginatedPages
                      .filter((page) => !page.pagination_links?.length)
                      .map((page) => (
                        <tr
                          key={`${page.url}-invalid-pagination`}
                          className="border-t border-slate-800/80 text-slate-300"
                        >
                          <td
                            className={`${cell} max-w-56 truncate font-mono`}
                            title={page.url}
                          >
                            {page.url}
                          </td>
                          <td className={`${cell} text-center font-mono`}>
                            {page.pagination_declaration_count ??
                              t("crawlDeepUi.legacyUnavailable")}
                          </td>
                          <td
                            className={`${cell} text-center font-mono text-amber-300`}
                          >
                            {page.pagination_invalid_declaration_count ??
                              t("crawlDeepUi.legacyUnavailable")}
                          </td>
                          <td className={`${cell} font-mono`}>
                            {page.pagination_canonical_alignment ||
                              t("crawlDeepUi.legacyUnavailable")}
                          </td>
                          <td className={cell} colSpan={5}>
                            {t("crawlDeepUi.invalidPaginationTarget")}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
              </section>
            )}
          </div>
        ) : (
          <Empty>{t("crawlDeepUi.noInternationalSignals")}</Empty>
        );
      }
      case "structured":
        return result.pages.some(
          (page) =>
            page.schema_types.length ||
            page.schema_syntax_errors > 0 ||
            page.schema_validation_findings?.length,
        ) ? (
          <Table minWidth="min-w-[900px]">
            <thead className={tableHead}>
              <tr>
                {[
                  t("crawlDeepUi.sourceUrl"),
                  t("crawlDeepUi.detectedTypes"),
                  t("crawlDeepUi.jsonLdErrors"),
                  t("crawlDeepUi.localFindings"),
                ].map((label) => (
                  <th key={label} className={cell}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.pages
                .filter(
                  (page) =>
                    page.schema_types.length ||
                    page.schema_syntax_errors > 0 ||
                    page.schema_validation_findings?.length,
                )
                .map((page) => (
                  <tr
                    key={page.url}
                    className="border-t border-slate-800/80 align-top text-slate-300"
                  >
                    <td
                      className={`${cell} max-w-72 break-all font-mono`}
                      title={page.url}
                    >
                      {page.url}
                    </td>
                    <td className={`${cell} max-w-72`}>
                      {page.schema_types.length
                        ? page.schema_types.join(", ")
                        : t("crawlDeepUi.notDetected")}
                    </td>
                    <td
                      className={`${cell} text-center font-mono ${page.schema_syntax_errors ? "text-rose-300" : "text-slate-400"}`}
                    >
                      {page.schema_syntax_errors}
                    </td>
                    <td className={cell}>
                      {page.schema_validation_findings?.length ? (
                        <details>
                          <summary className="cursor-pointer text-emerald-200">
                            {t("crawlDeepUi.findingCount", {
                              count: page.schema_validation_findings.length,
                            })}
                            {page.schema_validation_truncated
                              ? t("crawlDeepUi.partial")
                              : ""}
                          </summary>
                          <ul className="mt-2 max-w-xl space-y-2">
                            {page.schema_validation_findings.map(
                              (item, index) => {
                                const localized = localizeStructuredDataFinding(item.finding, {
                                  format: item.format,
                                  dataType: page.schema_types.join(', ') || t('schemaFindings.unknownType'),
                                }, t);
                                return <li
                                  key={`${item.format}-${item.declaration_index}-${item.finding.code}-${index}`}
                                  className={`rounded-md border p-2 ${item.finding.severity === "error" ? "border-rose-500/20 bg-rose-500/5" : item.finding.severity === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-sky-500/20 bg-sky-500/5"}`}
                                >
                                  <p className="font-medium">
                                    {localized.displaySeverity} ·{" "}
                                    {item.format} #{item.declaration_index}
                                  </p>
                                  <p className="mt-1">{localized.displayMessage}</p>
                                  {item.finding.path && (
                                    <p className="mt-1 break-all font-mono text-[10px] text-slate-400">
                                      {item.finding.path}
                                    </p>
                                  )}
                                  {localized.displayRecommendation && (
                                    <p className="mt-1 text-slate-400">
                                      {localized.displayRecommendation}
                                    </p>
                                  )}
                                  <details className="mt-2 text-[10px] text-slate-500">
                                    <summary className="cursor-pointer text-slate-400">{t("schemaFindings.sourceEvidence")}</summary>
                                    <p className="mt-1 break-words font-mono">{localized.evidenceMessage}</p>
                                    {localized.evidenceRecommendation && <p className="mt-1 break-words">{localized.evidenceRecommendation}</p>}
                                  </details>
                                </li>;
                              },
                            )}
                          </ul>
                        </details>
                      ) : (
                        t("crawlDeepUi.noLocalFindings")
                      )}
                      {page.schema_validation_truncated && (
                        <p className="mt-1 text-[10px] text-amber-300">
                          {t("crawlDeepUi.validationLimitNote")}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </Table>
        ) : (
          <Empty>{t("crawlDeepUi.noStructuredData")}</Empty>
        );
      case "validation": {
        const checkedPages = result.pages.filter(
          (page) =>
            page.html_validation_findings !== undefined ||
            page.detected_charset !== undefined,
        );
        const normalizedValidationQuery = validationQuery
          .trim()
          .toLocaleLowerCase();
        const validationPages = checkedPages
          .map((page) => {
            const pageMatches = normalizedValidationQuery
              ? [page.url, page.charset, page.detected_charset]
                  .filter(Boolean)
                  .some((value) =>
                    String(value)
                      .toLocaleLowerCase()
                      .includes(normalizedValidationQuery),
                  )
              : true;
            const findings = (page.html_validation_findings || []).filter(
              (finding) => {
                if (
                  validationSeverity !== "all" &&
                  finding.severity !== validationSeverity
                ) {
                  return false;
                }
                if (!normalizedValidationQuery || pageMatches) return true;
                return [
                  finding.code,
                  finding.message,
                  finding.element,
                  finding.attribute,
                  finding.value,
                  finding.source_excerpt,
                ]
                  .filter(Boolean)
                  .some((value) =>
                    String(value)
                      .toLocaleLowerCase()
                      .includes(normalizedValidationQuery),
                  );
              },
            );
            return { page, findings, pageMatches };
          })
          .filter(
            ({ findings, pageMatches }) =>
              (!normalizedValidationQuery && validationSeverity === "all") ||
              pageMatches ||
              findings.length > 0,
          );
        const validationFindingCount = validationPages.reduce(
          (count, item) => count + item.findings.length,
          0,
        );
        return checkedPages.length ? (
          <div className="space-y-3">
            <div className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
              <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {t("crawlDeepUi.searchEvidence")}
                <input
                  aria-label={t("crawl.ui.searchHtmlValidation")}
                  value={validationQuery}
                  onChange={(event) => setValidationQuery(event.target.value)}
                  placeholder={t("crawl.ui.searchHtmlValidationPlaceholder")}
                  className="mt-1 h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 text-xs normal-case tracking-normal text-slate-200 outline-none focus:border-emerald-400"
                />
              </label>
              <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {t("crawl.ui.severity")}
                <select
                  aria-label={t("crawl.ui.validationSeverity")}
                  value={validationSeverity}
                  onChange={(event) =>
                    setValidationSeverity(
                      event.target.value as "all" | "Error" | "Warning",
                    )
                  }
                  className="mt-1 h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs normal-case tracking-normal text-slate-200 outline-none focus:border-emerald-400"
                >
                  <option value="all">{t("crawl.ui.all")}</option>
                  <option value="Error">{t("crawl.ui.error")}</option>
                  <option value="Warning">{t("crawl.ui.warning")}</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  setValidationQuery("");
                  setValidationSeverity("all");
                }}
                disabled={!validationQuery && validationSeverity === "all"}
                className="h-8 rounded-md border border-slate-700 px-2.5 text-[11px] text-slate-300 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("crawlDeepUi.clearFilter")}
              </button>
              <p className="text-[10px] text-slate-500 sm:col-span-3">
                {t("crawlDeepUi.matchedFindings", {
                  pages: validationPages.length,
                  findings: validationFindingCount,
                })}
              </p>
            </div>
            <p className="text-[11px] leading-5 text-slate-500">
              {t("crawlDeepUi.htmlValidationNote")}
            </p>
            {validationPages.length ? (
              <Table minWidth="min-w-[1100px]">
                <thead className={tableHead}>
                  <tr>
                    {[
                      t("crawlDeepUi.sourceUrl"),
                      t("crawlDeepUi.httpCharset"),
                      t("crawlDeepUi.decoderCharset"),
                      t("crawlDeepUi.localFindings"),
                    ].map((label) => (
                      <th key={label} className={cell}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {validationPages.map(({ page, findings }) => (
                    <tr
                      key={page.url}
                      className="border-t border-slate-800/80 align-top text-slate-300"
                    >
                      <td
                        className={`${cell} max-w-72 break-all font-mono`}
                        title={page.url}
                      >
                        {page.url}
                      </td>
                      <td className={`${cell} font-mono`}>
                        {page.charset || t("crawlDeepUi.notDeclared")}
                      </td>
                      <td className={`${cell} font-mono`}>
                        {page.detected_charset ||
                          (page.body_truncated
                            ? t("crawlDeepUi.bodyTruncated")
                            : t("crawlDeepUi.noData"))}
                      </td>
                      <td className={cell}>
                        {findings.length ? (
                          <details open>
                            <summary className="cursor-pointer text-amber-200">
                              {t("crawlDeepUi.findingCountShort", {
                                count: findings.length,
                              })}
                              {page.html_validation_truncated
                                ? t("crawlDeepUi.limitedResult")
                                : ""}
                            </summary>
                            <ul className="mt-2 max-w-2xl space-y-2">
                              {findings.map((finding, index) => (
                                <li
                                  key={`${finding.code}-${index}`}
                                  className={`rounded-md border p-2 ${finding.severity === "Error" ? "border-rose-500/20 bg-rose-500/5" : "border-amber-500/20 bg-amber-500/5"}`}
                                >
                                  <p className="font-medium">
                                    {(finding.severity === "Error" ? t("componentUi.error") : t("crawl.ui.warning"))} · {finding.code}
                                    {finding.line
                                      ? ` · ${t("crawlDeepUi.line")} ${finding.line}${finding.column ? `:${finding.column}` : ""}`
                                      : ""}
                                  </p>
                                  <p className="mt-1">{localizeHtmlValidationFinding(finding, t).displayMessage}</p>
                                  <details className="mt-2 text-[10px] text-slate-500">
                                    <summary className="cursor-pointer text-slate-400">{t("htmlValidationFindings.sourceEvidence")}</summary>
                                    <p className="mt-1 break-words font-mono">{finding.message}</p>
                                  </details>
                                  {(finding.element || finding.attribute) && (
                                    <p className="mt-1 font-mono text-[10px] text-slate-400">
                                      {finding.element
                                        ? `<${finding.element}>`
                                        : ""}
                                      {finding.attribute
                                        ? ` [${finding.attribute}]`
                                        : ""}
                                    </p>
                                  )}
                                  {finding.value && (
                                    <code className="mt-1 block max-w-full break-all rounded bg-slate-950/70 p-1 font-mono text-[10px] text-slate-300">
                                      {finding.value}
                                    </code>
                                  )}
                                  {finding.source_excerpt && (
                                    <pre className="mt-1 max-w-2xl overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950/70 p-1 font-mono text-[10px] text-slate-400">
                                      {finding.source_excerpt}
                                    </pre>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : page.html_validation_findings ? (
                          t("crawlDeepUi.noLocalRuleFindings")
                        ) : (
                          t("crawlDeepUi.legacySnapshotNoData")
                        )}
                        {page.html_validation_truncated && (
                          <p className="mt-1 text-[10px] text-amber-300">
                            {t("crawlDeepUi.validationTruncatedNote")}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Empty>{t("crawl.ui.noHtmlFindings")}</Empty>
            )}
          </div>
        ) : (
          <Empty>{t("crawlDeepUi.noValidationResults")}</Empty>
        );
      }
      case "performance": {
        const timings = result.pages
          .map((page) => page.response_time_ms)
          .filter((value) => Number.isFinite(value) && value >= 0)
          .sort((a, b) => a - b);
        const buckets = [
          {
            label: t("crawlDeepUi.timingUnder100"),
            count: timings.filter((value) => value < 100).length,
          },
          {
            label: t("crawlDeepUi.timing100To299"),
            count: timings.filter((value) => value >= 100 && value < 300)
              .length,
          },
          {
            label: t("crawlDeepUi.timing300To999"),
            count: timings.filter((value) => value >= 300 && value < 1000)
              .length,
          },
          {
            label: t("crawlDeepUi.timingOver1000"),
            count: timings.filter((value) => value >= 1000).length,
          },
        ];
        const median =
          timings.length === 0
            ? undefined
            : timings.length % 2 === 1
              ? timings[(timings.length - 1) / 2]
              : (timings[timings.length / 2 - 1] +
                  timings[timings.length / 2]) /
                2;
        const renderedVitalsPages = result.pages.filter(
          (page) =>
            page.rendered_lcp_ms !== undefined ||
            page.rendered_inp_ms !== undefined ||
            page.rendered_cls !== undefined,
        );
        return (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  label:
                    result.crawl_mode === "browser-rendered"
                      ? t("crawlDeepUi.fastestNavigation")
                      : t("crawlDeepUi.fastestResponse"),
                  value: timings.length ? `${timings[0]} ms` : "—",
                },
                {
                  label: t("crawlDeepUi.median"),
                  value: median === undefined ? "—" : `${median} ms`,
                },
                {
                  label:
                    result.crawl_mode === "browser-rendered"
                      ? t("crawlDeepUi.slowestNavigation")
                      : t("crawlDeepUi.slowestResponse"),
                  value: timings.length ? `${timings.at(-1)} ms` : "—",
                },
              ].map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"
                >
                  <p className="text-xs text-slate-500">{metric.label}</p>
                  <p className="mt-1 font-mono text-xl font-semibold text-white">
                    {metric.value}
                  </p>
                </div>
              ))}
            </div>
            <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {result.crawl_mode === "browser-rendered"
                  ? t("crawlDeepUi.navigationRenderTime")
                  : t("crawlDeepUi.httpResponseTime")}
              </h3>
              <div className="space-y-3">
                {buckets.map((bucket) => (
                  <div
                    key={bucket.label}
                    className="grid grid-cols-[90px_1fr_56px] items-center gap-3 text-xs"
                  >
                    <span className="font-mono text-slate-400">
                      {bucket.label}
                    </span>
                    <div className="h-2 overflow-hidden rounded bg-slate-800">
                      <div
                        className="h-full rounded bg-emerald-400"
                        style={{
                          width: `${timings.length ? (bucket.count / timings.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-right font-mono text-slate-300">
                      {bucket.count}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                {result.crawl_mode === "browser-rendered"
                  ? t("crawlDeepUi.navigationTimingNote")
                  : t("crawlDeepUi.httpTimingNote")}
              </p>
            </section>
            {result.crawl_mode === "browser-rendered" && (
              <section className="rounded-lg border border-violet-500/25 bg-violet-500/5 p-4">
                <div className="mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-200">
                    {t("crawlDeepUi.renderedVitals")}
                  </h3>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">
                    {t("crawlDeepUi.renderedVitalsDescription")}
                  </p>
                </div>
                {renderedVitalsPages.length ? (
                  <Table minWidth="min-w-[760px]">
                    <thead className={tableHead}>
                      <tr>
                        {[t("crawl.ui.url"), t("crawlDeepUi.lcp"), t("crawlDeepUi.inp"), t("crawlDeepUi.cls")].map((label) => (
                          <th key={label} className={cell}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {renderedVitalsPages.map((page) => (
                        <tr
                          key={page.url}
                          className="border-t border-slate-800/80 text-slate-300"
                        >
                          <td
                            className={`${cell} max-w-[420px] truncate font-mono`}
                            title={page.url}
                          >
                            {page.url}
                          </td>
                          <td className={`${cell} font-mono`}>
                            {page.rendered_lcp_ms == null
                              ? t("crawlDeepUi.noEntry")
                              : `${page.rendered_lcp_ms} ms`}
                          </td>
                          <td className={`${cell} font-mono`}>
                            {page.rendered_inp_ms == null
                              ? t("crawlDeepUi.noInteraction")
                              : `${page.rendered_inp_ms} ms`}
                          </td>
                          <td className={`${cell} font-mono`}>
                            {page.rendered_cls == null
                              ? t("crawlDeepUi.noEntry")
                              : page.rendered_cls.toFixed(3)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <p className="text-xs text-slate-400">
                    {t("crawlDeepUi.noVitals")}
                  </p>
                )}
              </section>
            )}
            {result.crawl_mode === "browser-rendered" && (
              <section
                aria-label={t("crawl.ui.renderedArtifacts")}
                className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-4"
              >
                <div className="mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-200">
                    {t("crawlDeepUi.screenshotAndPdf")}
                  </h3>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">
                    {t("crawlDeepUi.artifactDescription")}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="min-w-0 flex-1 text-[11px] text-slate-400">
                    {t("crawlDeepUi.artifactUrl")}
                    <select
                      aria-label={t("crawl.ui.renderedUrlForArtifact")}
                      value={renderedArtifactUrl}
                      onChange={(event) =>
                        setRenderedArtifactUrl(event.target.value)
                      }
                      className="mt-1 block h-9 w-full min-w-0 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-sky-400"
                    >
                      {renderedArtifactUrls.map((url) => (
                        <option key={url} value={url}>
                          {url}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={renderedArtifactKind !== null}
                      onClick={() => void createRenderedArtifact("screenshot")}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 text-xs font-medium text-sky-100 transition hover:border-sky-300/80 hover:bg-sky-400/20 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                    >
                      {renderedArtifactKind === "screenshot" ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Image className="h-3.5 w-3.5" />
                      )}
                      {t("crawlDeepUi.screenshot")}
                    </button>
                    <button
                      type="button"
                      disabled={renderedArtifactKind !== null}
                      onClick={() => void createRenderedArtifact("pdf")}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 text-xs font-medium text-sky-100 transition hover:border-sky-300/80 hover:bg-sky-400/20 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                    >
                      {renderedArtifactKind === "pdf" ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileDown className="h-3.5 w-3.5" />
                      )}
                      {t("crawlDeepUi.pagePdf")}
                    </button>
                  </div>
                </div>
                {renderedArtifactKind && (
                  <p role="status" className="mt-2 text-[11px] text-sky-200">
                    {t("crawlDeepUi.creatingArtifact", {
                      kind:
                        renderedArtifactKind === "pdf"
                          ? t("crawlDeepUi.pagePdf")
                          : t("crawlDeepUi.screenshot"),
                    })}
                  </p>
                )}
                {renderedArtifactError && (
                  <p
                    role="alert"
                    className="mt-2 break-words text-[11px] text-rose-300"
                  >
                    {renderedArtifactError}
                  </p>
                )}
                {renderedArtifact && (
                  <div className="mt-3 flex flex-col gap-1 rounded-md border border-sky-500/20 bg-slate-950/50 p-3 text-[11px] text-slate-400 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                    <span className="text-sky-200">
                      {t("crawl.ui.createdAndDownloaded")}
                    </span>
                    <span
                      className="max-w-full truncate font-mono"
                      title={renderedArtifact.finalUrl}
                    >
                      {renderedArtifact.finalUrl}
                    </span>
                    <span>
                      {format(
                        new Date(renderedArtifact.capturedAt),
                        "yyyy-MM-dd HH:mm:ss",
                      )}
                    </span>
                    <span>{t("exportUi.statuses.bytes", { value: formatNumber(renderedArtifact.bytes) })}</span>
                    <span>{renderedArtifact.rendererPlatform}</span>
                    <button
                      type="button"
                      onClick={() => downloadRenderedArtifact(renderedArtifact)}
                      className="self-start text-sky-200 underline decoration-sky-400/50 underline-offset-2 hover:text-white sm:self-auto"
                    >
                      {t("crawlDeepUi.downloadAgain")}
                    </button>
                  </div>
                )}
              </section>
            )}
            <Table minWidth="min-w-[680px]">
              <thead className={tableHead}>
                <tr>
                  {[
                    t("crawl.ui.url"),
                    t("crawl.ui.httpStatusLabel"),
                    result.crawl_mode === "browser-rendered"
                      ? t("crawlDeepUi.navigation")
                      : t("crawl.ui.httpTime"),
                    t("crawlDeepUi.transfer"),
                    t("crawlDeepUi.contentType"),
                  ].map((label) => (
                    <th key={label} className={cell}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.pages.map((page) => (
                  <tr
                    key={page.url}
                    className="border-t border-slate-800/80 text-slate-300"
                  >
                    <td
                      className={`${cell} max-w-72 truncate font-mono`}
                      title={page.url}
                    >
                      {page.url}
                    </td>
                    <td className={`${cell} font-mono`}>
                      {page.http_status || page.request_error_kind || "—"}
                    </td>
                    <td className={`${cell} text-right font-mono`}>
                      {page.response_time_ms} {t("performance.milliseconds")}
                    </td>
                    <td className={`${cell} text-right font-mono`}>
                      {page.content_length == null
                        ? "—"
                        : t("exportUi.statuses.bytes", { value: formatNumber(page.content_length) })}
                    </td>
                    <td
                      className={`${cell} max-w-48 truncate`}
                      title={page.content_type ?? undefined}
                    >
                      {page.content_type || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        );
      }
      case "visualisations":
        return (
          <div
            id="crawl-map-section"
            tabIndex={-1}
            aria-label={t("crawl.navigation.mapSectionAria")}
            className="scroll-mt-32 space-y-4 outline-none"
          >
            <CrawlArchitectureGraph
              pages={result.pages}
              startUrl={result.start_url}
              crawlMode={result.crawl_mode}
              sitemapUrls={result.sitemap_urls}
              runs={runs}
              currentRunId={currentRun?.id}
            />
            {runs.length > 1 ? (
              <section className="rounded-xl border border-slate-800 bg-slate-900/45 p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-slate-100">
                    {t("crawlDeepUi.savedRunMetrics")}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("crawlDeepUi.savedRunMetricsDescription")}
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
                        label={t("siteAudit.historyChartLabel", { metric: metric.label })}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <Empty>{t("crawlDeepUi.historyChartEmpty")}</Empty>
            )}
            {runs.length > 1 && (
              <section className="rounded-xl border border-slate-800 bg-slate-900/45 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      {t("crawlDeepUi.compareTwoRuns")}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {compareByPath
                        ? t("crawlDeepUi.environmentMatchDescription")
                        : t("crawlDeepUi.fullUrlDescription")}
                    </p>
                  </div>
                  <div className="flex flex-col items-stretch gap-2 sm:items-end">
                    <select
                      aria-label={t("crawl.ui.compareCrawl")}
                      value={comparisonRunId}
                      onChange={(event) =>
                        setComparisonRunId(event.target.value)
                      }
                      className="h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400"
                    >
                      <option value="">{t("crawl.ui.chooseBaseRun")}</option>
                      {runs
                        .filter((run) => run.id !== currentRun?.id)
                        .map((run) => (
                          <option key={run.id} value={run.id}>
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
                        checked={compareByPath}
                        onChange={(event) =>
                          updateCompareByPath(event.target.checked)
                        }
                        className="accent-emerald-400"
                      />
                      {t("crawlDeepUi.matchByPath")}
                    </label>
                  </div>
                </div>
                {compareByPath && (
                  <p
                    role="note"
                    className="mt-3 rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[11px] leading-5 text-sky-100"
                  >
                    {t("crawlDeepUi.pathMatchDisclaimer")}
                  </p>
                )}
                {comparison && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">
                      {t("crawlDeepUi.addedUrls")}{" "}
                      <strong className="ml-2 text-lg text-white">
                        {comparison.added.length}
                      </strong>
                    </div>
                    <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-200">
                      {t("crawlDeepUi.removedUrls")}{" "}
                      <strong className="ml-2 text-lg text-white">
                        {comparison.removed.length}
                      </strong>
                    </div>
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
                      {t("crawlDeepUi.changedUrls")}{" "}
                      <strong className="ml-2 text-lg text-white">
                        {comparison.changed.length}
                      </strong>
                    </div>
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs sm:col-span-3">
                      {[
                        ...comparison.added,
                        ...comparison.removed,
                        ...comparison.changed,
                      ].length === 0 ? (
                        <p className="text-slate-500">
                          {t("crawlDeepUi.noComparisonChanges")}
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
                            {change.kind} · {change.url}
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
          </div>
        );
      case "exports":
        return currentRun ? (
          <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/45 p-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                {t("crawlDeepUi.savedDataExport")}
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {t("crawlDeepUi.exportRunDescription", {
                  id: currentRun.id,
                  date: format(
                    new Date(currentRun.completedAt),
                    "yyyy-MM-dd HH:mm",
                  ),
                  url: currentRun.startUrl,
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                [t("crawlDeepUi.exportJson"), () => downloadCrawlJson(currentRun)],
                [t("crawlDeepUi.exportPdf"), () => void exportPdf()],
                [t("crawlDeepUi.exportUrlsCsv"), () => downloadCrawlPagesCsv(currentRun)],
                [t("crawlDeepUi.exportLinksCsv"), () => downloadCrawlLinksCsv(currentRun)],
                [t("crawlDeepUi.exportImagesCsv"), () => downloadCrawlImagesCsv(currentRun)],
                [t("crawlDeepUi.exportFramesCsv"), () => downloadCrawlFramesCsv(currentRun)],
                [
                  t("crawlDeepUi.exportCustomSearchCsv"),
                  () => downloadCrawlCustomSearchCsv(currentRun),
                ],
                [t("crawlDeepUi.exportResourcesCsv"), () => downloadCrawlResourcesCsv(currentRun)],
                [t("crawlDeepUi.exportIssuesCsv"), () => downloadCrawlIssuesCsv(currentRun)],
              ].map(([label, action]) => (
                <button
                  key={String(label)}
                  type="button"
                  onClick={action as () => void}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-emerald-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  {label as string}
                </button>
              ))}
            </div>
            {pdfError && (
              <p role="alert" className="text-xs text-rose-300">
                {pdfError}
              </p>
            )}
            <p className="text-[11px] text-slate-500">
              {t("crawlDeepUi.exportSafetyNote")}
            </p>
          </section>
        ) : (
          <Empty>{t("crawlDeepUi.incompleteRunExport")}</Empty>
        );
      default:
        return null;
    }
  };

  return (
    <section
      ref={resultsRef}
      id="crawl-results"
      tabIndex={-1}
      className="scroll-mt-20 space-y-3"
      aria-label={t("crawl.navigation.resultsTitle")}
    >
      <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/35 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-white">
              {t("crawl.navigation.resultsTitle")}
            </h2>
            <span className="rounded border border-sky-500/20 bg-sky-500/5 px-1.5 py-0.5 text-[10px] text-sky-200">
              {result.crawl_mode === "browser-rendered"
                ? t("crawlDeepUi.browserRendered")
                : t("crawlDeepUi.httpJavascriptNotRendered")}
            </span>
            <button
              type="button"
              onClick={openMapSection}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 text-[11px] font-medium text-emerald-200 transition hover:border-emerald-300/60 hover:bg-emerald-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <Map className="h-3.5 w-3.5" />
              {t("crawl.navigation.mapAndClusters")}
            </button>
          </div>
          <p
            className="truncate text-[11px] text-slate-500"
            title={result.start_url}
          >
            {result.start_url}
          </p>
          {result.crawl_mode === "browser-rendered" && (
            <p className="mt-1 text-[11px] leading-4 text-amber-200/80">
              {t("crawlDeepUi.renderedDomNote")}
            </p>
          )}
          {result.storage_pages_truncated && result.storage_pages_total && (
            <p className="mt-1 text-[11px] leading-4 text-amber-200/80" role="status">
              {t("crawl.persistence.pageIndexNote", {
                retained: result.pages.length,
                total: result.storage_pages_total,
              })}
            </p>
          )}
        </div>
        {runs.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <label className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
              <span className="shrink-0">{t("crawl.navigation.savedRun")}</span>
              <select
                aria-label={t("crawl.navigation.chooseSavedCrawl")}
                value={currentRun?.id || runs[0].id}
                onChange={(event) => onSelectRun(event.target.value)}
                className="h-8 max-w-[60vw] rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400 sm:max-w-96"
              >
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {format(new Date(run.completedAt), "yyyy-MM-dd HH:mm")} ·{" "}
                    {t("crawl.ui.urlsCount", { count: run.result.pages_crawled })} · {run.startUrl}
                  </option>
                ))}
              </select>
            </label>
            {onDeleteRun && (
              <button
                type="button"
                onClick={() => void deleteCurrentRun()}
                disabled={!currentRun || isCrawling}
                className="inline-flex h-8 items-center rounded-md border border-rose-500/35 px-2.5 text-[11px] font-medium text-rose-200 transition hover:border-rose-400/70 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                title={
                  isCrawling
                    ? t("crawl.navigation.deleteRunDuringCrawl")
                    : t("crawl.navigation.deleteRunTitle")
                }
              >
                {t("crawl.navigation.deleteRun")}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="sticky top-12 z-30 rounded-xl border border-slate-700/90 bg-slate-950/95 p-2 shadow-lg shadow-black/20 backdrop-blur supports-[backdrop-filter]:bg-slate-950/90">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              aria-label={t("crawl.navigation.groupAria")}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
            >
              {tabGroups.map((group) => {
                const isActive = activeTabGroup === group.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    aria-pressed={isActive}
                    title={`${localizedGroupLabel(group)}: ${group.tabs.length} ${t("crawl.navigation.items")}`}
                    onClick={() => {
                      setActiveTabGroup(group.id);
                      setActiveTab(group.tabs[0]);
                    }}
                    className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${isActive ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-800/70 hover:text-slate-200"}`}
                  >
                    <span className="sm:hidden">
                      {localizedGroupShortLabel(group)}
                    </span>
                    <span className="hidden sm:inline">
                      {localizedGroupLabel(group)}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex shrink-0 items-center gap-2 text-[11px] text-slate-500">
              <span className="hidden lg:inline">
                {t("crawl.navigation.active")}{" "}
                <span className="text-slate-300">
                  {localizedTabLabel(activeTabMeta)}
                </span>
              </span>
              <label className="flex items-center gap-2">
                <span className="sr-only">
                  {t("crawl.navigation.jumpLabel")}
                </span>
                <select
                  aria-label={t("crawl.navigation.jumpLabel")}
                  value={activeTab}
                  onChange={(event) =>
                    setActiveTab(event.target.value as CrawlTab)
                  }
                  className="h-8 min-w-0 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400 sm:w-44"
                >
                  {tabs.map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {localizedTabLabel(tab)} · {tabCounts[tab.id]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                aria-label={t("crawl.navigation.mapAria", {
                  count: tabCounts.visualisations,
                })}
                title={t("crawl.navigation.mapButton")}
                onClick={openMapSection}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-emerald-400/35 bg-emerald-400/10 px-2 text-[11px] font-medium text-emerald-200 transition hover:border-emerald-300/70 hover:bg-emerald-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <Map className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {t("crawl.navigation.mapButtonShort")}
                </span>
                <span className="rounded bg-slate-950/50 px-1 font-mono text-[10px]">
                  {tabCounts.visualisations}
                </span>
              </button>
              <button
                type="button"
                aria-label={t("crawl.navigation.scrollResultsStart")}
                title={t("crawl.navigation.scrollResultsStart")}
                onClick={() => scrollResults("start")}
                className="inline-flex h-8 shrink-0 items-center rounded-md border border-slate-700 px-2 text-[10px] font-medium text-slate-400 transition hover:border-slate-500 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <span className="sm:hidden" aria-hidden="true">
                  ↑
                </span>
                <span className="hidden sm:inline">
                  ↑ {t("crawl.navigation.beginning")}
                </span>
              </button>
              <button
                type="button"
                aria-label={t("crawl.navigation.scrollResultsEnd")}
                title={t("crawl.navigation.scrollResultsEnd")}
                onClick={() => scrollResults("end")}
                className="inline-flex h-8 shrink-0 items-center rounded-md border border-slate-700 px-2 text-[10px] font-medium text-slate-400 transition hover:border-slate-500 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <span className="sm:hidden" aria-hidden="true">
                  ↓
                </span>
                <span className="hidden sm:inline">
                  ↓ {t("crawl.navigation.end")}
                </span>
              </button>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              aria-label={t("crawl.navigation.scrollTabsStart")}
              title={t("crawl.navigation.scrollTabsStart")}
              onClick={() => scrollTabStrip("start")}
              aria-controls="crawl-tab-strip"
              className="flex h-10 w-9 shrink-0 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-[10px] font-semibold uppercase tracking-wide text-slate-500 transition hover:border-slate-600 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <span className="md:hidden" aria-hidden="true">
                ↤
              </span>
              <span className="hidden md:inline">
                {t("crawl.navigation.beginning")}
              </span>
            </button>
            <button
              type="button"
              aria-label={t("crawl.navigation.scrollTabsLeft")}
              title={t("crawl.navigation.scrollTabsLeft")}
              onClick={() => scrollTabStrip("left")}
              aria-controls="crawl-tab-strip"
              className="flex h-10 w-9 shrink-0 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-400 transition hover:border-slate-600 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div
              ref={tabScrollerRef}
              id="crawl-tab-strip"
              role="tablist"
              aria-label={t("crawl.navigation.resultsTitle")}
              onKeyDown={selectTabByKey}
              className="scrollbar-thin flex min-w-0 flex-1 snap-x gap-1 overflow-x-auto scroll-smooth overscroll-x-contain"
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    id={`crawl-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    aria-controls="crawl-tab-panel"
                    tabIndex={activeTab === tab.id ? 0 : -1}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${activeTab === tab.id ? "bg-emerald-400/10 text-emerald-200 shadow-inner shadow-emerald-300/5" : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{localizedTabLabel(tab)}</span>
                    <span
                      className={`rounded px-1 py-0.5 font-mono text-[10px] ${activeTab === tab.id ? "bg-emerald-400/10 text-emerald-100" : "bg-slate-800 text-slate-500"}`}
                    >
                      {tabCounts[tab.id]}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-label={t("crawl.navigation.scrollTabsRight")}
              title={t("crawl.navigation.scrollTabsRight")}
              onClick={() => scrollTabStrip("right")}
              aria-controls="crawl-tab-strip"
              className="flex h-10 w-9 shrink-0 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-400 transition hover:border-slate-600 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={t("crawl.navigation.scrollTabsEnd")}
              title={t("crawl.navigation.scrollTabsEnd")}
              onClick={() => scrollTabStrip("end")}
              aria-controls="crawl-tab-strip"
              className="flex h-10 w-9 shrink-0 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-[10px] font-semibold uppercase tracking-wide text-slate-500 transition hover:border-slate-600 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <span className="md:hidden" aria-hidden="true">
                ↦
              </span>
              <span className="hidden md:inline">
                {t("crawl.navigation.end")}
              </span>
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-800/80 pt-1 text-[10px] text-slate-500">
            <span>
              {localizedGroupLabel(activeGroupMeta)} ·{" "}
              {localizedTabLabel(activeTabMeta)} · {tabCounts[activeTab]}{" "}
              {t("crawl.navigation.items")}
            </span>
            <span className="hidden sm:inline">
              {t("crawl.navigation.keyboardHint")}
            </span>
            <span className="sm:hidden">
              {t("crawl.navigation.mobileHint")}
            </span>
          </div>
        </div>
      </div>
      <div
        role="tabpanel"
        id="crawl-tab-panel"
        aria-labelledby={`crawl-tab-${activeTab}`}
        className="min-h-64 rounded-xl border border-slate-800 bg-slate-900/25 p-3 sm:p-4"
      >
        {renderContent()}
      </div>
    </section>
  );
};
