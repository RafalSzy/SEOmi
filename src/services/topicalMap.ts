import type { CrawledPageSummary } from '@/types';
import type { SemanticMap } from '@/services/semanticMap';
import { readStorage, writeStorage } from '@/services/storage';
import i18n from '@/i18n';
import { createId } from '@/services/ids';

export type TopicalNodeKind = 'pillar' | 'cluster' | 'supporting';
export type TopicalBoundary = 'core' | 'outer';
export type TopicalLifecycle = 'planned' | 'briefed' | 'drafted' | 'published' | 'needs-update';
export type SearchIntent = 'informational' | 'commercial' | 'transactional' | 'navigational' | 'mixed' | 'unknown';

export interface TopicalEntityFact {
  id: string;
  attribute: string;
  value: string;
  sourceUrl: string;
  reuseStatus: 'locked' | 'verified';
}

export type SnippetTarget = 'none' | 'definition' | 'list' | 'table' | 'steps' | 'faq';

export interface ContentParagraphReview {
  paragraph: string;
  treatment: 'unreviewed' | 'editorial' | 'source-backed';
  sourceUrl: string;
  sourceChecked: boolean;
}

/** A bounded, user-created checkpoint of the editorial draft. */
export interface ContentBriefVersion {
  id: string;
  savedAt: string;
  note: string;
  draftMarkdown: string;
}

export interface DataForSeoTopicalEvidence {
  provider: 'DataForSEO Google Ads Keywords for Keywords Live';
  retrievedAt: string;
  seedKeyword: string;
  countryCode: string;
  locationCode: number;
  languageCode: string;
  searchVolume: number | null;
  cpc: number | null;
  competitionIndex: number | null;
  searchIntent: string | null;
  monthlySearches: Array<{ year: number | null; month: number | null; searchVolume: number | null }>;
}

export interface GscTopicalEvidence {
  provider: 'Google Search Console';
  retrievedAt: string;
  propertyUrl: string;
  startDate: string;
  endDate: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  queryRowsMayBeTruncated: boolean;
  maxRowsPerDimension: number;
}

export type TopicalQueryEvidence = DataForSeoTopicalEvidence | GscTopicalEvidence;

export interface TopicalContentBrief {
  targetQueryId: string;
  requiredEntities: string[];
  snippetTarget: SnippetTarget;
  internalLinkTargets: string[];
  draftMarkdown: string;
  paragraphReviews: ContentParagraphReview[];
  draftVersions: ContentBriefVersion[];
}

export interface TopicalQuery {
  id: string;
  text: string;
  provenance: 'asserted' | 'dataforseo' | 'gsc';
  source?: TopicalQueryEvidence;
}

export interface TopicalNode {
  id: string;
  title: string;
  kind: TopicalNodeKind;
  boundary: TopicalBoundary;
  parentId: string | null;
  relatedNodeIds: string[];
  intent: SearchIntent;
  lifecycle: TopicalLifecycle;
  scheduledDate: string;
  queries: TopicalQuery[];
  facts: TopicalEntityFact[];
  evidenceTerms: string[];
  sourceUrls: string[];
  sourceRunId: string | null;
  sourceClusterId: string | null;
  contentBrief: TopicalContentBrief;
}

export interface TopicalMapDocument {
  schemaVersion: 1;
  entity: { name: string; description: string; facts: TopicalEntityFact[] };
  nodes: TopicalNode[];
  updatedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const topicalMapStorageKey = (projectId: string) => `seomi_project_${projectId}_topical_map_v1`;
const browserStorage: StorageLike = {
  getItem: readStorage,
  setItem: (key, value) => {
    if (!writeStorage(key, value)) throw new Error(i18n.t('runtimeErrors.topical.workspaceUnavailable'));
  },
};
const MAX_NODES = 300;
const MAX_FACTS = 300;
const MAX_QUERIES_PER_NODE = 100;
const MAX_URLS_PER_NODE = 1000;
const MAX_TERMS_PER_NODE = 80;
const MAX_BRIEF_ENTITIES = 80;
const MAX_BRIEF_LINKS = 50;
const MAX_BRIEF_VERSIONS = 30;

const id = () => createId('topic');
const cleanText = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => values.includes(value as T) ? value as T : fallback;
const validHttpUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href.slice(0, 2048) : null;
  } catch { return null; }
};

