import type { CrawledPageSummary } from '@/types';
import i18n from '@/i18n';
import { normalizeSemanticText } from '@/services/semanticText';

export interface SemanticPageNode {
  id: string;
  page: CrawledPageSummary;
  clusterId: string;
  clusterLabel: string;
  semanticSignalCount: number;
  incomingContentLinks: number;
  orphan: boolean;
}

export interface SemanticContentEdge {
  id: string;
  source: string;
  target: string;
  anchors: string[];
  links: number;
}

export interface SemanticTopicEdge {
  id: string;
  source: string;
  target: string;
  sharedTerms: string[];
  weightedJaccard: number;
}

export interface SemanticMap {
  nodes: SemanticPageNode[];
  edges: SemanticContentEdge[];
  /** Lexical similarity is a derived relation, never a crawled hyperlink. */
  topicEdges: SemanticTopicEdge[];
  /** Full edge counts before the defensive SVG render cap is applied. */
  totalEdges: number;
  totalTopicEdges: number;
  totalInternalLinks: number;
  clusters: Array<{ id: string; label: string; pageCount: number }>;
  hasSemanticTerms: boolean;
  truncated: boolean;
}

export interface SemanticMapOptions {
  /** Include every crawled internal link instead of only content-only links. */
  includeAllInternalLinks?: boolean;
}

// The crawler exposes a maximum of 500 pages. Keep the semantic map aligned
// with that contract so a successful crawl is not silently hidden from the
// graph; the edge bound still protects the SVG/force simulation from a site
// with a navigation link repeated on every page.
const MAX_GRAPH_NODES = 500;
const MAX_GRAPH_EDGES = 5_000;
const MAX_TOPIC_EDGES = 5_000;

/**
 * Use the same URL identity for links and crawled pages even when a response
 * redirected, the source kept a trailing slash, or an anchor was present.
 * Query parameters are intentionally preserved because they can identify a
 * distinct crawled document in a configured query-string scope.
 */
const normalizeGraphUrl = (value: string | null | undefined, base?: string): string => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  try {
    const url = new URL(trimmed, base);
    url.hash = '';
    url.hostname = url.hostname.toLocaleLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return trimmed.replace(/#.*$/, '').replace(/\/+$/, '');
  }
};

/**
 * Build an explainable topical graph from terms/links extracted in <main>/<article>
 * or a boilerplate-stripped body fallback. This deliberately does not use URL path,
 * title-only site chrome, or inferred/search-volume metrics as semantic evidence.
 */
