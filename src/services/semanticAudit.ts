import type { CrawledPageSummary } from '@/types';
import type { TopicalMapDocument, TopicalNode } from '@/services/topicalMap';
import i18n from '@/i18n';
import { normalizeSemanticText } from '@/services/semanticText';

export type SemanticAuditSignal = 'measured' | 'derived' | 'asserted';
export type SemanticAuditSeverity = 'notice' | 'review' | 'risk';

export interface SemanticAuditFinding {
  id: string;
  code: 'unmapped-topic' | 'unassigned-page' | 'stale-url-assignment' | 'ambiguous-page' | 'query-not-observed' | 'topic-not-observed' | 'lifecycle-review' | 'topic-url-unhealthy' | 'entity-not-observed' | 'possible-url-overlap' | 'near-duplicate-content' | 'content-orphan-page' | 'content-evidence-partial' | 'query-intent-mismatch';
  severity: SemanticAuditSeverity;
  provenance: SemanticAuditSignal[];
  title: string;
  detail: string;
  action: string;
  urls: string[];
  topicId?: string;
  evidence: string[];
  confidence: 'limited' | 'moderate';
}

export interface SemanticAuditReport {
  findings: SemanticAuditFinding[];
  mappedTopics: number;
  totalTopics: number;
  mappedPages: number;
  totalPages: number;
  contentOrphanPages: number | null;
  entityObservability: Array<{ label: string; observedPages: number; comparablePages: number; provenance: 'asserted+measured' }>;
  truncated: boolean;
}

const MAX_FINDINGS = 500;
const MAX_PAGES = 5000;
const MAX_TERMS_PER_PAGE = 40;
const MAX_PAGE_COMPARISONS = 250_000;
const semanticText = (key: string, variables?: Record<string, unknown>): string => i18n.t(`runtimeErrors.semanticAudit.${key}`, variables);
type SemanticAuditFindingCode = SemanticAuditFinding['code'];
const nextStepKey: Record<SemanticAuditFindingCode, string> = {
  'unmapped-topic': 'actionUnmapped',
  'unassigned-page': 'actionUnassigned',
  'stale-url-assignment': 'actionStale',
  'ambiguous-page': 'actionAmbiguous',
  'query-not-observed': 'actionQuery',
  'topic-not-observed': 'actionTopic',
  'lifecycle-review': 'actionLifecycle',
  'topic-url-unhealthy': 'actionUnhealthy',
  'entity-not-observed': 'actionEntity',
  'possible-url-overlap': 'actionOverlap',
  'near-duplicate-content': 'actionDuplicate',
  'content-orphan-page': 'actionOrphan',
  'content-evidence-partial': 'actionContentEvidence',
  'query-intent-mismatch': 'actionIntent',
};
const nextStep = (code: SemanticAuditFindingCode): string => semanticText(nextStepKey[code]);
const normalize = normalizeSemanticText;
const tokens = (value: string) => normalize(value).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2);
const termsFor = (page: CrawledPageSummary) => new Set((page.semantic_terms ?? []).slice(0, MAX_TERMS_PER_PAGE).map(normalize).filter(Boolean));
const urlKey = (value: string) => {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return value.trim();
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, '');
    return url.toString();
  } catch { return value.trim(); }
};
const normalizedUrls = (page: CrawledPageSummary) => new Set([page.url, page.final_url].filter(Boolean).map(urlKey));
const termCoverage = (query: string, page: CrawledPageSummary) => {
  const expected = [...new Set(tokens(query))];
  if (!expected.length) return null;
  const observed = termsFor(page);
  return { expected, matched: expected.filter((term) => observed.has(term)) };
};

const normalizedProviderIntent = (value: string | null | undefined): string | null => {
  const normalized = normalize(value ?? '').replace(/[\s_-]+/gu, '');
  if (normalized.includes('inform')) return 'informational';
  if (normalized.includes('commercial')) return 'commercial';
  if (normalized.includes('transaction')) return 'transactional';
  if (normalized.includes('navigation')) return 'navigational';
  return null;
};