export const createEmptyTopicalMap = (): TopicalMapDocument => ({
  schemaVersion: 1,
  entity: { name: '', description: '', facts: [] },
  nodes: [],
  updatedAt: new Date().toISOString(),
});

const normalizeFact = (raw: unknown): TopicalEntityFact | null => {
  if (!raw || typeof raw !== 'object') return null;
  const fact = raw as Record<string, unknown>;
  const attribute = cleanText(fact.attribute, 120);
  const value = cleanText(fact.value, 1000);
  if (!attribute || !value) return null;
  const sourceUrl = validHttpUrl(fact.sourceUrl) ?? '';
  return {
    id: cleanText(fact.id, 100) || id(), attribute, value, sourceUrl,
    // Existing records remain locked until a user explicitly verifies them.
    reuseStatus: sourceUrl && fact.reuseStatus === 'verified' ? 'verified' : 'locked',
  };
};

const normalizeMetric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const normalizeQueryEvidence = (raw: unknown): TopicalQueryEvidence | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  const retrievedAt = cleanText(source.retrievedAt, 40);
  if (source.provider === 'DataForSEO Google Ads Keywords for Keywords Live') {
    const locationCode = normalizeMetric(source.locationCode);
    const seedKeyword = cleanText(source.seedKeyword, 240);
    const countryCode = cleanText(source.countryCode, 16);
    const languageCode = cleanText(source.languageCode, 16);
    if (!retrievedAt || locationCode === null || !seedKeyword || !countryCode || !languageCode) return undefined;
    const monthlySearches = Array.isArray(source.monthlySearches) ? source.monthlySearches.slice(0, 120).flatMap((rawMonth) => {
      if (!rawMonth || typeof rawMonth !== 'object') return [];
      const month = rawMonth as Record<string, unknown>;
      return [{ year: normalizeMetric(month.year), month: normalizeMetric(month.month), searchVolume: normalizeMetric(month.searchVolume) }];
    }) : [];
    return {
      provider: 'DataForSEO Google Ads Keywords for Keywords Live', retrievedAt, seedKeyword, countryCode,
      locationCode, languageCode, searchVolume: normalizeMetric(source.searchVolume), cpc: normalizeMetric(source.cpc),
      competitionIndex: normalizeMetric(source.competitionIndex), searchIntent: cleanText(source.searchIntent, 80) || null,
      monthlySearches,
    };
  }
  if (source.provider === 'Google Search Console') {
    const propertyUrl = cleanText(source.propertyUrl, 2048);
    const startDate = cleanText(source.startDate, 10);
    const endDate = cleanText(source.endDate, 10);
    const clicks = normalizeMetric(source.clicks);
    const impressions = normalizeMetric(source.impressions);
    const ctr = normalizeMetric(source.ctr);
    const position = normalizeMetric(source.position);
    const maxRowsPerDimension = normalizeMetric(source.maxRowsPerDimension);
    if (!retrievedAt || !propertyUrl || !startDate || !endDate || clicks === null || impressions === null || ctr === null || position === null || maxRowsPerDimension === null) return undefined;
    return {
      provider: 'Google Search Console', retrievedAt, propertyUrl, startDate, endDate, clicks, impressions, ctr, position,
      queryRowsMayBeTruncated: source.queryRowsMayBeTruncated === true, maxRowsPerDimension,
    };
  }
  return undefined;
};

export const createEmptyContentBrief = (): TopicalContentBrief => ({
  targetQueryId: '', requiredEntities: [], snippetTarget: 'none', internalLinkTargets: [], draftMarkdown: '', paragraphReviews: [], draftVersions: [],
});

