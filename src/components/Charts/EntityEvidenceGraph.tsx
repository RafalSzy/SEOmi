import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CrawledPageSummary } from '@/types';
import type { TopicalMapDocument } from '@/services/topicalMap';
import { buildEntityEvidenceGraph, type EntityEvidenceNode } from '@/services/entityEvidenceGraph';

interface Props {
  document: TopicalMapDocument;
  pages: CrawledPageSummary[];
}

const GRAPH_WIDTH = 1240;
const MAX_VISIBLE_FACTS = 28;
const MAX_VISIBLE_PAGES = 36;
const MAX_VISIBLE_SCHEMA_TYPES = 28;

const percent = (value: number | null | undefined): string => value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
const shortLabel = (value: string, max = 30): string => value.length > max ? `${value.slice(0, max - 1)}…` : value;

const nodeColor: Record<EntityEvidenceNode['kind'], string> = {
  entity: '#34d399',
  fact: '#fbbf24',
  page: '#60a5fa',
  schema: '#c084fc',
};

export const EntityEvidenceGraph = ({ document, pages }: Props) => {
  const { t } = useTranslation();
  const graph = useMemo(() => buildEntityEvidenceGraph(document, pages), [document, pages]);
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const factNodes = graph.nodes.filter((node) => node.kind === 'fact' && (!query || `${node.label} ${node.detail ?? ''}`.toLocaleLowerCase().includes(query))).slice(0, MAX_VISIBLE_FACTS);
  const visibleFactIds = new Set(factNodes.map((node) => node.id));
  const pageNodes = graph.nodes.filter((node) => node.kind === 'page' && (!query || `${node.label} ${node.detail ?? ''}`.toLocaleLowerCase().includes(query))).slice(0, MAX_VISIBLE_PAGES);
  const visiblePageIds = new Set(pageNodes.map((node) => node.id));
  const schemaNodes = graph.nodes.filter((node) => node.kind === 'schema' && (!query || `${node.label} ${node.detail ?? ''}`.toLocaleLowerCase().includes(query))).slice(0, MAX_VISIBLE_SCHEMA_TYPES);
  const visibleSchemaIds = new Set(schemaNodes.map((node) => node.id));
  const entityNode = graph.nodes.find((node) => node.kind === 'entity');
  const visibleEdges = graph.edges.filter((edge) => (
    edge.kind === 'declared'
      ? visibleFactIds.has(edge.target)
      : edge.kind === 'observed'
        ? visibleFactIds.has(edge.source) && visiblePageIds.has(edge.target)
        : visiblePageIds.has(edge.source) && visibleSchemaIds.has(edge.target)
  ));
  const rows = Math.max(factNodes.length, pageNodes.length, schemaNodes.length, 1);
  const height = Math.max(330, rows * 42 + 100);
  const factPosition = new Map(factNodes.map((node, index) => [node.id, { x: 360, y: 50 + index * 42 }]));
  const pagePosition = new Map(pageNodes.map((node, index) => [node.id, { x: 650, y: 50 + index * 42 }]));
  const schemaPosition = new Map(schemaNodes.map((node, index) => [node.id, { x: 970, y: 50 + index * 42 }]));
  const entityPosition = { x: 110, y: height / 2 };
  const positionOf = (nodeId: string) => nodeId === entityNode?.id ? entityPosition : factPosition.get(nodeId) ?? pagePosition.get(nodeId) ?? schemaPosition.get(nodeId);

  if (!entityNode) return <section aria-label={t('componentUi.entityGraph')} className="rounded-xl border border-slate-800 bg-slate-900/45 p-4"><h4 className="text-sm font-semibold text-slate-100">{t('componentUi.entityGraph')}</h4><p className="mt-2 rounded-md border border-dashed border-slate-700 p-4 text-xs text-slate-500">{t('componentUi.entityGraphEmpty')}</p></section>;

  return <section aria-label={t('componentUi.entityGraph')} className="rounded-xl border border-slate-800 bg-slate-900/45 p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h4 className="text-sm font-semibold text-slate-100">{t('componentUi.entityGraph')}</h4><p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">{t('componentUi.entityGraphDescription')}</p></div>
      <label className="shrink-0 text-[10px] text-slate-500">{t('componentUi.graphFilter')}<input aria-label={t('componentUi.searchEntityGraph')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('componentUi.factOrUrl')} className="mt-1 block h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-emerald-400 sm:w-52" /></label>
    </div>

    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
      <Metric label={t('componentUi.declarations')} value={`${graph.observedAssertions}/${graph.totalAssertions}`} detail={t('componentUi.fullTermMatch')} />
      <Metric label={t('componentUi.pagesWithTerms')} value={String(graph.comparablePages)} detail={t('componentUi.measurableSample')} />
      <Metric label={t('componentUi.structuredPages')} value={String(graph.structuredPages)} detail={t('componentUi.structuredTypesDetail', { count: graph.schemaTypes })} />
      <Metric label={t('componentUi.edges')} value={String(graph.edges.length)} detail={t('componentUi.declarationsObservations')} />
      <Metric label={t('componentUi.source')} value={t('componentUi.crawl')} detail={t('componentUi.projectSnapshot')} />
    </div>

    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/35" tabIndex={0} aria-label={t('componentUi.graphVisualization')}>
      <svg role="img" aria-label={`${t('componentUi.entityGraph')} ${entityNode.label}`} width={GRAPH_WIDTH} height={height} viewBox={`0 0 ${GRAPH_WIDTH} ${height}`} className="min-w-[1240px]">
        <defs><marker id="entity-evidence-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#64748b" /></marker></defs>
        {visibleEdges.map((edge) => {
          const source = positionOf(edge.source);
          const target = positionOf(edge.target);
          if (!source || !target) return null;
          const color = edge.kind === 'declared' ? '#f59e0b' : edge.kind === 'structured' ? '#c084fc' : edge.kind === 'reference' ? '#22d3ee' : '#60a5fa';
          return <line key={edge.id} x1={source.x + 28} y1={source.y} x2={target.x - 28} y2={target.y} stroke={color} strokeOpacity=".42" strokeWidth={edge.kind === 'declared' ? 1.8 : 1.2} strokeDasharray={edge.kind === 'observed' ? '4 4' : edge.kind === 'structured' ? '2 3' : edge.kind === 'reference' ? '1 4' : undefined} markerEnd="url(#entity-evidence-arrow)"><title>{edge.evidence}{edge.coverage !== null ? ` · ${t('componentUi.coverage')} ${percent(edge.coverage)}` : ''}</title></line>;
        })}
        {entityNode && <GraphNode node={entityNode} x={entityPosition.x} y={entityPosition.y} />}
        {factNodes.map((node) => { const point = factPosition.get(node.id)!; return <GraphNode key={node.id} node={node} x={point.x} y={point.y} />; })}
        {pageNodes.map((node) => { const point = pagePosition.get(node.id)!; return <GraphNode key={node.id} node={node} x={point.x} y={point.y} />; })}
        {schemaNodes.map((node) => { const point = schemaPosition.get(node.id)!; return <GraphNode key={node.id} node={node} x={point.x} y={point.y} />; })}
        <text x="110" y="22" fill="#64748b" fontSize="10" textAnchor="middle">{t('componentUi.entity')}</text>
        <text x="360" y="22" fill="#64748b" fontSize="10" textAnchor="middle">{t('componentUi.factsName')}</text>
        <text x="650" y="22" fill="#64748b" fontSize="10" textAnchor="middle">{t('componentUi.contentPages')}</text>
        <text x="970" y="22" fill="#64748b" fontSize="10" textAnchor="middle">{t('componentUi.schemaTypesName')}</text>
      </svg>
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-slate-500"><span className="rounded border border-amber-500/25 px-2 py-1 text-amber-200">{t('componentUi.declaredEdge')}</span><span className="rounded border border-sky-500/25 px-2 py-1 text-sky-200">{t('componentUi.observedEdge')}</span><span className="rounded border border-violet-500/25 px-2 py-1 text-violet-200">{t('componentUi.structuredEdge')}</span><span className="rounded border border-cyan-500/25 px-2 py-1 text-cyan-200">{t('componentUi.referenceEdge')}</span><span className="text-slate-600">{t('componentUi.shownLimits', { facts: MAX_VISIBLE_FACTS, pages: MAX_VISIBLE_PAGES })}</span></div>
    {graph.truncated && <p role="status" className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-100">{t('componentUi.graphLimited')}</p>}
    {(factNodes.length === 0 || pageNodes.length === 0) && <p className="mt-2 rounded-md border border-dashed border-slate-800 px-3 py-3 text-center text-[10px] text-slate-500">{t('componentUi.noGraphMatches')}</p>}
  </section>;
};

const GraphNode = ({ node, x, y }: { node: EntityEvidenceNode; x: number; y: number }) => {
  const { t } = useTranslation();
  const initial = node.kind === 'entity'
    ? t('componentUi.entityInitial')
    : node.kind === 'fact'
      ? t('componentUi.factInitial')
      : node.kind === 'schema'
        ? t('componentUi.schemaInitial')
        : t('componentUi.pageInitial');
  return <g><circle cx={x} cy={y} r={node.kind === 'entity' ? 25 : 20} fill="#0f172a" stroke={nodeColor[node.kind]} strokeWidth="2" /><text x={x} y={y + 4} fill={nodeColor[node.kind]} fontSize={node.kind === 'entity' ? '9' : '8'} textAnchor="middle">{initial}</text><text x={x + 34} y={y - 3} fill="#cbd5e1" fontSize="10">{shortLabel(node.label, node.kind === 'page' ? 36 : 32)}</text>{node.detail && <text x={x + 34} y={y + 11} fill="#64748b" fontSize="8">{shortLabel(node.detail, 44)}</text>}<title>{node.label}{node.detail ? ` · ${node.detail}` : ''}</title></g>;
};

const Metric = ({ label, value, detail }: { label: string; value: string; detail: string }) => <div className="rounded-md border border-slate-800 bg-slate-950/45 p-2"><span className="block text-[9px] uppercase tracking-wide text-slate-500">{label}</span><span className="mt-1 block font-mono text-sm tabular-nums text-slate-100">{value}</span><span className="mt-0.5 block text-[9px] text-slate-600">{detail}</span></div>;
