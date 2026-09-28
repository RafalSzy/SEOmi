import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createTopicalNode,
  importCrawlClusters,
  importTopicalQueries,
  readTopicalMap,
  setTopicalNodeParent,
  toggleTopicalLateralRelation,
  updateManualTopicalQueries,
  writeTopicalMap,
  type TopicalEntityFact,
  type SearchIntent,
  type TopicalMapDocument,
  type TopicalNode,
} from "@/services/topicalMap";
import {
  TopicalCalendar,
  type TopicalCalendarFilters,
} from "@/components/Charts/TopicalCalendar";
import { useToolsStore } from "@/stores/toolsStore";
import type { SemanticMap } from "@/services/semanticMap";
import type { CrawledPageSummary } from "@/types";
import { ContentBriefEditor } from "@/components/Charts/ContentBriefEditor";
import { assessContentBrief } from "@/services/contentBrief";
import { SemanticAuditPanel } from "@/components/Charts/SemanticAuditPanel";
import { SchemaGraphBuilder } from "@/components/Charts/SchemaGraphBuilder";
import type { SchemaArticleType } from "@/services/schemaGenerator";
import { InternalLinkOpportunitiesPanel } from "@/components/Charts/InternalLinkOpportunitiesPanel";
import { EntityEvidenceGraph } from "@/components/Charts/EntityEvidenceGraph";
import type { CrawlRunRecord } from "@/types";
import { readJsonStorage, writeJsonStorage } from "@/services/storage";
import { createId } from "@/services/ids";

interface Props {
  projectId: string | null;
  pages: CrawledPageSummary[];
  graph: SemanticMap;
  runId: string;
  sitemapUrls?: string[];
  runs?: CrawlRunRecord[];
  currentRunId?: string;
}
type TopicalUrlCandidate = {
  url: string;
  title: string;
  source: "crawl" | "content-link" | "sitemap" | "saved";
};

const normalizeTopicalCandidateUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

const inputClass =
  "mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-100 outline-none focus:border-emerald-400";
const labelClass = "block text-[11px] font-medium text-slate-400";
const topicalNodeDepth = (node: TopicalNode, nodes: TopicalNode[]): number => {
  let depth = 0;
  let parentId = node.parentId;
  const visited = new Set([node.id]);
  while (parentId && depth < nodes.length) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = nodes.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
};
type TopicalWorkspaceView =
  "topics" | "calendar" | "audit" | "schema" | "links" | "entity";
interface TopicalWorkspacePreferences {
  view: TopicalWorkspaceView;
  month: string;
  filters: TopicalCalendarFilters;
  search: string;
  schemaUrl: string;
  includeSchemaOrganization: boolean;
  includeSchemaBreadcrumbs: boolean;
  schemaArticleType: SchemaArticleType | "";
}
const defaultTopicalWorkspacePreferences = (): TopicalWorkspacePreferences => {
  const now = new Date();
  return {
    view: "topics",
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    filters: { lifecycle: "all", kind: "all", boundary: "all" },
    search: "",
    schemaUrl: "",
    includeSchemaOrganization: true,
    includeSchemaBreadcrumbs: false,
    schemaArticleType: "",
  };
};
const topicalWorkspacePreferencesKey = (projectId: string) =>
  `seomi_project_${projectId}_topical_workspace_preferences_v1`;
const readTopicalWorkspacePreferences = (
  projectId: string | null,
): TopicalWorkspacePreferences => {
  const defaults = defaultTopicalWorkspacePreferences();
  if (!projectId) return defaults;
  try {
    const value = readJsonStorage<unknown>(
      topicalWorkspacePreferencesKey(projectId),
      null,
    ) as any;
    if (!value || typeof value !== "object") return defaults;
    return {
      view:
        value.view === "calendar" ||
        value.view === "audit" ||
        value.view === "schema" ||
        value.view === "links" ||
        value.view === "entity"
          ? value.view
          : "topics",
      month: /^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)
        ? value.month
        : defaults.month,
      filters: {
        lifecycle: [
          "planned",
          "briefed",
          "drafted",
          "published",
          "needs-update",
        ].includes(value.filters?.lifecycle)
          ? value.filters.lifecycle
          : "all",
        kind: ["pillar", "cluster", "supporting"].includes(value.filters?.kind)
          ? value.filters.kind
          : "all",
        boundary: ["core", "outer"].includes(value.filters?.boundary)
          ? value.filters.boundary
          : "all",
      },
      search:
        typeof value.search === "string" ? value.search.slice(0, 200) : "",
      schemaUrl:
        typeof value.schemaUrl === "string"
          ? value.schemaUrl.slice(0, 2048)
          : "",
      includeSchemaOrganization:
        typeof value.includeSchemaOrganization === "boolean"
          ? value.includeSchemaOrganization
          : true,
      includeSchemaBreadcrumbs:
        typeof value.includeSchemaBreadcrumbs === "boolean"
          ? value.includeSchemaBreadcrumbs
          : false,
      schemaArticleType:
        ["Article", "BlogPosting", "NewsArticle", "TechArticle"].includes(value.schemaArticleType)
          ? value.schemaArticleType
          : "",
    };
  } catch {
    return defaults;
  }
};