const normalizeContentBriefVersion = (raw: unknown): ContentBriefVersion | null => {
  if (!raw || typeof raw !== 'object') return null;
  const version = raw as Record<string, unknown>;
  const draftMarkdown = cleanText(version.draftMarkdown, 50_000);
  if (!draftMarkdown) return null;
  const savedAt = cleanText(version.savedAt, 40);
  return {
    id: cleanText(version.id, 100) || id(),
    savedAt: savedAt || new Date(0).toISOString(),
    note: cleanText(version.note, 240),
    draftMarkdown,
  };
};

const normalizeContentBrief = (raw: unknown): TopicalContentBrief => {
  if (!raw || typeof raw !== 'object') return createEmptyContentBrief();
  const brief = raw as Record<string, unknown>;
  const requiredEntities = Array.isArray(brief.requiredEntities)
    ? [...new Set(brief.requiredEntities.map((entity) => cleanText(entity, 120)).filter(Boolean))].slice(0, MAX_BRIEF_ENTITIES)
    : [];
  const internalLinkTargets = Array.isArray(brief.internalLinkTargets)
    ? [...new Set(brief.internalLinkTargets.map(validHttpUrl).filter((url): url is string => Boolean(url)))].slice(0, MAX_BRIEF_LINKS)
    : [];
  const paragraphReviews = Array.isArray(brief.paragraphReviews) ? brief.paragraphReviews.slice(0, 500).flatMap((rawReview) => {
    if (!rawReview || typeof rawReview !== 'object') return [];
    const review = rawReview as Record<string, unknown>;
    const paragraph = cleanText(review.paragraph, 50_000);
    if (!paragraph) return [];
    const treatment = oneOf(review.treatment, ['unreviewed', 'editorial', 'source-backed'] as const, 'unreviewed');
    const sourceUrl = validHttpUrl(review.sourceUrl) ?? '';
    return [{ paragraph, treatment, sourceUrl, sourceChecked: treatment === 'source-backed' && Boolean(sourceUrl) && review.sourceChecked === true }];
  }) : [];
  const draftVersions = Array.isArray(brief.draftVersions)
    ? brief.draftVersions.slice(0, MAX_BRIEF_VERSIONS).flatMap((rawVersion) => {
      const version = normalizeContentBriefVersion(rawVersion);
      return version ? [version] : [];
    })
    : [];
  return {
    targetQueryId: cleanText(brief.targetQueryId, 100),
    requiredEntities,
    snippetTarget: oneOf(brief.snippetTarget, ['none', 'definition', 'list', 'table', 'steps', 'faq'] as const, 'none'),
    internalLinkTargets,
    draftMarkdown: cleanText(brief.draftMarkdown, 50_000),
    paragraphReviews,
    draftVersions,
  };
};