const hammingDistance = (left: string, right: string): number | null => {
  if (!/^[a-f\d]{16}$/i.test(left) || !/^[a-f\d]{16}$/i.test(right)) return null;
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (bits) { count += Number(bits & 1n); bits >>= 1n; }
  return count;
};

const addFinding = (findings: SemanticAuditFinding[], finding: Omit<SemanticAuditFinding, 'action'>) => {
  if (findings.length < MAX_FINDINGS) findings.push({ ...finding, action: nextStep(finding.code) });
};

const candidatePagePairs = (pages: CrawledPageSummary[], topicsByPage: Map<string, TopicalNode[]>) => {
  const pairs = new Set<number>();
  let truncated = false;
  const addGroup = (indices: number[]) => {
    for (let left = 0; left < indices.length; left += 1) {
      for (let right = left + 1; right < indices.length; right += 1) {
        if (pairs.size >= MAX_PAGE_COMPARISONS) {
          truncated = true;
          return;
        }
        const first = indices[left];
        const second = indices[right];
        pairs.add(first * MAX_PAGES + second);
      }
    }
  };
  const groupBy = (keyForPage: (page: CrawledPageSummary) => string[]) => {
    const groups = new Map<string, number[]>();
    pages.forEach((page, index) => {
      for (const key of keyForPage(page)) {
        const group = groups.get(key) ?? [];
        group.push(index);
        groups.set(key, group);
      }
    });
    for (const group of groups.values()) {
      addGroup(group);
      if (truncated) break;
    }
  };

  groupBy((page) => page.content_hash ? [`content:${page.content_hash}`] : []);
  if (!truncated) {
    const topicalTerms = new Map<string, number[]>();
    pages.forEach((page, index) => {
      const topics = topicsByPage.get(page.url) ?? [];
      const terms = termsFor(page);
      for (const topic of topics) {
        for (const term of terms) {
          const key = `${topic.id}\u0000${term}`;
          const group = topicalTerms.get(key) ?? [];
          group.push(index);
          topicalTerms.set(key, group);
        }
      }
    });
    for (const group of topicalTerms.values()) {
      addGroup(group);
      if (truncated) break;
    }
  }
  // Any pair within the near-duplicate SimHash threshold (<=7/64) must share
  // at least one of eight disjoint 8-bit bands. This avoids comparing every
  // page against every other page while retaining that candidate guarantee.
  // It is last so a high-volume similarity bucket cannot starve topical checks.
  if (!truncated) groupBy((page) => {
    const hash = page.content_simhash ?? '';
    return /^[a-f\d]{16}$/i.test(hash)
      ? Array.from({ length: 8 }, (_, band) => `simhash:${band}:${hash.slice(band * 2, band * 2 + 2).toLowerCase()}`)
      : [];
  });

  return {
    pairs: [...pairs].map((pair) => [Math.floor(pair / MAX_PAGES), pair % MAX_PAGES] as const),
    truncated,
  };
};

/**
 * Local, evidence-qualified topical audit. It never treats lexical overlap as
 * proof of ranking cannibalization, truth/falsehood, or search intent.
 */
