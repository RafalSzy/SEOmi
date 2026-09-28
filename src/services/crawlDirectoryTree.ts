import type { CrawledPageSummary } from '@/types';
import i18n from '@/i18n';

export interface CrawlDirectoryMetrics {
  pageCount: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  requestErrors: number;
  criticalIssues: number;
  warningIssues: number;
  indexable: number;
  excluded: number;
  unknownIndexability: number;
  averageResponseMs: number | null;
  words: number;
}

export interface CrawlDirectoryNode {
  id: string;
  name: string;
  depth: number;
  ownPages: CrawledPageSummary[];
  childDirectories: CrawlDirectoryNode[];
  metrics: CrawlDirectoryMetrics;
}

export interface CrawlDirectoryTree {
  roots: CrawlDirectoryNode[];
  pageCount: number;
  ignoredPageCount: number;
  metrics: CrawlDirectoryMetrics;
}

const emptyMetrics = (): CrawlDirectoryMetrics => ({
  pageCount: 0,
  status2xx: 0,
  status3xx: 0,
  status4xx: 0,
  status5xx: 0,
  requestErrors: 0,
  criticalIssues: 0,
  warningIssues: 0,
  indexable: 0,
  excluded: 0,
  unknownIndexability: 0,
  averageResponseMs: null,
  words: 0,
});

const decodeSegment = (segment: string): string => {
  try { return decodeURIComponent(segment); } catch { return segment; }
};

const addPageMetrics = (metrics: CrawlDirectoryMetrics, page: CrawledPageSummary): void => {
  metrics.pageCount += 1;
  if (page.request_error_kind || page.http_status <= 0) metrics.requestErrors += 1;
  else if (page.http_status >= 200 && page.http_status < 300) metrics.status2xx += 1;
  else if (page.http_status >= 300 && page.http_status < 400) metrics.status3xx += 1;
  else if (page.http_status >= 400 && page.http_status < 500) metrics.status4xx += 1;
  else if (page.http_status >= 500 && page.http_status < 600) metrics.status5xx += 1;

  for (const issue of page.issues || []) {
    if (issue.severity === 'Critical') metrics.criticalIssues += 1;
    else if (issue.severity === 'Warning') metrics.warningIssues += 1;
  }

  const indexability = page.indexability_status || '';
  if (indexability.startsWith('Eligible')) metrics.indexable += 1;
  else if (/^(Blocked|Excluded|Canonical points|Redirect response)/i.test(indexability)) metrics.excluded += 1;
  else metrics.unknownIndexability += 1;

  if (Number.isFinite(page.word_count) && page.word_count > 0) metrics.words += page.word_count;
};

const finalize = (node: CrawlDirectoryNode): { metrics: CrawlDirectoryMetrics; responseTimeTotal: number; responseTimeCount: number } => {
  const metrics = emptyMetrics();
  let responseTimeTotal = 0;
  let responseTimeCount = 0;
  for (const page of node.ownPages) {
    addPageMetrics(metrics, page);
    if (Number.isFinite(page.response_time_ms) && page.response_time_ms >= 0) {
      responseTimeTotal += page.response_time_ms;
      responseTimeCount += 1;
    }
  }
  for (const child of node.childDirectories) {
    const childSummary = finalize(child);
    const childMetrics = childSummary.metrics;
    for (const key of [
      'pageCount', 'status2xx', 'status3xx', 'status4xx', 'status5xx', 'requestErrors',
      'criticalIssues', 'warningIssues', 'indexable', 'excluded', 'unknownIndexability', 'words',
    ] as const) metrics[key] += childMetrics[key];
    responseTimeTotal += childSummary.responseTimeTotal;
    responseTimeCount += childSummary.responseTimeCount;
  }
  node.childDirectories.sort((left, right) => left.name.localeCompare(right.name));
  node.ownPages.sort((left, right) => left.url.localeCompare(right.url));
  metrics.averageResponseMs = responseTimeCount ? Math.round(responseTimeTotal / responseTimeCount) : null;
  node.metrics = metrics;
  return { metrics, responseTimeTotal, responseTimeCount };
};

const makeNode = (id: string, name: string, depth: number): CrawlDirectoryNode => ({
  id,
  name,
  depth,
  ownPages: [],
  childDirectories: [],
  metrics: emptyMetrics(),
});

export const buildCrawlDirectoryTree = (pages: CrawledPageSummary[]): CrawlDirectoryTree => {
  const roots = new Map<string, CrawlDirectoryNode>();
  const childIndexes = new WeakMap<CrawlDirectoryNode, Map<string, CrawlDirectoryNode>>();
  let ignoredPageCount = 0;
  for (const page of pages) {
    let url: URL;
    try { url = new URL(page.url); } catch { ignoredPageCount += 1; continue; }
    const origin = url.origin;
    let node: CrawlDirectoryNode = roots.get(origin) ?? makeNode(`origin:${origin}`, origin, 0);
    if (!roots.has(origin)) roots.set(origin, node);
    const segments = url.pathname.split('/').filter(Boolean);
    for (let index = 0; index < segments.length; index += 1) {
      const rawSegment = segments[index];
      let children = childIndexes.get(node);
      if (!children) {
        children = new Map<string, CrawlDirectoryNode>();
        childIndexes.set(node, children);
      }
      let child = children.get(rawSegment);
      if (!child) {
        child = makeNode(`${node.id}/${rawSegment}`, decodeSegment(rawSegment), node.depth + 1);
        children.set(rawSegment, child);
        node.childDirectories.push(child);
      }
      node = child;
    }
    node.ownPages.push(page);
  }

  const rootNodes = Array.from(roots.values()).sort((left, right) => left.name.localeCompare(right.name));
  const combined = makeNode('crawl:root', i18n.t('runtimeErrors.crawl.root'), -1);
  combined.childDirectories = rootNodes;
  const { metrics } = finalize(combined);
  return {
    roots: rootNodes,
    pageCount: metrics.pageCount,
    ignoredPageCount,
    metrics,
  };
};

export const filterCrawlPagesForDirectoryTree = (pages: CrawledPageSummary[], query: string): CrawledPageSummary[] => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return pages;
  return pages.filter((page) => [page.url, page.title ?? '', page.http_status, page.indexability_status ?? '']
    .join(' ').toLocaleLowerCase().includes(normalized));
};