const normalizeNode = (raw: unknown): TopicalNode | null => {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const title = cleanText(item.title, 180);
  if (!title) return null;
  const queries = Array.isArray(item.queries) ? item.queries.slice(0, MAX_QUERIES_PER_NODE).flatMap((query) => {
    if (!query || typeof query !== 'object') return [];
    const value = query as Record<string, unknown>;
    const text = cleanText(value.text, 240);
    if (!text) return [];
    const source = normalizeQueryEvidence(value.source);
    const provenance: TopicalQuery['provenance'] = source?.provider === 'DataForSEO Google Ads Keywords for Keywords Live' ? 'dataforseo' : source?.provider === 'Google Search Console' ? 'gsc' : 'asserted';
    return [{ id: cleanText(value.id, 100) || id(), text, provenance, ...(source ? { source } : {}) }];
  }) : [];
  const facts = Array.isArray(item.facts) ? item.facts.slice(0, MAX_FACTS).map(normalizeFact).filter((fact): fact is TopicalEntityFact => Boolean(fact)) : [];
  const urls = Array.isArray(item.sourceUrls) ? [...new Set(item.sourceUrls.map(validHttpUrl).filter((url): url is string => Boolean(url)))].slice(0, MAX_URLS_PER_NODE) : [];
  const evidenceTerms = Array.isArray(item.evidenceTerms) ? [...new Set(item.evidenceTerms.map((term) => cleanText(term, 100).toLocaleLowerCase()).filter(Boolean))].slice(0, MAX_TERMS_PER_NODE) : [];
  const relatedNodeIds = Array.isArray(item.relatedNodeIds) ? [...new Set(item.relatedNodeIds.map((relatedId) => cleanText(relatedId, 100)).filter((relatedId) => relatedId && relatedId !== cleanText(item.id, 100)))].slice(0, 300) : [];
  const contentBrief = normalizeContentBrief(item.contentBrief);
  if (!queries.some((query) => query.id === contentBrief.targetQueryId)) contentBrief.targetQueryId = '';
  return {
    id: cleanText(item.id, 100) || id(),
    title,
    kind: oneOf(item.kind, ['pillar', 'cluster', 'supporting'] as const, 'cluster'),
    boundary: oneOf(item.boundary, ['core', 'outer'] as const, 'core'),
    parentId: typeof item.parentId === 'string' ? cleanText(item.parentId, 100) || null : null,
    relatedNodeIds,
    intent: oneOf(item.intent, ['informational', 'commercial', 'transactional', 'navigational', 'mixed', 'unknown'] as const, 'unknown'),
    lifecycle: oneOf(item.lifecycle, ['planned', 'briefed', 'drafted', 'published', 'needs-update'] as const, 'planned'),
    scheduledDate: /^\d{4}-\d{2}-\d{2}$/.test(cleanText(item.scheduledDate, 10)) ? cleanText(item.scheduledDate, 10) : '',
    queries,
    facts,
    evidenceTerms,
    sourceUrls: urls,
    sourceRunId: cleanText(item.sourceRunId, 200) || null,
    sourceClusterId: cleanText(item.sourceClusterId, 200) || null,
    contentBrief,
  };
};

export const normalizeTopicalMap = (raw: unknown): TopicalMapDocument => {
  if (!raw || typeof raw !== 'object') return createEmptyTopicalMap();
  const value = raw as Record<string, unknown>;
  const rawEntity = value.entity && typeof value.entity === 'object' ? value.entity as Record<string, unknown> : {};
  const entityFacts = Array.isArray(rawEntity.facts) ? rawEntity.facts.slice(0, MAX_FACTS).map(normalizeFact).filter((fact): fact is TopicalEntityFact => Boolean(fact)) : [];
  const nodes = Array.isArray(value.nodes) ? value.nodes.slice(0, MAX_NODES).map(normalizeNode).filter((node): node is TopicalNode => Boolean(node)) : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes) node.relatedNodeIds = node.relatedNodeIds.filter((relatedId) => nodeIds.has(relatedId));
  // Reject self/unknown parents and break persisted cycles deterministically.
  for (const node of nodes) {
    if (!node.parentId || !nodeIds.has(node.parentId) || node.parentId === node.id) { node.parentId = null; continue; }
    let cursor: string | null = node.parentId;
    const seen = new Set([node.id]);
    while (cursor) {
      if (seen.has(cursor)) { node.parentId = null; break; }
      seen.add(cursor);
      cursor = nodes.find((candidate) => candidate.id === cursor)?.parentId ?? null;
    }
  }
  return {
    schemaVersion: 1,
    entity: { name: cleanText(rawEntity.name, 180), description: cleanText(rawEntity.description, 5000), facts: entityFacts },
    nodes,
    updatedAt: cleanText(value.updatedAt, 40) || new Date().toISOString(),
  };
};

export const readTopicalMap = (projectId: string, storage: StorageLike = browserStorage): TopicalMapDocument => {
  try {
    const raw = storage.getItem(topicalMapStorageKey(projectId));
    return raw ? normalizeTopicalMap(JSON.parse(raw)) : createEmptyTopicalMap();
  } catch { return createEmptyTopicalMap(); }
};

export const writeTopicalMap = (projectId: string, document: TopicalMapDocument, storage: StorageLike = browserStorage): TopicalMapDocument => {
  const normalized = normalizeTopicalMap({ ...document, updatedAt: new Date().toISOString() });
  storage.setItem(topicalMapStorageKey(projectId), JSON.stringify(normalized));
  return normalized;
};

