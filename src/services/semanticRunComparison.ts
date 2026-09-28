import type { CrawlRunRecord, CrawledPageSummary } from '@/types';
import type { TopicalMapDocument } from '@/services/topicalMap';
import { buildSemanticMap } from '@/services/semanticMap';
import i18n from '@/i18n';

export type SemanticRunChangeCode =
  | 'url-added'
  | 'url-not-observed'
  | 'content-terms-changed'
  | 'content-link-added'
  | 'content-link-not-observed'
  | 'topic-edge-added'
  | 'topic-edge-not-observed'
  | 'topic-url-coverage-changed'
  | 'query-term-observation-changed';

export interface SemanticRunChange {
  id: string;
  code: SemanticRunChangeCode;
  direction: 'added' | 'not-observed' | 'changed' | 'increased' | 'decreased';
  title: string;
  detail: string;
  topicId?: string;
  urls: string[];
  evidence: string[];
}

export interface SemanticRunComparisonReport {
  baselineRunId: string;
  currentRunId: string;
  changes: SemanticRunChange[];
  counts: Record<SemanticRunChangeCode, number>;
  truncated: boolean;
}

interface Snapshot {
  id: string;
  pages: CrawledPageSummary[];
}

const MAX_PAGES = 5_000;
const MAX_TERMS_PER_PAGE = 40;
const MAX_SEMANTIC_LINKS_PER_PAGE = 1_000;
const MAX_CHANGES = 500;
const comparisonText = (key: string, variables?: Record<string, unknown>): string => i18n.t(`runtimeErrors.semanticRunComparison.${key}`, variables);

const normalizeText = (value: string): string => value.normalize('NFKC').toLocaleLowerCase().trim();
const tokenize = (value: string): string[] => [...new Set(normalizeText(value).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2))];

const normalizeUrl = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, '');
    return url.toString();
  } catch { return null; }
};

const pageIdentity = (page: CrawledPageSummary): string | null => normalizeUrl(page.url) || normalizeUrl(page.final_url);
const pageAliases = (page: CrawledPageSummary): string[] => [...new Set([page.url, page.final_url].map(normalizeUrl).filter((url): url is string => Boolean(url)))];
const pageTerms = (page: CrawledPageSummary): Map<string, string> => new Map((page.semantic_terms ?? []).slice(0, MAX_TERMS_PER_PAGE)
  .map((term) => [normalizeText(term), term.trim()] as const).filter(([key, value]) => Boolean(key && value)));

const countSemanticLinks = (pages: CrawledPageSummary[]): Map<string, { source: string; target: string; anchor: string }> => {
  const links = new Map<string, { source: string; target: string; anchor: string }>();
  for (const page of pages) {
    const source = normalizeUrl(page.url);
    if (!source) continue;
    for (const link of (page.semantic_links ?? []).slice(0, MAX_SEMANTIC_LINKS_PER_PAGE)) {
      if (!link.is_internal) continue;
      const target = normalizeUrl(link.target_url);
      if (!target) continue;
      const key = `${source}\u0000${target}`;
      if (!links.has(key)) links.set(key, { source, target, anchor: link.anchor_text.trim() });
    }
  }
  return links;
};

type TopicEdgeEvidence = { source: string; target: string; sharedTerms: string[]; weightedJaccard: number };

/**
 * Return lexical topic relations keyed by normalized page URLs. The graph
 * builder remains the single source of truth for thresholds and IDF weights;
 * this adapter only makes its bounded evidence comparable across snapshots.
 */
const countTopicEdges = (pages: CrawledPageSummary[]): Map<string, TopicEdgeEvidence> => {
  if (!pages.length) return new Map();
  const map = buildSemanticMap(pages, pages[0].url || pages[0].final_url || '');
  const pageById = new Map(map.nodes.map((node) => [node.id, pageIdentity(node.page)]));
  const edges = new Map<string, TopicEdgeEvidence>();
  for (const edge of map.topicEdges) {
    const source = pageById.get(edge.source);
    const target = pageById.get(edge.target);
    if (!source || !target) continue;
    const key = `${source}\u0000${target}`;
    edges.set(key, { source, target, sharedTerms: edge.sharedTerms, weightedJaccard: edge.weightedJaccard });
  }
  return edges;
};

const indexPages = (pages: CrawledPageSummary[]): { byIdentity: Map<string, CrawledPageSummary>; byAlias: Map<string, CrawledPageSummary> } => {
  const byIdentity = new Map<string, CrawledPageSummary>();
  const byAlias = new Map<string, CrawledPageSummary>();
  for (const page of pages.slice(0, MAX_PAGES)) {
    const identity = pageIdentity(page);
    if (!identity) continue;
    byIdentity.set(identity, page);
    for (const alias of pageAliases(page)) byAlias.set(alias, page);
  }
  return { byIdentity, byAlias };
};