export const buildSemanticAudit = (document: TopicalMapDocument, inputPages: CrawledPageSummary[], now = new Date()): SemanticAuditReport => {
  const pages = inputPages.slice(0, MAX_PAGES);
  const truncated = inputPages.length > MAX_PAGES;
  const pageByUrl = new Map<string, CrawledPageSummary>();
  pages.forEach((page) => normalizedUrls(page).forEach((url) => pageByUrl.set(url, page)));
  const pagesByTopic = new Map<string, CrawledPageSummary[]>();
  const topicsByPage = new Map<string, TopicalNode[]>();
  const findings: SemanticAuditFinding[] = [];

  // Deliberately measure contextual links from extracted main content only. This
  // complements (and does not replace) the broader crawler orphan-page report,
  // where navigation/footer links remain part of the site's discovery graph.
  const hasContentLinkSnapshot = inputPages.length <= MAX_PAGES && pages.every((page) => Array.isArray(page.semantic_links));
  const contentIncomingSources = new Map<string, Set<string>>();
  if (hasContentLinkSnapshot) {
    const pageByContentUrl = new Map<string, CrawledPageSummary>();
    for (const page of pages) {
      pageByContentUrl.set(urlKey(page.url), page);
      pageByContentUrl.set(urlKey(page.final_url), page);
    }
    for (const source of pages) {
      for (const link of source.semantic_links ?? []) {
        if (!link.is_internal) continue;
        const target = pageByContentUrl.get(urlKey(link.target_url));
        if (!target || target === source) continue;
        const key = urlKey(target.url);
        const sources = contentIncomingSources.get(key) ?? new Set<string>();
        sources.add(urlKey(source.url));
        contentIncomingSources.set(key, sources);
      }
    }
  }
  let contentOrphanPages: number | null = hasContentLinkSnapshot ? 0 : null;
  if (hasContentLinkSnapshot) for (const page of pages) {
    // The crawl seed is a root by definition, not an orphan merely because it
    // has no incoming contextual link. Old snapshots without semantic_links are unknown.
    if (page.depth === 0 || (contentIncomingSources.get(urlKey(page.url))?.size ?? 0) > 0) continue;
    contentOrphanPages = (contentOrphanPages ?? 0) + 1;
    const incomingCount = contentIncomingSources.get(urlKey(page.url))?.size ?? 0;
    addFinding(findings, {
      id: `content-orphan-${urlKey(page.url)}`.slice(0, 240), code: 'content-orphan-page', severity: 'review',
      provenance: ['measured'], title: semanticText('orphanTitle'),
      detail: semanticText('orphanDetail'),
      urls: [page.url], evidence: [semanticText('incoming', { count: incomingCount }), semanticText('depth', { depth: Number.isFinite(page.depth) ? page.depth : i18n.t('auditProblems.unknown') })], confidence: 'limited',
    });
  }

  for (const node of document.nodes) {
    const matchedPages = new Map<string, CrawledPageSummary>();
    const stale = node.sourceUrls.filter((url) => !pageByUrl.has(urlKey(url)));
    node.sourceUrls.forEach((url) => {
      const page = pageByUrl.get(urlKey(url));
      if (page) matchedPages.set(page.url, page);
    });
    pagesByTopic.set(node.id, [...matchedPages.values()]);
    if (!matchedPages.size) addFinding(findings, {
      id: `topic-unmapped-${node.id}`, code: 'unmapped-topic', severity: 'review', provenance: ['asserted', 'measured'],
      title: semanticText('topicUnmappedTitle', { topic: node.title }),
      detail: semanticText('topicUnmappedDetail'),
      urls: [], topicId: node.id, evidence: [semanticText('lifecycle', { value: node.lifecycle }), semanticText('assignedUrls', { count: node.sourceUrls.length })], confidence: 'limited',
    });
    if (stale.length) addFinding(findings, {
      id: `stale-assignment-${node.id}`, code: 'stale-url-assignment', severity: 'notice', provenance: ['asserted', 'measured'],
      title: semanticText('staleTitle', { topic: node.title }),
      detail: semanticText('staleDetail'),
      urls: stale.slice(0, 20), topicId: node.id, evidence: [semanticText('outsideSnapshot', { count: stale.length })], confidence: 'limited',
    });
  }

  for (const [topicId, topicPages] of pagesByTopic) {
      for (const page of topicPages) {
        const matches = topicsByPage.get(page.url) ?? [];
        const node = document.nodes.find((candidate) => candidate.id === topicId);
        if (node) matches.push(node);
        topicsByPage.set(page.url, matches);
      }
  }

  const today = now.toISOString().slice(0, 10);
  for (const node of document.nodes) {
    const topicPages = pagesByTopic.get(node.id) ?? [];
    if (node.lifecycle === 'needs-update') addFinding(findings, {
      id: `lifecycle-update-${node.id}`, code: 'lifecycle-review', severity: 'review', provenance: ['asserted'],
      title: semanticText('lifecycleTitle', { topic: node.title }),
      detail: semanticText('lifecycleDetail'),
      urls: topicPages.map((page) => page.url).slice(0, 20), topicId: node.id,
      evidence: [semanticText('lifecycle', { value: node.lifecycle }), ...(node.scheduledDate ? [semanticText('plannedDate', { value: node.scheduledDate })] : [])], confidence: 'moderate',
    });
    if (node.scheduledDate && node.scheduledDate < today && node.lifecycle !== 'published' && node.lifecycle !== 'needs-update') addFinding(findings, {
      id: `lifecycle-overdue-${node.id}`, code: 'lifecycle-review', severity: 'review', provenance: ['asserted', 'derived'],
      title: semanticText('overdueTitle', { topic: node.title }),
      detail: semanticText('overdueDetail'),
      urls: topicPages.map((page) => page.url).slice(0, 20), topicId: node.id,
      evidence: [semanticText('lifecycle', { value: node.lifecycle }), semanticText('plannedDate', { value: node.scheduledDate }), semanticText('auditDate', { value: today })], confidence: 'moderate',
    });
    const unhealthy = node.lifecycle === 'published' ? topicPages.filter((page) => page.http_status < 200 || page.http_status >= 300) : [];
    if (unhealthy.length) addFinding(findings, {
      id: `topic-url-unhealthy-${node.id}`, code: 'topic-url-unhealthy', severity: 'risk', provenance: ['asserted', 'measured', 'derived'],
      title: semanticText('unhealthyTitle', { topic: node.title }),
      detail: semanticText('unhealthyDetail'),
      urls: unhealthy.slice(0, 20).map((page) => page.url), topicId: node.id,
      evidence: unhealthy.slice(0, 20).map((page) => semanticText('httpEvidence', { url: page.url, status: page.http_status })), confidence: 'moderate',
    });
    for (const page of topicPages) {
      const coverage = termCoverage(node.title, page);
      if (!coverage || coverage.matched.length === coverage.expected.length) continue;
      const coveragePercent = Math.round(coverage.matched.length / coverage.expected.length * 100);
      addFinding(findings, {
        id: `topic-unobserved-${node.id}-${page.url}`, code: 'topic-not-observed', severity: 'notice', provenance: ['asserted', 'measured', 'derived'],
        title: semanticText('topicSignal', { prefix: coveragePercent ? semanticText('partial') : semanticText('none'), topic: node.title }),
        detail: semanticText('topicSignalDetail', { matched: coverage.matched.length, expected: coverage.expected.length, percent: coveragePercent }),
        urls: [page.url], topicId: node.id,
        evidence: [semanticText('declaration', { value: node.title }), semanticText('matched', { value: coverage.matched.join(', ') || semanticText('missingTerm') }), semanticText('missing', { value: coverage.expected.filter((term) => !coverage.matched.includes(term)).join(', ') || semanticText('missingTerm') })], confidence: 'limited',
      });
    }
  }

  for (const page of pages) {
    const contentEvidence = [
      ...(page.body_truncated ? [semanticText('contentEvidenceTruncated')] : []),
      ...(page.semantic_content_partial ? [semanticText('contentEvidenceBounded')] : []),
      ...(page.semantic_content_source === 'unavailable' ? [semanticText('contentEvidenceUnavailable')] : []),
      ...((page.semantic_excerpts ?? []).length === 0 ? [semanticText('contentEvidenceMissingExcerpts')] : []),
    ];
    if (contentEvidence.length) addFinding(findings, {
      id: `content-evidence-partial-${page.url}`.slice(0, 240), code: 'content-evidence-partial',
      severity: page.body_truncated || page.semantic_content_partial || page.semantic_content_source === 'unavailable' ? 'review' : 'notice',
      provenance: ['measured'], title: semanticText('contentEvidenceTitle', { url: page.url }),
      detail: semanticText('contentEvidenceDetail'), urls: [page.url], evidence: contentEvidence, confidence: 'limited',
    });
    const assigned = topicsByPage.get(page.url) ?? [];
    if (!assigned.length) addFinding(findings, {
      id: `page-unassigned-${page.url}`, code: 'unassigned-page', severity: 'notice', provenance: ['measured'],
      title: semanticText('pageUnassignedTitle'),
      detail: semanticText('pageUnassignedDetail'),
      urls: [page.url], evidence: [semanticText('termCount', { count: (page.semantic_terms ?? []).length })], confidence: 'limited',
    });
    if (assigned.length > 1) addFinding(findings, {
      id: `page-ambiguous-${page.url}`, code: 'ambiguous-page', severity: 'review', provenance: ['asserted', 'measured'],
      title: semanticText('ambiguousTitle'),
      detail: semanticText('ambiguousDetail'),
      urls: [page.url], topicId: assigned[0]?.id, evidence: assigned.map((node) => node.title), confidence: 'limited',
    });
  }

  for (const node of document.nodes) {
    const topicPages = pagesByTopic.get(node.id) ?? [];
    for (const query of node.queries) {
      for (const page of topicPages) {
        const coverage = termCoverage(query.text, page);
        if (!coverage || coverage.matched.length === coverage.expected.length) continue;
        const coveragePercent = Math.round(coverage.matched.length / coverage.expected.length * 100);
        addFinding(findings, {
          id: `query-unobserved-${node.id}-${query.id}-${page.url}`, code: 'query-not-observed', severity: 'notice',
          provenance: ['asserted', 'measured', 'derived'], title: semanticText('querySignal', { prefix: coveragePercent ? semanticText('partial') : semanticText('none'), query: query.text }),
          detail: semanticText('querySignalDetail', { matched: coverage.matched.length, expected: coverage.expected.length, percent: coveragePercent }),
          urls: [page.url], topicId: node.id, evidence: [semanticText('query', { provenance: query.provenance, value: query.text }), semanticText('matchedTokens', { value: coverage.matched.join(', ') || semanticText('missingTerm') }), semanticText('missingTokens', { value: coverage.expected.filter((term) => !coverage.matched.includes(term)).join(', ') || semanticText('missingTerm') }), semanticText('contentTerms', { value: (page.semantic_terms ?? []).slice(0, 8).join(', ') || semanticText('missingTerm') })], confidence: 'limited',
        });
      }
    }
  }

  // DataForSEO intent is provider evidence for the imported query, while the
  // topical-node intent is an explicit editorial declaration. Surface a
  // review signal when they disagree; never silently rewrite the declaration
  // or present this as a ranking/cannibalization verdict.
  for (const node of document.nodes) {
    if (node.intent === 'unknown' || node.intent === 'mixed') continue;
    for (const query of node.queries) {
      const source = query.source;
      const observedIntent = source && 'searchIntent' in source
        ? normalizedProviderIntent(source.searchIntent)
        : null;
      if (!observedIntent || observedIntent === node.intent) continue;
      addFinding(findings, {
        id: `query-intent-mismatch-${node.id}-${query.id}`.slice(0, 240),
        code: 'query-intent-mismatch',
        severity: 'review',
        provenance: ['asserted', 'measured', 'derived'],
        title: semanticText('intentMismatchTitle', { query: query.text }),
        detail: semanticText('intentMismatchDetail'),
        urls: (pagesByTopic.get(node.id) ?? []).slice(0, 20).map((page) => page.url),
        topicId: node.id,
        evidence: [
          semanticText('intentExpected', { value: node.intent }),
          semanticText('intentObserved', { value: observedIntent }),
          semanticText('query', { provenance: query.provenance, value: query.text }),
          semanticText('intentSource', { value: source?.retrievedAt ?? semanticText('unknown') }),
        ],
        confidence: 'moderate',
      });
    }
  }

  const entityAssertions = [
    ...(document.entity.name.trim() ? [{ label: document.entity.name, kind: semanticText('entityNameKind') }] : []),
    ...document.entity.facts.map((fact) => ({ label: `${fact.attribute}: ${fact.value}`, kind: semanticText('kindAsserted', { value: fact.attribute }) })),
  ];
  const entityObservability = entityAssertions.map(({ label, kind }) => {
    const comparable = pages.filter((page) => (page.semantic_terms ?? []).length > 0);
    const observedPages = comparable.filter((page) => {
      const coverage = termCoverage(label.includes(': ') ? label.split(': ').slice(1).join(': ') : label, page);
      return Boolean(coverage?.expected.length && coverage.expected.every((term) => coverage.matched.includes(term)));
    });
    if (comparable.length && !observedPages.length) addFinding(findings, {
      id: `entity-unobserved-${kind}-${label}`.slice(0, 240), code: 'entity-not-observed', severity: 'review',
      provenance: ['asserted', 'measured', 'derived'], title: semanticText('entityTitle', { kind }),
      detail: semanticText('entityDetail'),
      urls: comparable.slice(0, 20).map((page) => page.url), evidence: [semanticText('declaration', { value: label }), semanticText('comparedPages', { count: comparable.length })], confidence: 'limited',
    });
    return { label, observedPages: observedPages.length, comparablePages: comparable.length, provenance: 'asserted+measured' as const };
  });

  const candidates = candidatePagePairs(pages, topicsByPage);
  for (const [leftIndex, rightIndex] of candidates.pairs) {
      const leftPage = pages[leftIndex];
      const rightPage = pages[rightIndex];
      const leftTopics = topicsByPage.get(leftPage.url) ?? [];
      const rightTopics = topicsByPage.get(rightPage.url) ?? [];
      const sameTopic = leftTopics.some((node) => rightTopics.some((candidate) => candidate.id === node.id));
      const leftTerms = termsFor(leftPage);
      const rightTerms = termsFor(rightPage);
      const shared = [...leftTerms].filter((term) => rightTerms.has(term));
      const union = new Set([...leftTerms, ...rightTerms]);
      const lexicalOverlap = union.size ? shared.length / union.size : 0;
      const simhashDistance = leftPage.content_simhash && rightPage.content_simhash
        ? hammingDistance(leftPage.content_simhash, rightPage.content_simhash) : null;
      const exactDuplicate = Boolean(leftPage.content_hash && leftPage.content_hash === rightPage.content_hash);
      if (exactDuplicate || simhashDistance !== null && simhashDistance <= 7) {
        addFinding(findings, {
          id: `near-duplicate-${leftPage.url}-${rightPage.url}`, code: 'near-duplicate-content', severity: exactDuplicate ? 'risk' : 'review',
          provenance: ['measured', 'derived'], title: exactDuplicate ? semanticText('duplicateTitle') : semanticText('similarityTitle'),
          detail: exactDuplicate ? semanticText('duplicateDetail') : semanticText('similarityDetail'),
          urls: [leftPage.url, rightPage.url], topicId: sameTopic ? leftTopics.find((node) => rightTopics.some((candidate) => candidate.id === node.id))?.id : undefined,
          evidence: [exactDuplicate ? semanticText('contentHash', { value: leftPage.content_hash }) : semanticText('simhash', { value: `${simhashDistance}/64` }), semanticText('sharedTerms', { value: shared.slice(0, 10).join(', ') || semanticText('missingTerm') })], confidence: exactDuplicate ? 'moderate' : 'limited',
        });
      } else if (sameTopic && shared.length >= 3 && lexicalOverlap >= 0.55) {
        addFinding(findings, {
          id: `possible-overlap-${leftPage.url}-${rightPage.url}`, code: 'possible-url-overlap', severity: 'review', provenance: ['asserted', 'measured', 'derived'],
          title: semanticText('overlapTitle'),
          detail: semanticText('overlapDetail'),
          urls: [leftPage.url, rightPage.url], topicId: leftTopics.find((node) => rightTopics.some((candidate) => candidate.id === node.id))?.id,
          evidence: [semanticText('jaccard', { value: lexicalOverlap.toFixed(2) }), semanticText('shared', { value: shared.slice(0, 12).join(', ') })], confidence: 'limited',
        });
      }
  }

  return {
    findings,
    mappedTopics: [...pagesByTopic.values()].filter((matched) => matched.length > 0).length,
    totalTopics: document.nodes.length,
    mappedPages: [...topicsByPage.values()].filter((matched) => matched.length > 0).length,
    totalPages: pages.length,
    contentOrphanPages,
    entityObservability,
    truncated: truncated || candidates.truncated || findings.length >= MAX_FINDINGS,
  };
};