export const createTopicalNode = (title = i18n.t('runtimeErrors.topical.newTopic')): TopicalNode => ({
  id: id(), title: cleanText(title, 180) || i18n.t('runtimeErrors.topical.newTopic'), kind: 'cluster', boundary: 'core', parentId: null, relatedNodeIds: [],
  intent: 'unknown', lifecycle: 'planned', scheduledDate: '', queries: [], facts: [], evidenceTerms: [],
  sourceUrls: [], sourceRunId: null, sourceClusterId: null, contentBrief: createEmptyContentBrief(),
});

export interface TopicalQueryImportResult {
  document: TopicalMapDocument;
  addedCount: number;
  duplicateCount: number;
  updatedCount: number;
  limitReached: boolean;
}

const queryKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const queryEvidenceKey = (source: TopicalQueryEvidence) => source.provider === 'Google Search Console'
  ? `${source.provider}|${source.propertyUrl}|${source.startDate}|${source.endDate}`.toLocaleLowerCase()
  : `${source.provider}|${source.countryCode}|${source.locationCode}|${source.languageCode}|${source.seedKeyword}`.toLocaleLowerCase();

export const importTopicalQueries = (
  document: TopicalMapDocument,
  nodeId: string,
  queries: Array<{ text: string; source: TopicalQueryEvidence }>,
): TopicalQueryImportResult => {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return { document, addedCount: 0, duplicateCount: 0, updatedCount: 0, limitReached: false };
  const nextQueries = [...node.queries];
  const existing = new Map<string, number>(nextQueries.flatMap((query, index) => query.source ? [[`${queryKey(query.text)}|${queryEvidenceKey(query.source)}`, index] as [string, number]] : []));
  let duplicateCount = 0;
  let addedCount = 0;
  let updatedCount = 0;
  let limitReached = false;
  for (const input of queries) {
    const text = cleanText(input.text, 240);
    if (!text) { duplicateCount += 1; continue; }
    const source = normalizeQueryEvidence(input.source);
    if (!source) continue;
    const identity = `${queryKey(text)}|${queryEvidenceKey(source)}`;
    const previousIndex = existing.get(identity);
    if (previousIndex !== undefined) {
      duplicateCount += 1;
      const previous = nextQueries[previousIndex];
      if (source.retrievedAt > (previous.source?.retrievedAt ?? '')) {
        nextQueries[previousIndex] = { ...previous, source };
        updatedCount += 1;
      }
      continue;
    }
    if (nextQueries.length >= MAX_QUERIES_PER_NODE) { limitReached = true; break; }
    existing.set(identity, nextQueries.length);
    nextQueries.push({
      id: id(), text,
      provenance: source.provider === 'Google Search Console' ? 'gsc' : 'dataforseo',
      source,
    });
    addedCount += 1;
  }
  if (!addedCount && !updatedCount) return { document, addedCount: 0, duplicateCount, updatedCount, limitReached };
  return {
    document: { ...document, nodes: document.nodes.map((candidate) => candidate.id === nodeId ? { ...candidate, queries: nextQueries } : candidate) },
    addedCount,
    duplicateCount,
    updatedCount,
    limitReached,
  };
};

export const parseManualTopicalQueries = (text: string, existingQueries: TopicalQuery[]): TopicalQuery[] => {
  const existingByText = new Map(existingQueries.map((query) => [query.text, query]));
  const seen = new Set<string>();
  return text.split('\n').slice(0, MAX_QUERIES_PER_NODE).flatMap((raw, index) => {
    const queryText = cleanText(raw, 240);
    const key = queryKey(queryText);
    if (!queryText || seen.has(key)) return [];
    seen.add(key);
    const preserved = existingByText.get(queryText);
    return preserved ? [preserved] : [{ id: `query-${Date.now().toString(36)}-${index}`, text: queryText, provenance: 'asserted' as const }];
  });
};

