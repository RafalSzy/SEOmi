import type { CrawledPageSummary } from '@/types';
import type { TopicalEntityFact, TopicalMapDocument } from '@/services/topicalMap';
import i18n from '@/i18n';

export type EntityEvidenceNodeKind = 'entity' | 'fact' | 'page' | 'schema';
export type EntityEvidenceEdgeKind = 'declared' | 'observed' | 'structured' | 'reference';

export interface EntityEvidenceNode {
  id: string;
  kind: EntityEvidenceNodeKind;
  label: string;
  detail?: string;
  url?: string;
  /** Number of comparable pages that contain the complete assertion. */
  observedPages?: number;
  /** Number of pages with a non-empty semantic term inventory. */
  comparablePages?: number;
  /** Whether the node was entered by the user or derived from the crawl. */
  provenance: 'asserted' | 'measured' | 'derived';
}

export interface EntityEvidenceEdge {
  id: string;
  source: string;
  target: string;
  kind: EntityEvidenceEdgeKind;
  matchedTerms: string[];
  coverage: number | null;
  /** Human-readable evidence, intentionally limited and text-only. */
  evidence: string;
}

export interface EntityEvidenceGraph {
  nodes: EntityEvidenceNode[];
  edges: EntityEvidenceEdge[];
  entityNodeId: string | null;
  comparablePages: number;
  /** Pages with at least one locally detected structured-data type. */
  structuredPages: number;
  /** Unique structured-data type labels observed in the selected crawl. */
  schemaTypes: number;
  observedAssertions: number;
  totalAssertions: number;
  truncated: boolean;
}

const MAX_FACTS = 300;
const MAX_PAGES = 500;
const MAX_EDGES = 2_000;
const MAX_TERMS_PER_ASSERTION = 16;
const MAX_SCHEMA_TYPES = 200;
const MAX_SCHEMA_REFERENCE_NODES = 300;
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'or', 'to', 'in', 'on', 'for', 'with', 'by',
  'i', 'oraz', 'a', 'ale', 'dla', 'do', 'na', 'w', 'we', 'z', 'ze', 'iż',
]);

const normalize = (value: string): string => value
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

