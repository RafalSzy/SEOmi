import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { assessContentBrief, buildContentBriefExport, buildContentBriefMarkdown, compareDrafts, extractDraftParagraphs, isHttpSourceUrl, matchParagraphToCrawlSource, saveDraftVersion, updateParagraphReview, verifiedFactsForReuse } from '@/services/contentBrief';
import type { TopicalEntityFact, TopicalNode } from '@/services/topicalMap';
import type { CrawledPageSummary } from '@/types';
import { downloadText } from '@/services/export';
import { copyText } from '@/services/clipboard';

interface Props {
  node: TopicalNode;
  facts: TopicalEntityFact[];
  pages: CrawledPageSummary[];
  onUpdate: (brief: TopicalNode['contentBrief']) => void;
  onAdvance: () => void;
}

const snippetValues = ['none', 'definition', 'list', 'table', 'steps', 'faq'] as const;
const inputClass = 'mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-100 outline-none focus:border-emerald-400';
const normalizeUrl = (value: string): string => {
  try { const url = new URL(value); url.hash = ''; return url.toString(); } catch { return value.trim(); }
};

export const ContentBriefEditor = ({ node, facts, pages, onUpdate, onAdvance }: Props) => {
  const { t } = useTranslation();
  const qualityGradeLabels = {
    excellent: t('contentBrief.qualityExcellent'),
    good: t('contentBrief.qualityGood'),
    'needs-work': t('contentBrief.qualityNeedsWork'),
    thin: t('contentBrief.qualityThin'),
  } as const;
  const aeoComponentLabels = {
    definition: t('contentBrief.componentDefinition'),
    questionAnswers: t('contentBrief.componentQuestions'),
    summary: t('contentBrief.componentSummary'),
    structure: t('contentBrief.componentStructure'),
    brevity: t('contentBrief.componentBrevity'),
    standalone: t('contentBrief.componentStandalone'),
    schemaSignal: t('contentBrief.componentSchema'),
  } as const;
  const snippetLabels = {
    none: t('contentBrief.snippetNone'), definition: t('contentBrief.snippetDefinition'), list: t('contentBrief.snippetList'), table: t('contentBrief.snippetTable'), steps: t('contentBrief.snippetSteps'), faq: t('contentBrief.snippetFaq'),
  } as const;
  const brief = node.contentBrief;
  const [versionNote, setVersionNote] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const assessment = assessContentBrief(node, brief, facts, pages);
  const reusableFacts = verifiedFactsForReuse(facts);
  const crawledUrls = new Set(pages.flatMap((page) => [page.url, page.final_url]).map(normalizeUrl));
  const unverifiedPlanTargets = [...new Set(node.sourceUrls.map(normalizeUrl).filter((url) => url && !crawledUrls.has(url)))];
  const paragraphs = extractDraftParagraphs(brief.draftMarkdown);
  const update = (patch: Partial<TopicalNode['contentBrief']>) => onUpdate({ ...brief, ...patch });
  const selectedVersion = brief.draftVersions.find((version) => version.id === selectedVersionId) ?? null;
  const selectedVersionDiff = selectedVersion ? compareDrafts(selectedVersion.draftMarkdown, brief.draftMarkdown) : null;
  const persistDraftVersion = () => {
    const next = saveDraftVersion(brief, versionNote);
    if (next !== brief) {
      onUpdate(next);
      setSelectedVersionId(next.draftVersions[0]?.id ?? '');
      setVersionNote('');
    }
  };
  const restoreDraftVersion = () => {
    if (!selectedVersion || selectedVersion.draftMarkdown === brief.draftMarkdown) return;
    onUpdate({ ...brief, draftMarkdown: selectedVersion.draftMarkdown });
  };
  const exportMarkdown = () => {
    const safeTitle = node.title.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || 'brief';
    downloadText(`seomi-${safeTitle}-brief.md`, buildContentBriefMarkdown(node, brief), 'text/markdown');
  };
  const exportJson = () => {
    const safeTitle = node.title.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || 'brief';
    downloadText(`seomi-${safeTitle}-brief.json`, JSON.stringify(buildContentBriefExport(node, brief), null, 2), 'application/json');
  };
  const copyMarkdown = async () => {
    const copied = await copyText(buildContentBriefMarkdown(node, brief));
    if (!copied) return;
    setCopyState('copied');
    window.setTimeout(() => setCopyState('idle'), 1500);
  };
  const toggleInternalLinkTarget = (url: string, checked: boolean) => update({
    internalLinkTargets: (checked ? [...brief.internalLinkTargets, url] : brief.internalLinkTargets.filter((target) => normalizeUrl(target) !== normalizeUrl(url))).slice(0, 50),
  });

  return (
    <section aria-label={t('contentBrief.sectionAria')} className="mt-5 rounded-xl border border-sky-500/20 bg-slate-950/45 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
        <div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-sky-300">{t('contentBrief.workflow')}</p><h4 className="mt-1 text-sm font-semibold text-slate-100">{t('contentBrief.title')}</h4><p className="mt-1 max-w-2xl text-[10px] leading-4 text-slate-500">{t('contentBrief.description')}</p></div>
        <div className="rounded-md border border-slate-800 px-2.5 py-1.5 text-right"><span className="block text-[9px] uppercase text-slate-600">{t('contentBrief.draft')}</span><span className="font-mono text-xs tabular-nums text-slate-300">{t('contentBrief.wordCount', { count: assessment.wordCount })}</span></div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="block text-[10px] text-slate-400">{t('contentBrief.targetQuery')}
          <select aria-label={t('contentBrief.targetQueryAria')} className={inputClass} value={brief.targetQueryId} onChange={(event) => update({ targetQueryId: event.target.value })}>
            <option value="">{t('contentBrief.chooseQuery')}</option>
            {node.queries.map((query) => <option key={query.id} value={query.id}>{query.text} · {query.provenance}</option>)}
          </select>
          {!node.queries.length && <span className="mt-1 block text-amber-300/80">{t('contentBrief.addQuery')}</span>}
        </label>
        <label className="block text-[10px] text-slate-400">{t('contentBrief.formatGoal')}
          <select aria-label={t('contentBrief.snippetAria')} className={inputClass} value={brief.snippetTarget} onChange={(event) => update({ snippetTarget: event.target.value as TopicalNode['contentBrief']['snippetTarget'] })}>
            {snippetValues.map((value) => <option key={value} value={value}>{snippetLabels[value]}</option>)}
          </select>
          <span className="mt-1 block text-slate-600">{t('contentBrief.snippetDisclaimer')}</span>
        </label>
      </div>

      <label className="mt-4 block text-[10px] text-slate-400">{t('contentBrief.requiredEntities')} <span className="text-slate-600">{t('contentBrief.onePerLine')}</span>
        <textarea aria-label={t('contentBrief.requiredAria')} className="mt-1 min-h-20 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs leading-5 text-slate-100 outline-none focus:border-emerald-400" maxLength={10000} value={brief.requiredEntities.join('\n')} onChange={(event) => update({ requiredEntities: [...new Set(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))].slice(0, 80) })} placeholder={t('contentBrief.requiredPlaceholder')} />
        {assessment.missingRequiredEntities.length > 0 && <span className="mt-1 block text-amber-200">{t('contentBrief.missingInDraft', { items: assessment.missingRequiredEntities.join(', ') })}</span>}
      </label>

      <fieldset className="mt-4 rounded-lg border border-slate-800 p-3">
        <legend className="px-1 text-[10px] font-medium text-slate-400">{t('contentBrief.internalPlan')}</legend>
        <div className="max-h-36 space-y-1 overflow-y-auto">{pages.slice(0, 500).map((page) => {
          const url = page.final_url || page.url;
          const checked = brief.internalLinkTargets.includes(url);
          return <label key={page.url} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[10px] hover:bg-slate-900"><input type="checkbox" aria-label={t('contentBrief.addInternal', { url })} checked={checked} onChange={() => toggleInternalLinkTarget(url, !checked)} /><span className="min-w-0"><span className="block truncate text-slate-300">{page.title || t('contentBrief.noTitle')}</span><span className="block truncate font-mono text-slate-600">{url}</span><span className="block text-emerald-400">{t('contentBrief.verifiedRun')}</span></span></label>;
        })}{pages.length === 0 && <p className="text-[10px] text-slate-600">{t('contentBrief.runCrawl')}</p>}</div>
        {unverifiedPlanTargets.length > 0 && <div aria-label={t('contentBrief.unverifiedAria')} className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/5 p-2"><p className="text-[9px] leading-4 text-amber-200">{t('contentBrief.unverifiedDescription')}</p><div className="mt-2 max-h-28 space-y-1 overflow-y-auto">{unverifiedPlanTargets.slice(0, 100).map((url) => {
          const checked = brief.internalLinkTargets.some((target) => normalizeUrl(target) === url);
          return <label key={url} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[10px] hover:bg-slate-900"><input type="checkbox" aria-label={t('contentBrief.addUnverified', { url })} checked={checked} onChange={() => toggleInternalLinkTarget(url, !checked)} /><span className="min-w-0"><span className="block truncate font-mono text-slate-300">{url}</span><span className="block text-amber-300">{t('contentBrief.outsideRun')}</span></span></label>;
        })}</div>{unverifiedPlanTargets.length > 100 && <p className="mt-1 text-[9px] text-amber-100/60">{t('contentBrief.limited100')}</p>}</div>}
        {assessment.unavailableInternalLinks.length > 0 && <p className="mt-2 text-[10px] text-amber-200">{t('contentBrief.unavailableTargets', { count: assessment.unavailableInternalLinks.length })}</p>}
        {pages.length > 500 && <p className="mt-1 text-[9px] text-slate-600">{t('contentBrief.limited500')}</p>}
      </fieldset>

      <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <h5 className="text-[10px] font-semibold text-amber-100">{t('contentBrief.factsTitle')}</h5>
        <p className="mt-1 text-[9px] leading-4 text-amber-100/60">{t('contentBrief.factsDescription')}</p>
        {facts.length ? <ul className="mt-2 space-y-1">{facts.map((fact) => <li key={fact.id} className="break-words text-[10px] text-slate-300"><span className={fact.reuseStatus === 'verified' && fact.sourceUrl ? 'text-emerald-300' : 'text-amber-200'}>{fact.reuseStatus === 'verified' && fact.sourceUrl ? t('contentBrief.verified') : t('contentBrief.locked')}</span> · {fact.attribute}: {fact.value}{fact.sourceUrl && <a className="ml-1 text-sky-300 underline" href={fact.sourceUrl} target="_blank" rel="noreferrer">{t('contentBrief.source')}</a>}{assessment.lockedFactsInDraft.some((locked) => locked.id === fact.id) && <span className="ml-1 font-semibold text-rose-300">{t('contentBrief.blocksDraft')}</span>}</li>)}</ul> : <p className="mt-2 text-[10px] text-slate-600">{t('contentBrief.noFacts')}</p>}
        {assessment.lockedFactsInDraft.length > 0 && <p role="alert" className="mt-2 text-[10px] text-rose-200">{t('contentBrief.lockedAlert', { values: assessment.lockedFactsInDraft.map((fact) => fact.value).join(', ') })}</p>}
      </div>

      {reusableFacts.length > 0 && <details className="mt-3 rounded-md border border-slate-800 px-3 py-2"><summary className="cursor-pointer text-[10px] text-slate-400">{t('contentBrief.approvedSources', { count: reusableFacts.length })}</summary><ul className="mt-2 space-y-1">{reusableFacts.map((fact) => <li key={fact.id} className="break-all text-[9px] text-slate-500">{fact.attribute}: {fact.value} · {fact.sourceUrl}</li>)}</ul></details>}

      <label className="mt-4 block text-[10px] text-slate-400">{t('contentBrief.editorDraft')}
        <textarea aria-label={t('contentBrief.draftAria')} className="mt-1 min-h-48 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs leading-5 text-slate-200 outline-none focus:border-emerald-400" maxLength={50_000} value={brief.draftMarkdown} onChange={(event) => update({ draftMarkdown: event.target.value })} placeholder={t('contentBrief.draftPlaceholder')} />
      </label>
      <section aria-label={t('contentBrief.versionHistoryAria')} className="mt-3 rounded-lg border border-slate-800 bg-slate-950/35 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h5 className="text-[10px] font-semibold text-slate-300">{t('contentBrief.versionHistoryTitle')}</h5>
            <p className="mt-1 max-w-2xl text-[9px] leading-4 text-slate-600">{t('contentBrief.versionHistoryDescription')}</p>
          </div>
          <span className="font-mono text-[10px] text-slate-500">{t('contentBrief.versionCount', { count: brief.draftVersions.length })}</span>
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-[9px] text-slate-500">{t('contentBrief.versionNote')}
            <input aria-label={t('contentBrief.versionNoteAria')} maxLength={240} value={versionNote} onChange={(event) => setVersionNote(event.target.value)} className={inputClass} placeholder={t('contentBrief.versionNotePlaceholder')} />
          </label>
          <button type="button" aria-label={t('contentBrief.saveVersion')} disabled={!brief.draftMarkdown.trim()} onClick={persistDraftVersion} className="h-9 rounded border border-sky-500/30 px-3 text-[10px] font-semibold text-sky-200 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-40">{t('contentBrief.saveVersion')}</button>
        </div>
        {brief.draftVersions.length > 0 && <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-[9px] text-slate-500">{t('contentBrief.compareVersion')}
            <select aria-label={t('contentBrief.diffAria')} value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)} className={inputClass}>
              <option value="">{t('contentBrief.chooseCheckpoint')}</option>
              {brief.draftVersions.map((version) => <option key={version.id} value={version.id}>{new Date(version.savedAt).toLocaleString()} · {version.note || t('contentBrief.noNote')}</option>)}
            </select>
          </label>
          <button type="button" aria-label={t('contentBrief.restoreVersion')} disabled={!selectedVersion || selectedVersion.draftMarkdown === brief.draftMarkdown} onClick={restoreDraftVersion} className="h-9 rounded border border-amber-500/30 px-3 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40">{t('contentBrief.restoreVersion')}</button>
        </div>}
        {selectedVersionDiff && <div role="status" aria-label={t('contentBrief.diffAria')} className="mt-2 rounded border border-slate-800 bg-slate-950/60 p-2 text-[9px] text-slate-400">
          <p>{t('contentBrief.diffAgainst', { added: selectedVersionDiff.addedLineCount, removed: selectedVersionDiff.removedLineCount, addedChars: selectedVersionDiff.addedCharacterCount, removedChars: selectedVersionDiff.removedCharacterCount })}{!selectedVersionDiff.changed && t('contentBrief.noChanges')}</p>
          {(selectedVersionDiff.addedLines.length > 0 || selectedVersionDiff.removedLines.length > 0) && <details className="mt-1"><summary className="cursor-pointer text-slate-500">{t('contentBrief.showChangedLines')}</summary><div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto font-mono">{selectedVersionDiff.addedLines.map((line, index) => <div key={`added-${index}-${line}`} className="break-words text-emerald-300">+ {line || ' '}</div>)}{selectedVersionDiff.removedLines.map((line, index) => <div key={`removed-${index}-${line}`} className="break-words text-rose-300">- {line || ' '}</div>)}</div></details>}
        </div>}
      </section>
      <section aria-label={t('contentBrief.localHandoffAria')} className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/25 p-3">
        <span className="mr-1 text-[10px] font-semibold text-slate-300">{t('contentBrief.localHandoff')}</span>
        <button type="button" aria-label={t('contentBrief.downloadMarkdown')} onClick={exportMarkdown} className="rounded border border-slate-700 px-2.5 py-1.5 text-[10px] text-slate-300 hover:border-sky-400/50 hover:text-sky-200">{t('contentBrief.formatMarkdown')}</button>
        <button type="button" aria-label={t('contentBrief.downloadJson')} onClick={exportJson} className="rounded border border-slate-700 px-2.5 py-1.5 text-[10px] text-slate-300 hover:border-sky-400/50 hover:text-sky-200">{t('contentBrief.formatJson')}</button>
        <button type="button" aria-label={t('contentBrief.copyMarkdown')} onClick={() => void copyMarkdown()} className="rounded border border-slate-700 px-2.5 py-1.5 text-[10px] text-slate-300 hover:border-emerald-400/50 hover:text-emerald-200">{copyState === 'copied' ? t('contentBrief.copied') : t('contentBrief.copyMarkdown')}</button>
        <span className="basis-full text-[9px] text-slate-600">{t('contentBrief.exportDescription')}</span>
      </section>
      <section aria-label={t('contentBrief.qualityAria')} className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/[.035] p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><div><h5 className="text-[10px] font-semibold text-violet-100">{t('contentBrief.editorialIndex')}</h5><p className="mt-1 text-[9px] text-slate-500">{t('contentBrief.qualityDescription')}</p></div><span className="font-mono text-sm font-semibold tabular-nums text-violet-100">{assessment.draftQuality.score}/100 · {qualityGradeLabels[assessment.draftQuality.grade]}</span></div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5">{Object.entries(assessment.draftQuality.components).map(([key, value]) => <div key={key} className="rounded border border-slate-800 bg-slate-950/50 px-2 py-1.5"><span className="block text-[8px] uppercase text-slate-600">{t(`contentBrief.qualityComponent.${key}`)}</span><span className="font-mono text-[10px] text-slate-300">{value}</span></div>)}</div>
        {assessment.draftQuality.recommendations.length > 0 ? <ul className="mt-2 space-y-1">{assessment.draftQuality.recommendations.map((item) => <li key={item} className="text-[9px] leading-4 text-amber-100/80">· {item}</li>)}</ul> : <p className="mt-2 text-[9px] text-emerald-200/70">{t('contentBrief.noQualitySignals')}</p>}
        <p className="mt-2 text-[8px] text-slate-600">{assessment.draftQuality.methodology}{t('contentBrief.workflowUnblocked')}</p>
      </section>
      <section aria-label={t('contentBrief.aeoAria')} className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/[.025] p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><div><h5 className="text-[10px] font-semibold text-cyan-100">{t('contentBrief.aeoTitle')}</h5><p className="mt-1 text-[9px] text-slate-500">{t('contentBrief.aeoDescription')}</p></div><span className="font-mono text-sm font-semibold tabular-nums text-cyan-100">{assessment.aeoReadiness.score}/100</span></div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-7">{Object.entries(assessment.aeoReadiness.components).map(([key, value]) => <div key={key} className="rounded border border-slate-800 bg-slate-950/50 px-2 py-1.5"><span className="block text-[8px] uppercase text-slate-600">{aeoComponentLabels[key as keyof typeof aeoComponentLabels]}</span><span className="font-mono text-[10px] text-slate-300">{value}</span></div>)}</div>
        <p className="mt-2 text-[9px] text-slate-500">{t('contentBrief.answeredQuestions', { answered: assessment.aeoReadiness.answeredQuestionHeadings, total: assessment.aeoReadiness.questionHeadings, types: assessment.aeoReadiness.schemaTypesObserved.join(', ') || t('contentBrief.noData') })}</p>
        {assessment.aeoReadiness.recommendations.length > 0 && <ul className="mt-2 space-y-1">{assessment.aeoReadiness.recommendations.slice(0, 5).map((item) => <li key={item} className="text-[9px] leading-4 text-cyan-100/70">· {item}</li>)}</ul>}
        <div aria-label={t('contentBrief.outlineAria')} className={`mt-2 rounded border px-2 py-1.5 text-[9px] ${assessment.aeoReadiness.outlineIssues.length ? 'border-amber-500/20 bg-amber-500/5 text-amber-200' : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200'}`}>
          {assessment.aeoReadiness.outlineIssues.length ? <><span className="font-semibold">{t('contentBrief.outlineIssue')}</span> {assessment.aeoReadiness.outlineIssues.join(' · ')}</> : t('contentBrief.outlineValid')}
        </div>
        <p className="mt-2 text-[8px] text-slate-600">{assessment.aeoReadiness.methodology}</p>
      </section>
      <section aria-label={t('contentBrief.paragraphAria')} className="mt-3 rounded-lg border border-slate-800 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h5 className="text-[10px] font-semibold text-slate-300">{t('contentBrief.paragraphReviewTitle', { count: paragraphs.length })}</h5><span className="text-[9px] text-slate-600">{t('contentBrief.notSourceValidation')}</span></div>
        <div className="mt-2 space-y-2">{paragraphs.map((paragraph, index) => {
          const review = brief.paragraphReviews.find((item) => item.paragraph === paragraph);
          const treatment = review?.treatment ?? 'unreviewed';
          const sourceEvidence = treatment === 'source-backed' && review?.sourceUrl
            ? matchParagraphToCrawlSource(paragraph, review.sourceUrl, pages)
            : null;
          return <article key={`${index}-${paragraph}`} className="rounded-md border border-slate-800 bg-slate-950/45 p-2.5">
            <p className="line-clamp-3 break-words text-[10px] leading-4 text-slate-400">{t('contentBrief.paragraphPrefix', { index: index + 1, text: paragraph })}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-[9px] text-slate-500">{t('contentBrief.classification')}
                <select aria-label={t('contentBrief.paragraphClassificationAria', { index: index + 1 })} className="mt-1 h-8 w-full rounded border border-slate-700 bg-slate-950 px-2 text-[10px] text-slate-200" value={treatment} onChange={(event) => {
                  const nextTreatment = event.target.value as NonNullable<typeof review>['treatment'];
                  const next = updateParagraphReview(brief.paragraphReviews, paragraph, { treatment: nextTreatment, sourceUrl: nextTreatment === 'source-backed' ? review?.sourceUrl ?? '' : '', sourceChecked: false });
                  update({ paragraphReviews: next });
                }}>
                  <option value="unreviewed">{t('contentBrief.unreviewed')}</option><option value="editorial">{t('contentBrief.editorial')}</option><option value="source-backed">{t('contentBrief.sourceBacked')}</option>
                </select>
              </label>
              {treatment === 'source-backed' && <div className="text-[9px] text-slate-500"><label>{t('contentBrief.sourceUrl')}<input aria-label={t('contentBrief.sourceUrl')} value={review?.sourceUrl ?? ''} onChange={(event) => update({ paragraphReviews: updateParagraphReview(brief.paragraphReviews, paragraph, { treatment: 'source-backed', sourceUrl: event.target.value, sourceChecked: false }) })} className="mt-1 h-8 w-full rounded border border-slate-700 bg-slate-950 px-2 text-[10px] text-slate-200" placeholder={t('contentBrief.sourcePlaceholder')} /></label><label className={`mt-1 flex items-center gap-1 ${review?.sourceChecked ? 'text-emerald-300' : 'text-amber-200'}`}><input type="checkbox" aria-label={t('contentBrief.confirmSourceAria', { index: index + 1 })} checked={review?.sourceChecked ?? false} disabled={!isHttpSourceUrl(review?.sourceUrl ?? '')} onChange={(event) => update({ paragraphReviews: updateParagraphReview(brief.paragraphReviews, paragraph, { sourceChecked: event.target.checked }) })} />{t('contentBrief.sourceSupports')}</label></div>}
            </div>
            {treatment === 'source-backed' && sourceEvidence && <p className={`mt-1 rounded border px-2 py-1 text-[9px] leading-4 ${sourceEvidence.matched ? 'border-sky-500/20 bg-sky-500/5 text-sky-200' : 'border-amber-500/20 bg-amber-500/5 text-amber-200'}`}>
              {sourceEvidence.scope === 'not-in-snapshot'
                ? t('contentBrief.notInSnapshot')
                : sourceEvidence.matched
                  ? t('contentBrief.snapshotExcerpt', { kind: sourceEvidence.scope === 'sentence-match' ? t('contentBrief.matchingSentence') : sourceEvidence.scope === 'excerpt' ? t('contentBrief.matchingExcerpt') : t('contentBrief.sharedTerms'), count: sourceEvidence.matchedTerms.length, overlap: sourceEvidence.overlapPercent !== null ? ` · ${sourceEvidence.overlapPercent}%${sourceEvidence.responseSpan ? ` · ${t('contentBrief.evidenceRange', { range: `${sourceEvidence.responseSpan.start}–${sourceEvidence.responseSpan.end}` })}` : ''}` : '' })
                  : t('contentBrief.insufficientSignal', { terms: sourceEvidence.matchedTerms.length ? ` (${t('contentBrief.sharedTerms')}: ${sourceEvidence.matchedTerms.join(', ')})` : '' })}
            </p>}
            {treatment === 'unreviewed' && <p className="mt-1 text-[9px] text-amber-200">{t('contentBrief.unreviewedParagraph')}</p>}
            {assessment.unsupportedParagraphs.includes(paragraph) && <p className="mt-1 text-[9px] text-rose-200">{t('contentBrief.unsupportedParagraph')}</p>}
          </article>;
        })}
        {paragraphs.length === 0 && <p className="py-3 text-center text-[10px] text-slate-600">{t('contentBrief.emptyParagraphs')}</p>}
        </div>
        {paragraphs.length > 500 && <p role="alert" className="mt-2 text-[9px] text-rose-200">{t('contentBrief.paragraphLimit')}</p>}
        {assessment.unreviewedParagraphs.length > 0 && <p className="mt-2 text-[9px] text-amber-200">{t('contentBrief.unreviewedCount', { count: assessment.unreviewedParagraphs.length })}</p>}
      </section>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="max-w-2xl text-[9px] leading-4 text-slate-600">{t('contentBrief.advanceDescription')}</p><button type="button" disabled={!assessment.readyToAdvance} onClick={onAdvance} className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] font-semibold text-emerald-100 enabled:hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40">{node.lifecycle === 'drafted' ? t('contentBrief.draftReady') : t('contentBrief.markDraft')}</button></div>
      <span className="sr-only" aria-label={t('contentBrief.crawledUrlsAria', { count: crawledUrls.size })}>{crawledUrls.size}</span>
    </section>
  );
};