export const updateManualTopicalQueries = (node: TopicalNode, text: string): { queries: TopicalQuery[]; limitReached: boolean } => {
  const importedQueries = node.queries.filter((query) => query.provenance !== 'asserted');
  const manualQueries = parseManualTopicalQueries(text, node.queries.filter((query) => query.provenance === 'asserted'));
  const available = Math.max(0, MAX_QUERIES_PER_NODE - importedQueries.length);
  return { queries: [...importedQueries, ...manualQueries.slice(0, available)], limitReached: manualQueries.length > available };
};

export interface TopicalCalendarDay {
  date: string;
  inCurrentMonth: boolean;
}

const formatLocalDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const shiftTopicalCalendarMonth = (month: string, delta: number): string => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  const base = match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  base.setMonth(base.getMonth() + Math.trunc(delta));
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
};

export const topicalCalendarDays = (month: string): TopicalCalendarDay[] => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  const firstOfMonth = match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const year = firstOfMonth.getFullYear();
  const monthIndex = firstOfMonth.getMonth();
  const start = new Date(year, monthIndex, 1);
  start.setDate(1 - ((start.getDay() + 6) % 7));
  const last = new Date(year, monthIndex + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  const days: TopicalCalendarDay[] = [];
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    days.push({ date: formatLocalDate(date), inCurrentMonth: date.getMonth() === monthIndex });
  }
  return days;
};

export const setTopicalNodeParent = (document: TopicalMapDocument, nodeId: string, parentId: string | null): TopicalMapDocument => {
  if (parentId === nodeId || (parentId && !document.nodes.some((node) => node.id === parentId))) return document;
  let cursor = parentId;
  while (cursor) {
    if (cursor === nodeId) return document;
    cursor = document.nodes.find((node) => node.id === cursor)?.parentId ?? null;
  }
  return { ...document, nodes: document.nodes.map((node) => node.id === nodeId ? { ...node, parentId } : node) };
};

export const toggleTopicalLateralRelation = (document: TopicalMapDocument, nodeId: string, relatedId: string): TopicalMapDocument => {
  if (nodeId === relatedId || !document.nodes.some((node) => node.id === nodeId) || !document.nodes.some((node) => node.id === relatedId)) return document;
  const isRelated = document.nodes.find((node) => node.id === nodeId)?.relatedNodeIds.includes(relatedId) ?? false;
  return {
    ...document,
    nodes: document.nodes.map((node) => node.id === nodeId
      ? { ...node, relatedNodeIds: isRelated ? node.relatedNodeIds.filter((id) => id !== relatedId) : [...node.relatedNodeIds, relatedId] }
      : node.id === relatedId
        ? { ...node, relatedNodeIds: isRelated ? node.relatedNodeIds.filter((id) => id !== nodeId) : [...node.relatedNodeIds, nodeId] }
        : node),
  };
};

export const importCrawlClusters = (
  document: TopicalMapDocument,
  map: SemanticMap,
  pages: CrawledPageSummary[],
  runId: string,
): TopicalMapDocument => {
  const existing = new Set(document.nodes.filter((node) => node.sourceRunId === runId).map((node) => node.sourceClusterId));
  const additions = map.clusters.filter((cluster) => !existing.has(cluster.id)).map((cluster) => {
    const members = map.nodes.filter((node) => node.clusterId === cluster.id);
    const memberUrls = new Set(members.flatMap((node) => [node.page.url, node.page.final_url]));
    const sourceUrls = pages.filter((page) => memberUrls.has(page.url) || memberUrls.has(page.final_url)).map((page) => page.final_url || page.url);
    const evidenceTerms = [...new Set(members.flatMap((node) => node.page.semantic_terms ?? []).map((term) => cleanText(term, 100).toLocaleLowerCase()).filter(Boolean))].slice(0, MAX_TERMS_PER_NODE);
    return { ...createTopicalNode(cluster.label), kind: 'cluster' as const, evidenceTerms, sourceUrls, sourceRunId: runId, sourceClusterId: cluster.id };
  });
  return { ...document, nodes: [...document.nodes, ...additions].slice(0, MAX_NODES) };
};

export const setNodeParentFromInput = setTopicalNodeParent;