const tokens = (value: string): string[] => [...new Set(
  normalize(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
)].slice(0, MAX_TERMS_PER_ASSERTION);

const pageUrl = (page: CrawledPageSummary): string => page.final_url || page.url;

const schemaTypeLabel = (value: string): string => value
  .trim()
  .replace(/^https?:\/\/schema\.org\//i, '')
  .replace(/^schema:/i, '')
  .trim();

const assertionLabel = (fact: TopicalEntityFact): string => `${fact.attribute}: ${fact.value}`.trim();

const coverageFor = (assertionTerms: string[], page: CrawledPageSummary): { matched: string[]; coverage: number } | null => {
  const observed = new Set((page.semantic_terms ?? []).map(normalize).filter(Boolean));
  if (!assertionTerms.length || !observed.size) return null;
  const matched = assertionTerms.filter((term) => observed.has(term));
  return { matched, coverage: matched.length / assertionTerms.length };
};

/**
 * Build a deterministic, explainable entity-to-content graph.
 *
 * This is not entity recognition and does not infer facts. The entity and its
 * attributes are asserted by the project owner; page edges only prove lexical
 * observability in the bounded semantic term inventory of the selected crawl.
 */
export const buildEntityEvidenceGraph = (
  document: TopicalMapDocument,
  pages: CrawledPageSummary[],
): EntityEvidenceGraph => {
  const entityName = document.entity.name.trim();
  if (!entityName) {
    return { nodes: [], edges: [], entityNodeId: null, comparablePages: 0, structuredPages: 0, schemaTypes: 0, observedAssertions: 0, totalAssertions: 0, truncated: false };
  }

  const selectedPages = pages.slice(0, MAX_PAGES);
  const comparablePages = selectedPages.filter((page) => (page.semantic_terms ?? []).length > 0);
  const entityNodeId = 'entity:project';
  const nodes: EntityEvidenceNode[] = [{
    id: entityNodeId,
    kind: 'entity',
    label: entityName,
    detail: document.entity.description.trim() || i18n.t('runtimeErrors.entity.declared'),
    provenance: 'asserted',
  }];
  const edges: EntityEvidenceEdge[] = [];
  const schemaNodeIds = new Set<string>();
  const schemaReferenceNodeIds = new Set<string>();
  const structuredPageIndexes = new Set<number>();
  const assertions: Array<{ id: string; label: string; terms: string[]; fact?: TopicalEntityFact }> = [
    { id: 'entity:name', label: entityName, terms: tokens(entityName) },
    ...document.entity.facts.slice(0, MAX_FACTS).map((fact) => ({ id: `fact:${fact.id}`, label: assertionLabel(fact), terms: tokens(fact.value), fact })),
  ];
  let observedAssertions = 0;

  const ensurePageNode = (page: CrawledPageSummary, pageIndex: number): string | null => {
    const pageNodeId = `page:${pageIndex}`;
    if (nodes.length >= MAX_PAGES + MAX_FACTS + MAX_SCHEMA_TYPES + MAX_SCHEMA_REFERENCE_NODES + 2) return null;
    if (!nodes.some((node) => node.id === pageNodeId)) {
      nodes.push({
        id: pageNodeId,
        kind: 'page',
        label: page.title?.trim() || pageUrl(page),
        detail: pageUrl(page),
        url: pageUrl(page),
        provenance: 'measured',
      });
    }
    return pageNodeId;
  };

  selectedPages.forEach((page, pageIndex) => {
    const types = [...new Set((page.schema_types ?? []).map(schemaTypeLabel).filter(Boolean))].slice(0, MAX_SCHEMA_TYPES);
    const references = (page.schema_references ?? []).slice(0, MAX_SCHEMA_REFERENCE_NODES);
    if (!types.length && !references.length) return;
    structuredPageIndexes.add(pageIndex);
    const pageNodeId = ensurePageNode(page, pageIndex);
    if (!pageNodeId) return;
    types.forEach((type) => {
      if (schemaNodeIds.size >= MAX_SCHEMA_TYPES && !schemaNodeIds.has(`schema:${type.toLocaleLowerCase()}`)) return;
      const normalizedType = type.toLocaleLowerCase();
      const schemaNodeId = `schema:${normalizedType}`;
      if (!schemaNodeIds.has(schemaNodeId)) {
        schemaNodeIds.add(schemaNodeId);
        nodes.push({
          id: schemaNodeId,
          kind: 'schema',
          label: type,
          detail: i18n.t('componentUi.schemaDeclaredInCrawl'),
          provenance: 'measured',
        });
      }
      if (edges.length >= MAX_EDGES) return;
      edges.push({
        id: `${pageNodeId}->${schemaNodeId}`,
        source: pageNodeId,
        target: schemaNodeId,
        kind: 'structured',
        matchedTerms: [],
        coverage: null,
        evidence: i18n.t('componentUi.schemaEvidence', { type }),
      });
    });
    references.forEach((reference, referenceIndex) => {
      if (
        schemaReferenceNodeIds.size >= MAX_SCHEMA_REFERENCE_NODES
        || edges.length >= MAX_EDGES
        || nodes.length >= MAX_PAGES + MAX_FACTS + MAX_SCHEMA_TYPES + MAX_SCHEMA_REFERENCE_NODES + 2
      ) return;
      const referenceNodeId = `schema-ref:${pageIndex}:${referenceIndex}`;
      schemaReferenceNodeIds.add(referenceNodeId);
      nodes.push({
        id: referenceNodeId,
        kind: 'schema',
        label: `${reference.property}: ${reference.value}`,
        detail: i18n.t('componentUi.schemaReferenceDetail', {
          format: reference.format,
          index: reference.declaration_index,
        }),
        provenance: 'measured',
      });
      edges.push({
        id: `${pageNodeId}->${referenceNodeId}`,
        source: pageNodeId,
        target: referenceNodeId,
        kind: 'reference',
        matchedTerms: [],
        coverage: null,
        evidence: i18n.t('componentUi.schemaReferenceEvidence', {
          property: reference.property,
          value: reference.value,
        }),
      });
    });
  });

  assertions.forEach((assertion) => {
    const fact = assertion.fact;
    const nodeId = assertion.id;
    nodes.push({
      id: nodeId,
      kind: 'fact',
      label: assertion.label,
      detail: fact?.sourceUrl ? i18n.t('runtimeErrors.entity.source', { url: fact.sourceUrl }) : fact ? i18n.t('runtimeErrors.entity.withoutSource') : i18n.t('runtimeErrors.entity.name'),
      provenance: 'asserted',
    });
    edges.push({
      id: `${entityNodeId}->${nodeId}`,
      source: entityNodeId,
      target: nodeId,
      kind: 'declared',
      matchedTerms: assertion.terms,
      coverage: null,
      evidence: fact ? i18n.t('runtimeErrors.entity.declaredAttribute', { attribute: fact.attribute }) : i18n.t('runtimeErrors.entity.declaredName'),
    });

    let assertionObserved = false;
    selectedPages.forEach((page, pageIndex) => {
      const result = coverageFor(assertion.terms, page);
      if (!result || result.coverage < 0.25) return;
      assertionObserved = assertionObserved || result.coverage === 1;
      if (nodes.length >= MAX_PAGES + MAX_FACTS + 2 || edges.length >= MAX_EDGES) return;
      const pageNodeId = ensurePageNode(page, pageIndex);
      if (!pageNodeId) return;
      edges.push({
        id: `${nodeId}->${pageNodeId}`,
        source: nodeId,
        target: pageNodeId,
        kind: 'observed',
        matchedTerms: result.matched.slice(0, 8),
        coverage: result.coverage,
        evidence: i18n.t('runtimeErrors.entity.terms', { matched: result.matched.length, total: assertion.terms.length }),
      });
    });
    if (assertionObserved) observedAssertions += 1;
  });

  return {
    nodes,
    edges,
    entityNodeId,
    comparablePages: comparablePages.length,
    structuredPages: structuredPageIndexes.size,
    schemaTypes: schemaNodeIds.size,
    observedAssertions,
    totalAssertions: assertions.length,
    truncated: pages.length > MAX_PAGES
      || document.entity.facts.length > MAX_FACTS
      || edges.length >= MAX_EDGES
      || selectedPages.some((page) => (page.schema_types ?? []).length > MAX_SCHEMA_TYPES || (page.schema_references ?? []).length > MAX_SCHEMA_REFERENCE_NODES),
  };
};