export const buildSemanticMap = (
  pages: CrawledPageSummary[],
  startUrl: string,
  options: SemanticMapOptions = {},
): SemanticMap => {
  const selectedPages = pages.slice(0, MAX_GRAPH_NODES);
  const termsByPage = selectedPages.map((page) =>
    [...new Set((page.semantic_terms ?? []).map(normalizeSemanticText).filter(Boolean))].slice(0, 40),
  );
  const documentFrequency = new Map<string, number>();
  termsByPage.forEach((terms) => terms.forEach((term) => documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)));
  const parent = selectedPages.map((_, index) => index);
  const topicEdges: SemanticTopicEdge[] = [];
  let totalTopicEdges = 0;
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const union = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };

  for (let left = 0; left < termsByPage.length; left += 1) {
    const leftTerms = new Set(termsByPage[left]);
    if (!leftTerms.size) continue;
    for (let right = left + 1; right < termsByPage.length; right += 1) {
      const rightTerms = new Set(termsByPage[right]);
      let shared = 0;
      let intersectionWeight = 0;
      let unionWeight = 0;
      const vocabulary = new Set([...leftTerms, ...rightTerms]);
      for (const term of vocabulary) {
        const weight = Math.log(1 + selectedPages.length / (documentFrequency.get(term) ?? 1));
        unionWeight += weight;
        if (leftTerms.has(term) && rightTerms.has(term)) {
          shared += 1;
          intersectionWeight += weight;
        }
      }
      // At least two shared content terms, with a weighted Jaccard floor. This is a
      // transparent lexical heuristic, not a language model or a ranking score.
      const weightedJaccard = unionWeight > 0 ? intersectionWeight / unionWeight : 0;
      if (shared >= 2 && weightedJaccard >= 0.16) {
        union(left, right);
        totalTopicEdges += 1;
        if (topicEdges.length < MAX_TOPIC_EDGES) {
          topicEdges.push({
            id: `topic-page-${left}->page-${right}`,
            source: `page-${left}`,
            target: `page-${right}`,
            sharedTerms: [...leftTerms].filter((term) => rightTerms.has(term)).sort().slice(0, 8),
            weightedJaccard,
          });
        }
      }
    }
  }

  const groupMembers = new Map<number, number[]>();
  selectedPages.forEach((_, index) => {
    const root = find(index);
    groupMembers.set(root, [...(groupMembers.get(root) ?? []), index]);
  });
  const groupDetails = new Map<number, { id: string; label: string }>();
  for (const [root, members] of groupMembers) {
    const counts = new Map<string, number>();
    members.forEach((index) => termsByPage[index].forEach((term) => counts.set(term, (counts.get(term) ?? 0) + 1)));
    const label = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
      ?? (termsByPage[members[0]].length ? i18n.t('runtimeErrors.semanticMap.standalone') : i18n.t('runtimeErrors.semanticMap.noSignals'));
    groupDetails.set(root, { id: `cluster-${members[0]}`, label });
  }

  const pageIdByUrl = new Map<string, string>();
  selectedPages.forEach((page, index) => {
    const pageUrl = normalizeGraphUrl(page.url);
    const finalUrl = normalizeGraphUrl(page.final_url);
    if (pageUrl) pageIdByUrl.set(pageUrl, `page-${index}`);
    if (finalUrl) pageIdByUrl.set(finalUrl, `page-${index}`);
  });
  const edgeGroups = new Map<string, SemanticContentEdge>();
  for (let index = 0; index < selectedPages.length; index += 1) {
    const source = `page-${index}`;
    const pageLinks = options.includeAllInternalLinks
      ? (selectedPages[index].links ?? [])
      : selectedPages[index].semantic_links ?? [];
    for (const link of pageLinks) {
      if (!link.is_internal) continue;
      const target = pageIdByUrl.get(normalizeGraphUrl(
        link.target_url,
        selectedPages[index].final_url || selectedPages[index].url,
      ));
      if (!target || target === source) continue;
      const id = `${source}->${target}`;
      const edge = edgeGroups.get(id) ?? { id, source, target, anchors: [], links: 0 };
      edge.links += 1;
      const anchor = typeof link.anchor_text === 'string' ? link.anchor_text.trim() : '';
      if (anchor && !edge.anchors.includes(anchor) && edge.anchors.length < 3) edge.anchors.push(anchor);
      edgeGroups.set(id, edge);
    }
  }
  const allEdges = [...edgeGroups.values()];
  const edges = allEdges.slice(0, MAX_GRAPH_EDGES);
  const incoming = new Map<string, number>();
  allEdges.forEach((edge) => incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + edge.links));
  const nodes = selectedPages.map((page, index) => {
    const details = groupDetails.get(find(index))!;
    const id = `page-${index}`;
    const incomingContentLinks = incoming.get(id) ?? 0;
    return {
      id,
      page,
      clusterId: details.id,
      clusterLabel: details.label,
      semanticSignalCount: termsByPage[index].length,
      incomingContentLinks,
      orphan: normalizeGraphUrl(page.url) !== normalizeGraphUrl(startUrl)
        && normalizeGraphUrl(page.final_url) !== normalizeGraphUrl(startUrl)
        && incomingContentLinks === 0,
    };
  });
  const clusters = [...groupMembers.entries()]
    .map(([root, members]) => ({ id: groupDetails.get(root)!.id, label: groupDetails.get(root)!.label, pageCount: members.length }))
    .sort((a, b) => b.pageCount - a.pageCount || a.label.localeCompare(b.label));

  return {
    nodes,
    edges,
    topicEdges,
    clusters,
    hasSemanticTerms: termsByPage.some((terms) => terms.length > 0),
    totalEdges: allEdges.length,
    totalTopicEdges,
    totalInternalLinks: allEdges.reduce((sum, edge) => sum + edge.links, 0),
    truncated: pages.length > MAX_GRAPH_NODES || allEdges.length > MAX_GRAPH_EDGES || totalTopicEdges > MAX_TOPIC_EDGES,
  };
};