export const SemanticTopicalWorkspace = ({
  projectId,
  pages,
  graph,
  runId,
  sitemapUrls = [],
  runs = [],
  currentRunId = runId,
}: Props) => {
  const { t } = useTranslation();
  const intentLabels: Record<SearchIntent, string> = {
    informational: t("semanticWorkspace.intent.informational"),
    commercial: t("semanticWorkspace.intent.commercial"),
    transactional: t("semanticWorkspace.intent.transactional"),
    navigational: t("semanticWorkspace.intent.navigational"),
    mixed: t("semanticWorkspace.intent.mixed"),
    unknown: t("semanticWorkspace.intent.unknown"),
  };
  const lifecycleLabels: Record<TopicalNode["lifecycle"], string> = {
    planned: t("semanticWorkspace.lifecycle.planned"),
    briefed: t("semanticWorkspace.lifecycle.briefed"),
    drafted: t("semanticWorkspace.lifecycle.drafted"),
    published: t("semanticWorkspace.lifecycle.published"),
    "needs-update": t("semanticWorkspace.lifecycle.needsUpdate"),
  };
  const nodeKindLabels: Record<TopicalNode["kind"], string> = {
    pillar: t("semanticWorkspace.kind.pillar"),
    cluster: t("semanticWorkspace.kind.cluster"),
    supporting: t("semanticWorkspace.kind.supporting"),
  };
  const sourceMetric = (value: number | null) =>
    value === null
      ? t("semanticWorkspace.sourceMetricMissing")
      : value.toLocaleString();
  const [document, setDocument] = useState<TopicalMapDocument>(() =>
    projectId
      ? readTopicalMap(projectId)
      : {
          schemaVersion: 1,
          entity: { name: "", description: "", facts: [] },
          nodes: [],
          updatedAt: new Date().toISOString(),
        },
  );
  const documentRef = useRef(document);
  const [loadedProjectId, setLoadedProjectId] = useState(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [hierarchyNotice, setHierarchyNotice] = useState("");
  const [pageSearch, setPageSearch] = useState("");
  const [workspacePreferences, setWorkspacePreferences] = useState(() =>
    readTopicalWorkspacePreferences(projectId),
  );
  const [preferencesProjectId, setPreferencesProjectId] = useState(projectId);
  const [factDraft, setFactDraft] = useState({
    attribute: "",
    value: "",
    sourceUrl: "",
  });
  const [topicFactDraft, setTopicFactDraft] = useState({
    attribute: "",
    value: "",
    sourceUrl: "",
  });
  const [saveError, setSaveError] = useState(false);
  const [preferencesSaveError, setPreferencesSaveError] = useState(false);
  const [queryImportNotice, setQueryImportNotice] = useState("");
  const keywordResults = useToolsStore((state) => state.keywordResults);
  const keywordResultsSource = useToolsStore(
    (state) => state.keywordResultsSource,
  );
  const isKeywordLoading = useToolsStore((state) => state.isKeywordLoading);
  const gscData = useToolsStore((state) => state.gscData);
  const gscDataFetchedAt = useToolsStore((state) => state.gscDataFetchedAt);
  const gscProperty = useToolsStore((state) => state.gscProperty);

  useEffect(() => {
    if (loadedProjectId === projectId) return;
    const next = projectId
      ? readTopicalMap(projectId)
      : {
          schemaVersion: 1 as const,
          entity: { name: "", description: "", facts: [] },
          nodes: [],
          updatedAt: new Date().toISOString(),
        };
    documentRef.current = next;
    setDocument(next);
    setSelectedId(null);
    setLoadedProjectId(projectId);
  }, [loadedProjectId, projectId]);

  useEffect(() => {
    if (preferencesProjectId === projectId) return;
    setWorkspacePreferences(readTopicalWorkspacePreferences(projectId));
    setPreferencesProjectId(projectId);
  }, [preferencesProjectId, projectId]);

  useEffect(() => {
    if (!projectId || preferencesProjectId !== projectId) return;
    setPreferencesSaveError(
      !writeJsonStorage(
        topicalWorkspacePreferencesKey(projectId),
        workspacePreferences,
      ),
    );
  }, [preferencesProjectId, projectId, workspacePreferences]);

  const persist = (next: TopicalMapDocument) => {
    documentRef.current = next;
    setDocument(next);
    if (!projectId) return;
    try {
      const saved = writeTopicalMap(projectId, next);
      documentRef.current = saved;
      setDocument(saved);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  };

  const selectedNode =
    document.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedFacts = selectedNode
    ? [...document.entity.facts, ...selectedNode.facts]
    : [];
  const selectedBriefAssessment = selectedNode
    ? assessContentBrief(
        selectedNode,
        selectedNode.contentBrief,
        selectedFacts,
        pages,
      )
    : null;
  const candidateUrlRecords = useMemo(() => {
    const candidates = new Map<string, TopicalUrlCandidate>();
    const add = (
      value: string,
      source: TopicalUrlCandidate["source"],
      title = "",
    ) => {
      const url = normalizeTopicalCandidateUrl(value);
      if (!url) return;
      const current = candidates.get(url);
      const priority: Record<TopicalUrlCandidate["source"], number> = {
        crawl: 0,
        "content-link": 1,
        sitemap: 2,
        saved: 3,
      };
      if (!current || priority[source] < priority[current.source])
        candidates.set(url, {
          url,
          title: title || current?.title || "",
          source,
        });
    };
    pages.forEach((page) => {
      const target = page.final_url || page.url;
      add(target, "crawl", page.title || "");
      add(page.url, "crawl", page.title || "");
      (page.semantic_links || [])
        .filter((link) => link.is_internal)
        .forEach((link) =>
          add(link.target_url, "content-link", link.anchor_text || ""),
        );
    });
    sitemapUrls.forEach((url) => add(url, "sitemap"));
    return [...candidates.values()];
  }, [pages, sitemapUrls]);
  const matchingUrlCandidates = useMemo(() => {
    const query = pageSearch.trim().toLocaleLowerCase();
    const candidates = new Map(
      candidateUrlRecords.map((candidate) => [candidate.url, candidate]),
    );
    selectedNode?.sourceUrls.forEach((url) => {
      const normalized = normalizeTopicalCandidateUrl(url);
      if (normalized && !candidates.has(normalized))
        candidates.set(normalized, {
          url: normalized,
          title: "",
          source: "saved",
        });
    });
    return [...candidates.values()].filter(
      (candidate) =>
        !query ||
        `${candidate.url} ${candidate.title}`
          .toLocaleLowerCase()
          .includes(query),
    );
  }, [candidateUrlRecords, pageSearch, selectedNode]);
  const availableUrlCandidates = matchingUrlCandidates.slice(0, 100);
  const crawledUrls = useMemo(
    () =>
      new Set(
        pages.flatMap((page) =>
          [page.url, page.final_url]
            .map(normalizeTopicalCandidateUrl)
            .filter((url): url is string => Boolean(url)),
        ),
      ),
    [pages],
  );
  const assignedUrlCount = new Set(
    document.nodes
      .flatMap((node) =>
        node.sourceUrls
          .map(normalizeTopicalCandidateUrl)
          .filter((url): url is string => Boolean(url)),
      )
      .filter((url) => crawledUrls.has(url)),
  ).size;
  const matchingTopics = document.nodes.filter(
    (node) =>
      !workspacePreferences.search ||
      `${node.title} ${node.evidenceTerms.join(" ")}`
        .toLocaleLowerCase()
        .includes(workspacePreferences.search.toLocaleLowerCase()),
  );
  const updateWorkspacePreferences = (
    patch: Partial<TopicalWorkspacePreferences>,
  ) => setWorkspacePreferences((current) => ({ ...current, ...patch }));
  const moveTopicalNode = (nodeId: string, parentId: string | null) => {
    const current = documentRef.current;
    const node = current.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.parentId === parentId) return;
    const next = setTopicalNodeParent(current, nodeId, parentId);
    if (next === current) {
      setHierarchyNotice(t("semanticWorkspace.cannotCreateCycle"));
      return;
    }
    persist(next);
    const parentTitle = parentId
      ? current.nodes.find((candidate) => candidate.id === parentId)?.title
      : null;
    setHierarchyNotice(
      parentTitle
        ? t("semanticWorkspace.assignedToParent", {
            node: node.title,
            parent: parentTitle,
          })
        : t("semanticWorkspace.assignedToRoot", { node: node.title }),
    );
  };
  const dropTopicOn =
    (parentId: string | null) => (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      const nodeId = event.dataTransfer.getData("text/plain") || draggingNodeId;
      if (nodeId) moveTopicalNode(nodeId, parentId);
      setDraggingNodeId(null);
    };
  const addNode = () => {
    const node = createTopicalNode();
    persist({
      ...documentRef.current,
      nodes: [...documentRef.current.nodes, node],
    });
    setSelectedId(node.id);
  };
  const addNodeOnDate = (date: string) => {
    const node = { ...createTopicalNode(), scheduledDate: date };
    persist({
      ...documentRef.current,
      nodes: [...documentRef.current.nodes, node],
    });
    setSelectedId(node.id);
    updateWorkspacePreferences({ view: "topics" });
  };
  const updateNode = (nodeId: string, update: Partial<TopicalNode>) => {
    const nextDocument = {
      ...documentRef.current,
      nodes: documentRef.current.nodes.map((node) => {
        if (node.id !== nodeId) return node;
        const next = { ...node, ...update };
        const assessment = assessContentBrief(
          next,
          next.contentBrief,
          [...documentRef.current.entity.facts, ...next.facts],
          pages,
        );
        if (next.lifecycle === "drafted" && !assessment.readyToAdvance)
          next.lifecycle = "briefed";
        if (next.lifecycle === "briefed" && !assessment.readyForBrief)
          next.lifecycle = "planned";
        return next;
      }),
    };
    persist(nextDocument);
  };
  const updateEntity = (update: Partial<TopicalMapDocument["entity"]>) => {
    const entity = { ...documentRef.current.entity, ...update };
    const nodes = documentRef.current.nodes.map((node) => {
      const assessment = assessContentBrief(
        node,
        node.contentBrief,
        [...entity.facts, ...node.facts],
        pages,
      );
      if (node.lifecycle === "drafted" && !assessment.readyToAdvance)
        return { ...node, lifecycle: "briefed" as const };
      if (node.lifecycle === "briefed" && !assessment.readyForBrief)
        return { ...node, lifecycle: "planned" as const };
      return node;
    });
    persist({ ...documentRef.current, entity, nodes });
  };
  const importClusters = () => {
    const next = importCrawlClusters(documentRef.current, graph, pages, runId);
    const imported = next.nodes.find(
      (node) =>
        !documentRef.current.nodes.some((current) => current.id === node.id),
    );
    persist(next);
    if (imported) setSelectedId(imported.id);
  };
  const importQueryEvidence = (source: "dataforseo" | "gsc") => {
    if (!selectedNode) return;
    const input =
      source === "dataforseo" && keywordResultsSource
        ? keywordResults.map((item) => ({
            text: item.keyword,
            source: {
              provider:
                "DataForSEO Google Ads Keywords for Keywords Live" as const,
              ...keywordResultsSource,
              searchVolume: item.sourceMetrics?.searchVolume ?? null,
              cpc: item.sourceMetrics?.cpc ?? null,
              competitionIndex: item.sourceMetrics?.competitionIndex ?? null,
              searchIntent: item.sourceMetrics?.intent ?? null,
              monthlySearches: item.sourceMetrics?.monthlySearches ?? [],
            },
          }))
        : source === "gsc" && gscData && gscDataFetchedAt
          ? gscData.queries.map((item) => ({
              text: item.query,
              source: {
                provider: "Google Search Console" as const,
                retrievedAt: gscDataFetchedAt,
                propertyUrl: gscData.site_url || gscProperty,
                startDate: gscData.start_date,
                endDate: gscData.end_date,
                clicks: item.clicks,
                impressions: item.impressions,
                ctr: item.ctr,
                position: item.position,
                queryRowsMayBeTruncated: gscData.queries_may_be_truncated,
                maxRowsPerDimension: gscData.max_rows_per_dimension,
              },
            }))
          : [];
    if (!input.length) return;
    const imported = importTopicalQueries(
      documentRef.current,
      selectedNode.id,
      input,
    );
    if (imported.document !== documentRef.current) persist(imported.document);
    const details = [
      t("semanticWorkspace.importAdded", {
        count: imported.addedCount,
        source:
          source === "gsc"
            ? t("semanticWorkspace.sourceGsc")
            : t("semanticWorkspace.sourceDataForSeo"),
      }),
      imported.updatedCount
        ? t("semanticWorkspace.importUpdated", { count: imported.updatedCount })
        : "",
      imported.duplicateCount > imported.updatedCount
        ? t("semanticWorkspace.importSkipped", {
            count: imported.duplicateCount - imported.updatedCount,
          })
        : "",
      imported.limitReached ? t("semanticWorkspace.importLimit") : "",
      source === "gsc" && gscData?.queries_may_be_truncated
        ? t("semanticWorkspace.importTruncated")
        : "",
    ].filter(Boolean);
    setQueryImportNotice(details.join(" "));
  };
  const updateManualQueries = (value: string) => {
    if (!selectedNode) return;
    const result = updateManualTopicalQueries(selectedNode, value);
    updateNode(selectedNode.id, { queries: result.queries });
    setQueryImportNotice(
      result.limitReached ? t("semanticWorkspace.manualQueryLimit") : "",
    );
  };
  const addEntityFact = () => {
    const attribute = factDraft.attribute.trim();
    const value = factDraft.value.trim();
    if (!attribute || !value) return;
    updateEntity({
      facts: [
        ...documentRef.current.entity.facts,
        {
          id: createId("fact"),
          attribute: attribute.slice(0, 120),
          value: value.slice(0, 1000),
          sourceUrl: factDraft.sourceUrl.trim().slice(0, 2048),
          reuseStatus: "locked",
        },
      ],
    });
    setFactDraft({ attribute: "", value: "", sourceUrl: "" });
  };
  const addTopicFact = () => {
    if (!selectedNode) return;
    const attribute = topicFactDraft.attribute.trim();
    const value = topicFactDraft.value.trim();
    if (!attribute || !value) return;
    updateNode(selectedNode.id, {
      facts: [
        ...selectedNode.facts,
        {
          id: createId("fact"),
          attribute: attribute.slice(0, 120),
          value: value.slice(0, 1000),
          sourceUrl: topicFactDraft.sourceUrl.trim().slice(0, 2048),
          reuseStatus: "locked",
        },
      ],
    });
    setTopicFactDraft({ attribute: "", value: "", sourceUrl: "" });
  };

  if (!projectId)
    return (
      <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5 text-sm text-amber-100">
        {t("semanticWorkspace.noProject")}
      </section>
    );

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 rounded-xl border border-emerald-500/20 bg-[linear-gradient(112deg,rgba(16,185,129,.09),rgba(15,23,42,.15)_42%,rgba(59,130,246,.05))] p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-emerald-300">
            {t("semanticWorkspace.headerEyebrow", {
              count: document.nodes.length,
            })}
          </p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-100">
            {t("semanticWorkspace.title")}
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
            {t("semanticWorkspace.description")}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric
            label={t("semanticWorkspace.metricCore")}
            value={
              document.nodes.filter((node) => node.boundary === "core").length
            }
          />
          <Metric
            label={t("semanticWorkspace.metricOuter")}
            value={
              document.nodes.filter((node) => node.boundary === "outer").length
            }
          />
          <Metric
            label={t("semanticWorkspace.metricAssignedUrls")}
            value={assignedUrlCount}
          />
        </div>
      </header>

      <div
        role="tablist"
        aria-label={t("semanticWorkspace.viewsAria")}
        className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900/45 p-2"
      >
        {(
          [
            ["topics", t("semanticWorkspace.tabTopics")],
            ["calendar", t("semanticWorkspace.tabCalendar")],
            ["audit", t("semanticWorkspace.tabAudit")],
            ["entity", t("semanticWorkspace.tabEntity")],
            ["links", t("semanticWorkspace.tabLinks")],
            ["schema", t("semanticWorkspace.tabSchema")],
          ] as const
        ).map(([view, label]) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={workspacePreferences.view === view}
            onClick={() => updateWorkspacePreferences({ view })}
            className={`rounded-lg border px-3 py-2 text-xs transition-colors ${workspacePreferences.view === view ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100" : "border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-100"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {saveError && (
        <p
          role="alert"
          className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-200"
        >
          {t("semanticWorkspace.saveError")}
        </p>
      )}
      {preferencesSaveError && (
        <p
          role="alert"
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200"
        >
          {t("semanticWorkspace.preferencesSaveError")}
        </p>
      )}

      {workspacePreferences.view !== "audit" && (
        <>
          <section className="rounded-xl border border-slate-800 bg-slate-900/45 p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-100">
                  {t("semanticWorkspace.entityTitle")}
                </h4>
                <p className="mt-1 text-[11px] text-slate-500">
                  {t("semanticWorkspace.entityDescription")}
                </p>
              </div>
              <span className="rounded border border-slate-700 px-2 py-1 font-mono text-[10px] text-slate-500">
                {t("semanticWorkspace.eavCount", {
                  count: document.entity.facts.length,
                })}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className={labelClass}>
                {t("semanticWorkspace.entityLabel")}
                <input
                  className={inputClass}
                  value={document.entity.name}
                  maxLength={180}
                  onChange={(event) =>
                    updateEntity({ name: event.target.value })
                  }
                  placeholder={t("semanticWorkspace.entityPlaceholder")}
                />
              </label>
              <label className={labelClass}>
                {t("semanticWorkspace.contextLabel")}
                <textarea
                  className="mt-1 min-h-20 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                  value={document.entity.description}
                  maxLength={5000}
                  onChange={(event) =>
                    updateEntity({ description: event.target.value })
                  }
                  placeholder={t("semanticWorkspace.contextPlaceholder")}
                />
              </label>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[.8fr_1fr_1.4fr_auto] sm:items-end">
              <label className={labelClass}>
                {t("semanticWorkspace.factAttribute")}
                <input
                  className={inputClass}
                  value={factDraft.attribute}
                  maxLength={120}
                  onChange={(event) =>
                    setFactDraft((current) => ({
                      ...current,
                      attribute: event.target.value,
                    }))
                  }
                  placeholder={t("semanticWorkspace.factAttributePlaceholder")}
                />
              </label>
              <label className={labelClass}>
                {t("semanticWorkspace.factValue")}
                <input
                  className={inputClass}
                  value={factDraft.value}
                  maxLength={1000}
                  onChange={(event) =>
                    setFactDraft((current) => ({
                      ...current,
                      value: event.target.value,
                    }))
                  }
                  placeholder={t("semanticWorkspace.factValuePlaceholder")}
                />
              </label>
              <label className={labelClass}>
                {t("semanticWorkspace.sourceOptional")}
                <input
                  className={inputClass}
                  value={factDraft.sourceUrl}
                  onChange={(event) =>
                    setFactDraft((current) => ({
                      ...current,
                      sourceUrl: event.target.value,
                    }))
                  }
                  placeholder={t("semanticWorkspace.sourceUrlPlaceholder")}
                />
              </label>
              <button
                type="button"
                onClick={addEntityFact}
                disabled={
                  !factDraft.attribute.trim() || !factDraft.value.trim()
                }
                className="h-9 rounded-md border border-slate-700 px-3 text-xs text-slate-200 hover:border-emerald-400 disabled:opacity-40"
              >
                {t("semanticWorkspace.addFact")}
              </button>
            </div>
            {document.entity.facts.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-800 rounded-lg border border-slate-800">
                {document.entity.facts.map((fact) => (
                  <li
                    key={fact.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                  >
                    <span className="min-w-0">
                      <strong className="text-slate-300">
                        {fact.attribute}:
                      </strong>{" "}
                      <span className="text-slate-400">{fact.value}</span>
                      {fact.sourceUrl && (
                        <a
                          href={fact.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 break-all text-[10px] text-sky-300"
                        >
                          {t("semanticWorkspace.source")}
                        </a>
                      )}
                      <span
                        className={`ml-2 text-[9px] ${fact.reuseStatus === "verified" ? "text-emerald-300" : "text-amber-300"}`}
                      >
                        {fact.reuseStatus === "verified"
                          ? t("semanticWorkspace.verified")
                          : t("semanticWorkspace.locked")}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <label className="flex items-center gap-1 text-[9px] text-slate-500">
                        <input
                          type="checkbox"
                          aria-label={t("semanticWorkspace.confirmFact", {
                            attribute: fact.attribute,
                          })}
                          checked={fact.reuseStatus === "verified"}
                          disabled={!fact.sourceUrl}
                          onChange={(event) =>
                            updateEntity({
                              facts: documentRef.current.entity.facts.map(
                                (item) =>
                                  item.id === fact.id
                                    ? {
                                        ...item,
                                        reuseStatus: event.target.checked
                                          ? "verified"
                                          : "locked",
                                      }
                                    : item,
                              ),
                            })
                          }
                        />
                        {t("semanticWorkspace.confirmedByMe")}
                      </label>
                      <button
                        type="button"
                        aria-label={t("semanticWorkspace.removeFact", {
                          attribute: fact.attribute,
                        })}
                        onClick={() =>
                          updateEntity({
                            facts: documentRef.current.entity.facts.filter(
                              (item) => item.id !== fact.id,
                            ),
                          })
                        }
                        className="text-slate-500 hover:text-rose-300"
                      >
                        {t("semanticWorkspace.removeFact", {
                          attribute: fact.attribute,
                        })}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {workspacePreferences.view === "audit" ? (
        <SemanticAuditPanel
          document={document}
          pages={pages}
          runs={runs}
          currentRunId={currentRunId}
        />
      ) : workspacePreferences.view === "entity" ? (
        <EntityEvidenceGraph document={document} pages={pages} />
      ) : workspacePreferences.view === "schema" ? (
        <SchemaGraphBuilder
          document={document}
          pages={pages}
          siteUrl={pages[0]?.url || ""}
          selectedUrl={workspacePreferences.schemaUrl}
          includeOrganization={workspacePreferences.includeSchemaOrganization}
          includeUrlBreadcrumbs={workspacePreferences.includeSchemaBreadcrumbs}
          articleType={workspacePreferences.schemaArticleType}
          onSelectedUrlChange={(schemaUrl) =>
            updateWorkspacePreferences({ schemaUrl })
          }
          onIncludeOrganizationChange={(includeSchemaOrganization) =>
            updateWorkspacePreferences({ includeSchemaOrganization })
          }
          onIncludeUrlBreadcrumbsChange={(includeSchemaBreadcrumbs) =>
            updateWorkspacePreferences({ includeSchemaBreadcrumbs })
          }
          onArticleTypeChange={(schemaArticleType) =>
            updateWorkspacePreferences({ schemaArticleType })
          }
        />
      ) : workspacePreferences.view === "links" ? (
        <InternalLinkOpportunitiesPanel pages={pages} />
      ) : (
        <section
          className={`grid min-h-[560px] gap-4 ${workspacePreferences.view === "calendar" ? "grid-cols-1" : "xl:grid-cols-[minmax(260px,.78fr)_minmax(0,1.6fr)]"}`}
        >
          {workspacePreferences.view === "calendar" ? (
            <TopicalCalendar
              nodes={document.nodes}
              month={workspacePreferences.month}
              filters={workspacePreferences.filters}
              search={workspacePreferences.search}
              onMonthChange={(month) => updateWorkspacePreferences({ month })}
              onFiltersChange={(filters) =>
                updateWorkspacePreferences({ filters })
              }
              onSearchChange={(search) =>
                updateWorkspacePreferences({ search })
              }
              onSelect={(nodeId) => {
                setSelectedId(nodeId);
                updateWorkspacePreferences({ view: "topics" });
              }}
              onCreate={addNodeOnDate}
              onBack={() => updateWorkspacePreferences({ view: "topics" })}
            />
          ) : (
            <div className="flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/45 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-100">
                    {t("semanticWorkspace.topicMap")}
                  </h4>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {t("semanticWorkspace.topicMapDescription")}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    aria-pressed="true"
                    onClick={() =>
                      updateWorkspacePreferences({ view: "topics" })
                    }
                    className="rounded-md border border-slate-700 px-2 py-2 text-[10px] text-slate-300 aria-pressed:border-emerald-500/40 aria-pressed:text-emerald-200"
                  >
                    {t("semanticWorkspace.list")}
                  </button>
                  <button
                    type="button"
                    aria-pressed="false"
                    onClick={() =>
                      updateWorkspacePreferences({ view: "calendar" })
                    }
                    className="rounded-md border border-slate-700 px-2 py-2 text-[10px] text-slate-300 aria-pressed:border-emerald-500/40 aria-pressed:text-emerald-200"
                  >
                    {t("semanticWorkspace.calendar")}
                  </button>
                  <button
                    type="button"
                    onClick={addNode}
                    className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/20"
                  >
                    ＋ {t("semanticWorkspace.topic")}
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={importClusters}
                  disabled={!graph.clusters.length}
                  className="rounded-md border border-slate-700 px-2 py-2 text-[10px] text-slate-300 hover:border-sky-400 disabled:opacity-40"
                >
                  {t("semanticWorkspace.importClusters")}
                </button>
                <span className="self-center text-[10px] text-slate-500">
                  {t("semanticWorkspace.clusterRun", {
                    count: graph.clusters.length,
                    run: runId.slice(0, 12),
                  })}
                </span>
              </div>
              <label className="mt-3">
                <span className="sr-only">
                  {t("semanticWorkspace.searchTopicsAria")}
                </span>
                <input
                  aria-label={t("semanticWorkspace.searchTopicsAria")}
                  className={inputClass}
                  value={workspacePreferences.search}
                  onChange={(event) =>
                    updateWorkspacePreferences({ search: event.target.value })
                  }
                  placeholder={t("semanticWorkspace.searchTopicsPlaceholder")}
                />
              </label>
              <div
                aria-label={t("semanticWorkspace.dropRootAria")}
                onDragOver={(event) => {
                  if (draggingNodeId) event.preventDefault();
                }}
                onDrop={dropTopicOn(null)}
                className={`mt-2 rounded-md border border-dashed px-2.5 py-2 text-[10px] transition-colors ${draggingNodeId ? "border-emerald-400/50 bg-emerald-500/5 text-emerald-200" : "border-slate-800 text-slate-600"}`}
              >
                {t("semanticWorkspace.dropRootHint")}
              </div>
              {hierarchyNotice && (
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-2 rounded-md border border-slate-800 bg-slate-950/50 px-2.5 py-2 text-[10px] text-slate-300"
                >
                  {hierarchyNotice}
                </p>
              )}
              <ul className="mt-3 min-h-48 flex-1 space-y-1 overflow-y-auto pr-1">
                {matchingTopics.map((node) => {
                  const pageCount = node.sourceUrls.filter((url) =>
                    crawledUrls.has(normalizeTopicalCandidateUrl(url) || ""),
                  ).length;
                  const parentTitle = node.parentId
                    ? document.nodes.find(
                        (candidate) => candidate.id === node.parentId,
                      )?.title
                    : null;
                  const depth = topicalNodeDepth(node, document.nodes);
                  return (
                    <li
                      key={node.id}
                      style={{ marginLeft: `${Math.min(depth, 5) * 12}px` }}
                    >
                      <button
                        type="button"
                        draggable
                        aria-label={t("semanticWorkspace.topicAria", {
                          title: node.title,
                        })}
                        aria-pressed={selectedId === node.id}
                        onClick={() => setSelectedId(node.id)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", node.id);
                          setDraggingNodeId(node.id);
                          setHierarchyNotice(
                            t("semanticWorkspace.dropTopicNotice"),
                          );
                        }}
                        onDragEnd={() => setDraggingNodeId(null)}
                        onDragOver={(event) => {
                          if (draggingNodeId && draggingNodeId !== node.id)
                            event.preventDefault();
                        }}
                        onDrop={dropTopicOn(node.id)}
                        className={`w-full rounded-lg border p-2.5 text-left transition-colors ${selectedId === node.id ? "border-emerald-500/40 bg-emerald-500/10" : draggingNodeId === node.id ? "border-sky-500/40 opacity-60" : "border-transparent hover:border-slate-700 hover:bg-slate-950/60"}`}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0 truncate text-xs font-medium text-slate-200">
                            {node.title}
                          </span>
                          <span className="shrink-0 text-[9px] text-slate-500">
                            {nodeKindLabels[node.kind]}
                          </span>
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1.5 text-[9px] text-slate-500">
                          <span>
                            {node.boundary === "core"
                              ? t("semanticWorkspace.core")
                              : t("semanticWorkspace.outer")}
                          </span>
                          <span>·</span>
                          <span>{lifecycleLabels[node.lifecycle]}</span>
                          {node.sourceRunId && (
                            <>
                              <span>·</span>
                              <span>
                                {t("semanticWorkspace.urlCount", {
                                  count: pageCount,
                                })}
                              </span>
                            </>
                          )}
                          {parentTitle && (
                            <>
                              <span>·</span>
                              <span>
                                {t("semanticWorkspace.parent", {
                                  title: parentTitle,
                                })}
                              </span>
                            </>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {matchingTopics.length === 0 && (
                  <li className="rounded-lg border border-dashed border-slate-800 p-5 text-center">
                    <p className="text-xs text-slate-400">
                      {document.nodes.length
                        ? t("semanticWorkspace.noTopicMatches")
                        : t("semanticWorkspace.emptyMap")}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-600">
                      {t("semanticWorkspace.emptyMapHint")}
                    </p>
                  </li>
                )}
              </ul>
              <p className="mt-2 border-t border-slate-800 pt-2 text-[9px] leading-4 text-slate-600">
                {t("semanticWorkspace.mappingNote")}
              </p>
            </div>
          )}

          {workspacePreferences.view === "topics" &&
            (selectedNode ? (
              <article className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/45 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-emerald-300">
                      {t("semanticWorkspace.editTopic")}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {t("semanticWorkspace.autoSaved")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        !window.confirm(
                          t("semanticWorkspace.confirmDeleteTopic", {
                            title: selectedNode.title,
                          }),
                        )
                      )
                        return;
                      persist({
                        ...documentRef.current,
                        nodes: documentRef.current.nodes
                          .filter((node) => node.id !== selectedNode.id)
                          .map((node) =>
                            node.parentId === selectedNode.id
                              ? { ...node, parentId: null }
                              : node,
                          ),
                      });
                      setSelectedId(null);
                    }}
                    className="rounded-md border border-rose-500/20 px-2.5 py-1.5 text-[10px] text-rose-300 hover:bg-rose-500/10"
                  >
                    {t("semanticWorkspace.removeTopic")}
                  </button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <label
                    className={`${labelClass} md:col-span-2 xl:col-span-1`}
                  >
                    {t("semanticWorkspace.name")}
                    <input
                      className={inputClass}
                      value={selectedNode.title}
                      maxLength={180}
                      onChange={(event) =>
                        updateNode(selectedNode.id, {
                          title: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className={labelClass}>
                    {t("semanticWorkspace.type")}
                    <select
                      className={inputClass}
                      value={selectedNode.kind}
                      onChange={(event) =>
                        updateNode(selectedNode.id, {
                          kind: event.target.value as TopicalNode["kind"],
                        })
                      }
                    >
                      {Object.entries(nodeKindLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    {t("semanticWorkspace.scope")}
                    <select
                      className={inputClass}
                      value={selectedNode.boundary}
                      onChange={(event) =>
                        updateNode(selectedNode.id, {
                          boundary: event.target
                            .value as TopicalNode["boundary"],
                        })
                      }
                    >
                      <option value="core">
                        {t("semanticWorkspace.coreOption")}
                      </option>
                      <option value="outer">
                        {t("semanticWorkspace.outerOption")}
                      </option>
                    </select>
                  </label>
                  <label className={labelClass}>
                    {t("semanticWorkspace.intentLabel")}
                    <select
                      className={inputClass}
                      value={selectedNode.intent}
                      onChange={(event) =>
                        updateNode(selectedNode.id, {
                          intent: event.target.value as SearchIntent,
                        })
                      }
                    >
                      {Object.entries(intentLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    {t("semanticWorkspace.lifecycleLabel")}
                    <select
                      className={inputClass}
                      value={selectedNode.lifecycle}
                      onChange={(event) => {
                        const next = event.target
                          .value as TopicalNode["lifecycle"];
                        if (
                          next === "briefed" &&
                          !selectedBriefAssessment?.readyForBrief
                        )
                          return;
                        if (
                          next === "drafted" &&
                          !selectedBriefAssessment?.readyToAdvance
                        )
                          return;
                        updateNode(selectedNode.id, { lifecycle: next });
                      }}
                    >
                      {Object.entries(lifecycleLabels).map(([value, label]) => (
                        <option
                          key={value}
                          value={value}
                          disabled={
                            (value === "briefed" &&
                              !selectedBriefAssessment?.readyForBrief) ||
                            (value === "drafted" &&
                              !selectedBriefAssessment?.readyToAdvance)
                          }
                        >
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    {t("semanticWorkspace.publishDate")}
                    <input
                      type="date"
                      className={inputClass}
                      value={selectedNode.scheduledDate}
                      onChange={(event) =>
                        updateNode(selectedNode.id, {
                          scheduledDate: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className={labelClass}>
                    {t("semanticWorkspace.parentTopic")}
                    <select
                      className={inputClass}
                      value={selectedNode.parentId ?? ""}
                      onChange={(event) =>
                        moveTopicalNode(
                          selectedNode.id,
                          event.target.value || null,
                        )
                      }
                    >
                      <option value="">
                        {t("semanticWorkspace.noParent")}
                      </option>
                      {document.nodes
                        .filter((node) => node.id !== selectedNode.id)
                        .map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.title}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>

                {document.nodes.length > 1 && (
                  <fieldset className="mt-4 rounded-lg border border-slate-800 p-3">
                    <legend className="px-1 text-[11px] font-medium text-slate-400">
                      {t("semanticWorkspace.relatedTopics")}
                    </legend>
                    <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
                      {document.nodes
                        .filter((node) => node.id !== selectedNode.id)
                        .map((node) => (
                          <label
                            key={node.id}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-slate-800 px-2 py-1.5 text-[10px] text-slate-400 hover:border-slate-600"
                          >
                            <input
                              type="checkbox"
                              checked={selectedNode.relatedNodeIds.includes(
                                node.id,
                              )}
                              onChange={() =>
                                persist(
                                  toggleTopicalLateralRelation(
                                    documentRef.current,
                                    selectedNode.id,
                                    node.id,
                                  ),
                                )
                              }
                            />
                            {node.title}
                          </label>
                        ))}
                    </div>
                  </fieldset>
                )}

                <section
                  aria-label={t("semanticWorkspace.querySectionAria")}
                  className="mt-4 rounded-lg border border-slate-800 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h5 className="text-xs font-semibold text-slate-300">
                        {t("semanticWorkspace.queryNetwork")}{" "}
                        <span className="font-normal text-slate-600">
                          {t("semanticWorkspace.queryNetworkHint")}
                        </span>
                      </h5>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {t("semanticWorkspace.queryDescription")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        aria-label={t("semanticWorkspace.importDataForSeoAria")}
                        disabled={
                          !keywordResultsSource ||
                          !keywordResults.length ||
                          isKeywordLoading
                        }
                        onClick={() => importQueryEvidence("dataforseo")}
                        className="rounded border border-sky-500/25 px-2.5 py-1.5 text-[10px] text-sky-200 hover:bg-sky-500/10 disabled:opacity-40"
                      >
                        {t("semanticWorkspace.importDataForSeoButton", {
                          count: keywordResults.length,
                        })}
                      </button>
                      <button
                        type="button"
                        aria-label={t("semanticWorkspace.importGscAria")}
                        disabled={
                          !gscData ||
                          !gscDataFetchedAt ||
                          !gscData.queries.length
                        }
                        onClick={() => importQueryEvidence("gsc")}
                        className="rounded border border-emerald-500/25 px-2.5 py-1.5 text-[10px] text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-40"
                      >
                        {t("semanticWorkspace.sourceGsc")} · {gscData?.queries.length ?? 0}
                      </button>
                    </div>
                  </div>
                  <textarea
                    aria-label={t("semanticWorkspace.manualQueriesAria")}
                    className="mt-2 min-h-24 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs leading-5 text-slate-100 outline-none focus:border-emerald-400"
                    value={selectedNode.queries
                      .filter((query) => query.provenance === "asserted")
                      .map((query) => query.text)
                      .join("\n")}
                    maxLength={24000}
                    onChange={(event) =>
                      updateManualQueries(event.target.value)
                    }
                    placeholder={t(
                      "semanticWorkspace.manualQueriesPlaceholder",
                    )}
                  />
                  <p className="mt-1 text-[9px] text-slate-600">
                    {t("semanticWorkspace.queryCount", {
                      count: selectedNode.queries.length,
                    })}
                  </p>
                  {queryImportNotice && (
                    <p
                      role="status"
                      className="mt-2 rounded border border-sky-500/20 bg-sky-500/5 p-2 text-[10px] text-sky-200"
                    >
                      {queryImportNotice}
                    </p>
                  )}
                  <ul
                    aria-label={t("semanticWorkspace.queryOriginAria")}
                    className="mt-2 max-h-56 space-y-1 overflow-y-auto"
                  >
                    {selectedNode.queries.map((query) => (
                      <li
                        key={query.id}
                        className="rounded border border-slate-800/80 px-2 py-1.5 text-[10px]"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="font-medium text-slate-200">
                            {query.text}
                          </span>
                          <span
                            className={`rounded border px-1.5 py-0.5 ${query.provenance === "dataforseo" ? "border-sky-500/20 text-sky-300" : query.provenance === "gsc" ? "border-emerald-500/20 text-emerald-300" : "border-slate-700 text-slate-500"}`}
                          >
                            {query.provenance === "dataforseo"
                              ? t("semanticWorkspace.sourceDataForSeo")
                              : query.provenance === "gsc"
                                ? t("semanticWorkspace.sourceGsc")
                                : t("semanticWorkspace.asserted")}
                          </span>
                        </div>
                        {query.source?.provider ===
                          "DataForSEO Google Ads Keywords for Keywords Live" && (
                          <p className="mt-1 break-words text-slate-500">
                            {query.source.countryCode} ·{" "}
                            {t("semanticWorkspace.location")}{" "}
                            {query.source.locationCode} ·{" "}
                            {query.source.languageCode} ·{" "}
                            {t("semanticWorkspace.retrieved")}{" "}
                            {query.source.retrievedAt} ·{" "}
                            {t("semanticWorkspace.seed")}{" "}
                            {query.source.seedKeyword}
                            <br />
                            {t("semanticWorkspace.searchVolume")}:{" "}
                            {sourceMetric(query.source.searchVolume)} · {t("semanticWorkspace.cpc")}:{" "}
                            {t("semanticWorkspace.cpc")}: {sourceMetric(query.source.cpc)} ·{" "}
                            {t("semanticWorkspace.competitionIndex")}:{" "}
                            {sourceMetric(query.source.competitionIndex)} ·{" "}
                            {t("semanticWorkspace.providerIntent")}:{" "}
                            {query.source.searchIntent ||
                              t("semanticWorkspace.noValue")}{" "}
                            · {t("semanticWorkspace.monthlyObservations")}:{" "}
                            {query.source.monthlySearches.length}
                          </p>
                        )}
                        {query.source?.provider === "Google Search Console" && (
                          <p className="mt-1 break-words text-slate-500">
                            {query.source.propertyUrl} ·{" "}
                            {query.source.startDate}–{query.source.endDate} ·{" "}
                            {t("semanticWorkspace.retrieved")}{" "}
                            {query.source.retrievedAt}
                            <br />
                            {t("semanticWorkspace.clicks")}:{" "}
                            {query.source.clicks} ·{" "}
                            {t("semanticWorkspace.impressions")}:{" "}
                            {query.source.impressions} · {t("searchConsole.ctr")}:{" "}
                            {(query.source.ctr * 100).toFixed(2)}% ·{" "}
                            {t("semanticWorkspace.averagePosition")}:{" "}
                            {query.source.position.toFixed(1)}
                            {query.source.queryRowsMayBeTruncated
                              ? ` · ${t("semanticWorkspace.truncatedRows", { count: query.source.maxRowsPerDimension })}`
                              : ""}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                  {!keywordResultsSource && (
                    <p className="mt-2 text-[9px] text-slate-600">
                      {t("semanticWorkspace.noQuerySource")}
                    </p>
                  )}
                </section>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <h5 className="text-xs font-semibold text-slate-300">
                        {t("semanticWorkspace.plannedUrls")}
                      </h5>
                      <span className="text-[9px] text-slate-600">
                        {t("semanticWorkspace.currentRunCount", {
                          count: selectedNode.sourceUrls.filter((url) =>
                            crawledUrls.has(
                              normalizeTopicalCandidateUrl(url) || "",
                            ),
                          ).length,
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-[9px] leading-4 text-slate-600">
                      {t("semanticWorkspace.plannedUrlsDescription")}
                    </p>
                    <label className="mt-2 block">
                      <span className="sr-only">
                        {t("semanticWorkspace.searchUrlAria")}
                      </span>
                      <input
                        aria-label={t("semanticWorkspace.searchUrlAria")}
                        value={pageSearch}
                        onChange={(event) => setPageSearch(event.target.value)}
                        className={inputClass}
                        placeholder={t(
                          "semanticWorkspace.searchUrlPlaceholder",
                        )}
                      />
                    </label>
                    <ul className="mt-2 max-h-48 divide-y divide-slate-800 overflow-y-auto rounded-md border border-slate-800">
                      {availableUrlCandidates.map((candidate) => {
                        const { url } = candidate;
                        const checked = selectedNode.sourceUrls.some(
                          (item) => normalizeTopicalCandidateUrl(item) === url,
                        );
                        const sourceLabel =
                          candidate.source === "crawl"
                            ? t("semanticWorkspace.sourceCrawl")
                            : candidate.source === "content-link"
                              ? t("semanticWorkspace.sourceContentLink")
                              : candidate.source === "sitemap"
                                ? t("semanticWorkspace.sourceSitemap")
                                : t("semanticWorkspace.sourceSaved");
                        let path = url;
                        try {
                          path =
                            new URL(url).pathname + new URL(url).search || "/";
                        } catch {
                          /* URL was validated while candidates were built. */
                        }
                        const candidateLabel =
                          candidate.source === "content-link" && candidate.title
                            ? t("semanticWorkspace.linkText", {
                                title: candidate.title,
                              })
                            : candidate.title || url;
                        return (
                          <li key={url}>
                            <label className="flex cursor-pointer items-center gap-2 px-2 py-2 text-[10px] hover:bg-slate-950/60">
                              <input
                                type="checkbox"
                                aria-label={t("semanticWorkspace.assignUrlToTopic", {
                                  url,
                                  topic: selectedNode.title,
                                })}
                                checked={checked}
                                onChange={() => {
                                  const sourceUrls = checked
                                    ? selectedNode.sourceUrls.filter(
                                        (item) =>
                                          normalizeTopicalCandidateUrl(item) !==
                                          url,
                                      )
                                    : [...selectedNode.sourceUrls, url].slice(
                                        0,
                                        1000,
                                      );
                                  updateNode(selectedNode.id, { sourceUrls });
                                }}
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-mono text-slate-300">
                                  {path || "/"}
                                </span>
                                <span className="block truncate text-slate-600">
                                  {candidateLabel}
                                </span>
                                <span
                                  className={`block truncate ${candidate.source === "crawl" ? "text-emerald-400" : "text-amber-400"}`}
                                >
                                  {sourceLabel}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                      {availableUrlCandidates.length === 0 && (
                        <li className="p-3 text-[10px] text-slate-600">
                          {t("semanticWorkspace.noUrlCandidates")}
                        </li>
                      )}
                    </ul>
                    {matchingUrlCandidates.length > 100 && (
                      <p className="mt-1 text-[9px] text-slate-600">
                        {t("semanticWorkspace.urlCandidatesLimited", {
                          count: matchingUrlCandidates.length,
                        })}
                      </p>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h5 className="text-xs font-semibold text-slate-300">
                      {t("semanticWorkspace.crawlSignals")}{" "}
                      <span className="font-normal text-slate-600">
                        {t("semanticWorkspace.contentEvidenceOnly")}
                      </span>
                    </h5>
                    {selectedNode.evidenceTerms.length ? (
                      <div className="mt-2 flex max-h-28 flex-wrap content-start gap-1 overflow-y-auto">
                        {selectedNode.evidenceTerms.map((term) => (
                          <span
                            key={term}
                            className="rounded border border-sky-500/15 bg-sky-500/5 px-1.5 py-1 text-[9px] text-sky-200"
                          >
                            {term}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 rounded-md border border-dashed border-slate-800 p-3 text-[10px] text-slate-600">
                        {t("semanticWorkspace.noImportedTerms")}
                      </p>
                    )}
                    <h5 className="mt-4 text-xs font-semibold text-slate-300">
                      {t("semanticWorkspace.topicFacts")}{" "}
                      <span className="font-normal text-slate-600">
                        {t("semanticWorkspace.manualProvenance")}
                      </span>
                    </h5>
                    <div className="mt-2 space-y-2">
                      {selectedNode.facts.map((fact) => (
                        <div
                          key={fact.id}
                          className="flex items-start justify-between gap-2 rounded border border-slate-800 px-2 py-1.5 text-[10px]"
                        >
                          <span className="min-w-0 break-words text-slate-400">
                            <strong className="text-slate-300">
                              {fact.attribute}:
                            </strong>{" "}
                            {fact.value}
                            {fact.sourceUrl && (
                              <a
                                href={fact.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-1 text-sky-300"
                              >
                                {t("semanticWorkspace.source")}
                              </a>
                            )}
                            <FactReuseToggle
                              fact={fact}
                              onChange={(reuseStatus) =>
                                updateNode(selectedNode.id, {
                                  facts: selectedNode.facts.map((item) =>
                                    item.id === fact.id
                                      ? { ...item, reuseStatus }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </span>
                          <button
                            type="button"
                            aria-label={t(
                              "semanticWorkspace.removeTopicAttribute",
                              { attribute: fact.attribute },
                            )}
                            onClick={() =>
                              updateNode(selectedNode.id, {
                                facts: selectedNode.facts.filter(
                                  (item) => item.id !== fact.id,
                                ),
                              })
                            }
                            className="shrink-0 text-slate-600 hover:text-rose-300"
                          >
                            {t("semanticWorkspace.removeTopicAttribute", {
                              attribute: fact.attribute,
                            })}
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 grid gap-2">
                      <input
                        aria-label={t("semanticWorkspace.topicAttribute")}
                        value={topicFactDraft.attribute}
                        onChange={(event) =>
                          setTopicFactDraft((current) => ({
                            ...current,
                            attribute: event.target.value,
                          }))
                        }
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-[10px] text-slate-200"
                        placeholder={t(
                          "semanticWorkspace.entityAttributePlaceholder",
                        )}
                      />
                      <input
                        aria-label={t("semanticWorkspace.topicValue")}
                        value={topicFactDraft.value}
                        onChange={(event) =>
                          setTopicFactDraft((current) => ({
                            ...current,
                            value: event.target.value,
                          }))
                        }
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-[10px] text-slate-200"
                        placeholder={t(
                          "semanticWorkspace.confirmedValuePlaceholder",
                        )}
                      />
                      <input
                        aria-label={t("semanticWorkspace.topicSource")}
                        value={topicFactDraft.sourceUrl}
                        onChange={(event) =>
                          setTopicFactDraft((current) => ({
                            ...current,
                            sourceUrl: event.target.value,
                          }))
                        }
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-[10px] text-slate-200"
                        placeholder={t(
                          "semanticWorkspace.sourceUrlPlaceholder",
                        )}
                      />
                      <button
                        type="button"
                        disabled={
                          !topicFactDraft.attribute.trim() ||
                          !topicFactDraft.value.trim()
                        }
                        onClick={addTopicFact}
                        className="h-8 rounded border border-slate-700 text-[10px] text-slate-300 hover:border-emerald-400 disabled:opacity-40"
                      >
                        {t("semanticWorkspace.addEntityAttribute")}
                      </button>
                    </div>
                  </div>
                </div>
                <ContentBriefEditor
                  node={selectedNode}
                  facts={selectedFacts}
                  pages={pages}
                  onUpdate={(contentBrief) =>
                    updateNode(selectedNode.id, { contentBrief })
                  }
                  onAdvance={() =>
                    updateNode(selectedNode.id, { lifecycle: "drafted" })
                  }
                />
              </article>
            ) : (
              <div className="grid place-content-center rounded-xl border border-dashed border-slate-800 bg-slate-950/20 p-8 text-center">
                <p className="text-sm font-medium text-slate-300">
                  {t("semanticWorkspace.selectTopic")}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {t("semanticWorkspace.selectTopicHint")}
                </p>
              </div>
            ))}
        </section>
      )}
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: number }) => (
  <div className="min-w-20 rounded-md border border-slate-700/70 bg-slate-950/40 px-3 py-2">
    <div className="text-base font-semibold tabular-nums text-slate-100">
      {value}
    </div>
    <div className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-500">
      {label}
    </div>
  </div>
);

const FactReuseToggle = ({
  fact,
  onChange,
}: {
  fact: TopicalEntityFact;
  onChange: (status: TopicalEntityFact["reuseStatus"]) => void;
}) => {
  const { t } = useTranslation();
  return (
    <label
      className={`ml-2 inline-flex items-center gap-1 text-[9px] ${fact.reuseStatus === "verified" ? "text-emerald-300" : "text-amber-300"}`}
    >
      <input
        type="checkbox"
        aria-label={t("semanticWorkspace.confirmFact", {
          attribute: fact.attribute,
        })}
        checked={fact.reuseStatus === "verified"}
        disabled={!fact.sourceUrl}
        onChange={(event) =>
          onChange(event.target.checked ? "verified" : "locked")
        }
      />
      {fact.reuseStatus === "verified"
        ? t("semanticWorkspace.verified")
        : t("semanticWorkspace.locked")}
    </label>
  );
};