const assignedPages = (node: TopicalMapDocument['nodes'][number], aliases: Map<string, CrawledPageSummary>): CrawledPageSummary[] => {
  const found = new Map<string, CrawledPageSummary>();
  for (const value of node.sourceUrls) {
    const url = normalizeUrl(value);
    const page = url ? aliases.get(url) : undefined;
    if (!page) continue;
    const identity = pageIdentity(page);
    if (identity) found.set(identity, page);
  }
  return [...found.values()];
};

const queryObservation = (query: string, pages: CrawledPageSummary[]): { matched: string[]; expected: string[] } | null => {
  const expected = tokenize(query);
  const comparable = pages.filter((page) => (page.semantic_terms ?? []).length > 0);
  if (!expected.length || !comparable.length) return null;
  const observed = new Set(comparable.flatMap((page) => [...pageTerms(page).keys()]));
  return { expected, matched: expected.filter((token) => observed.has(token)) };
};

/**
 * Evidence-only comparison between two saved crawl snapshots. It compares
 * only `semantic_terms` and `semantic_links` for semantic changes; all deltas
 * are crawl observations, not proof of ranking, intent, or content deletion.
 */
export const compareSemanticRuns = (
  document: TopicalMapDocument,
  baseline: Pick<CrawlRunRecord, 'id' | 'result'>,
  current: Snapshot,
): SemanticRunComparisonReport => {
  const beforePages = baseline.result.pages.slice(0, MAX_PAGES);
  const afterPages = current.pages.slice(0, MAX_PAGES);
  const beforeIndex = indexPages(beforePages);
  const afterIndex = indexPages(afterPages);
  const changes: SemanticRunChange[] = [];
  let truncated = baseline.result.pages.length > MAX_PAGES || current.pages.length > MAX_PAGES;
  const counts: SemanticRunComparisonReport['counts'] = {
    'url-added': 0,
    'url-not-observed': 0,
    'content-terms-changed': 0,
    'content-link-added': 0,
    'content-link-not-observed': 0,
    'topic-edge-added': 0,
    'topic-edge-not-observed': 0,
    'topic-url-coverage-changed': 0,
    'query-term-observation-changed': 0,
  };
  const add = (change: SemanticRunChange) => {
    counts[change.code] += 1;
    if (changes.length < MAX_CHANGES) changes.push(change);
    else truncated = true;
  };

  for (const [url, page] of afterIndex.byIdentity) {
    if (beforeIndex.byIdentity.has(url)) continue;
    add({ id: `url-added:${url}`, code: 'url-added', direction: 'added', title: comparisonText('urlAddedTitle'),
      detail: comparisonText('urlAddedDetail'),
      urls: [page.url], evidence: [comparisonText('http', { status: page.http_status }), comparisonText('terms', { count: (page.semantic_terms ?? []).length })] });
  }
  for (const [url, page] of beforeIndex.byIdentity) {
    if (afterIndex.byIdentity.has(url)) continue;
    add({ id: `url-not-observed:${url}`, code: 'url-not-observed', direction: 'not-observed', title: comparisonText('urlMissingTitle'),
      detail: comparisonText('urlMissingDetail'),
      urls: [page.url], evidence: [comparisonText('previousHttp', { status: page.http_status }), comparisonText('previousTerms', { count: (page.semantic_terms ?? []).length })] });
  }

  for (const [url, afterPage] of afterIndex.byIdentity) {
    const beforePage = beforeIndex.byIdentity.get(url);
    if (!beforePage) continue;
    const beforeTerms = pageTerms(beforePage);
    const afterTerms = pageTerms(afterPage);
    const addedTerms = [...afterTerms].filter(([term]) => !beforeTerms.has(term)).map(([, term]) => term);
    const missingTerms = [...beforeTerms].filter(([term]) => !afterTerms.has(term)).map(([, term]) => term);
    if (addedTerms.length || missingTerms.length) add({
      id: `content-terms:${url}`, code: 'content-terms-changed', direction: 'changed', title: comparisonText('contentTermsTitle'),
      detail: comparisonText('contentTermsDetail'),
      urls: [afterPage.url], evidence: [comparisonText('addedTerms', { value: addedTerms.slice(0, 12).join(', ') || comparisonText('missing') }), comparisonText('missingTerms', { value: missingTerms.slice(0, 12).join(', ') || comparisonText('missing') })] });
  }

  const beforeLinks = countSemanticLinks(beforePages);
  const afterLinks = countSemanticLinks(afterPages);
  for (const [key, link] of afterLinks) {
    if (beforeLinks.has(key)) continue;
    add({ id: `content-link-added:${key}`, code: 'content-link-added', direction: 'added', title: comparisonText('linkAddedTitle'),
      detail: comparisonText('linkAddedDetail'),
      urls: [link.source, link.target], evidence: [comparisonText('anchor', { value: link.anchor || comparisonText('missing') })] });
  }
  for (const [key, link] of beforeLinks) {
    if (afterLinks.has(key)) continue;
    add({ id: `content-link-not-observed:${key}`, code: 'content-link-not-observed', direction: 'not-observed', title: comparisonText('linkMissingTitle'),
      detail: comparisonText('linkMissingDetail'),
      urls: [link.source, link.target], evidence: [comparisonText('previousAnchor', { value: link.anchor || comparisonText('missing') })] });
  }

  const beforeTopicEdges = countTopicEdges(beforePages);
  const afterTopicEdges = countTopicEdges(afterPages);
  if (beforePages.length > 500 || afterPages.length > 500) truncated = true;
  for (const [key, edge] of afterTopicEdges) {
    if (beforeTopicEdges.has(key)) continue;
    add({
      id: `topic-edge-added:${key}`,
      code: 'topic-edge-added',
      direction: 'added',
      title: comparisonText('topicEdgeAddedTitle'),
      detail: comparisonText('topicEdgeAddedDetail'),
      urls: [edge.source, edge.target],
      evidence: [
        comparisonText('sharedTerms', { value: edge.sharedTerms.join(', ') || comparisonText('missing') }),
        comparisonText('weightedJaccard', { value: edge.weightedJaccard.toFixed(3) }),
      ],
    });
  }
  for (const [key, edge] of beforeTopicEdges) {
    if (afterTopicEdges.has(key)) continue;
    add({
      id: `topic-edge-not-observed:${key}`,
      code: 'topic-edge-not-observed',
      direction: 'not-observed',
      title: comparisonText('topicEdgeMissingTitle'),
      detail: comparisonText('topicEdgeMissingDetail'),
      urls: [edge.source, edge.target],
      evidence: [
        comparisonText('sharedTerms', { value: edge.sharedTerms.join(', ') || comparisonText('missing') }),
        comparisonText('weightedJaccard', { value: edge.weightedJaccard.toFixed(3) }),
      ],
    });
  }

  for (const node of document.nodes) {
    const previousUrls = new Set(assignedPages(node, beforeIndex.byAlias).map(pageIdentity).filter((url): url is string => Boolean(url)));
    const currentUrls = new Set(assignedPages(node, afterIndex.byAlias).map(pageIdentity).filter((url): url is string => Boolean(url)));
    const newlyObserved = [...currentUrls].filter((url) => !previousUrls.has(url));
    const noLongerObserved = [...previousUrls].filter((url) => !currentUrls.has(url));
    if (newlyObserved.length || noLongerObserved.length) add({
      id: `topic-url-coverage:${node.id}`, code: 'topic-url-coverage-changed', direction: 'changed', title: comparisonText('topicCoverageTitle', { topic: node.title }),
      detail: comparisonText('topicCoverageDetail'), topicId: node.id,
      urls: [...newlyObserved, ...noLongerObserved].slice(0, 20), evidence: [comparisonText('previous', { value: `${previousUrls.size}/${node.sourceUrls.length}` }), comparisonText('current', { value: `${currentUrls.size}/${node.sourceUrls.length}` }), comparisonText('new', { count: newlyObserved.length }), comparisonText('absent', { count: noLongerObserved.length })] });

    const beforeTopicPages = assignedPages(node, beforeIndex.byAlias);
    const afterTopicPages = assignedPages(node, afterIndex.byAlias);
    for (const query of node.queries.slice(0, 100)) {
      const before = queryObservation(query.text, beforeTopicPages);
      const after = queryObservation(query.text, afterTopicPages);
      if (!before || !after || before.expected.length !== after.expected.length) continue;
      if (before.matched.length === after.matched.length) continue;
      const direction = after.matched.length > before.matched.length ? 'increased' : 'decreased';
      add({ id: `query-observation:${node.id}:${query.id}`, code: 'query-term-observation-changed', direction,
        title: comparisonText('queryTitle', { direction: direction === 'increased' ? comparisonText('queryMore') : comparisonText('queryLess'), query: query.text }),
        detail: comparisonText('queryDetail'),
        topicId: node.id, urls: [...new Set([...beforeTopicPages, ...afterTopicPages].map((page) => page.url))].slice(0, 20),
        evidence: [comparisonText('query', { provenance: query.provenance, value: query.text }), comparisonText('tokens', { label: comparisonText('previous'), matched: before.matched.length, expected: before.expected.length }), comparisonText('tokens', { label: comparisonText('current'), matched: after.matched.length, expected: after.expected.length }),
          comparisonText('addedSignal', { value: after.matched.filter((token) => !before.matched.includes(token)).join(', ') || comparisonText('missing') }),
          comparisonText('missingSignal', { value: before.matched.filter((token) => !after.matched.includes(token)).join(', ') || comparisonText('missing') })] });
    }
  }

  return { baselineRunId: baseline.id, currentRunId: current.id, changes, counts, truncated };
};
