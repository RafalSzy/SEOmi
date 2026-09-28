import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Copy, Check, Sparkles } from 'lucide-react';
import { AccessibilityFinding, PageAuditData } from '@/types';
import { useUIStore } from '@/stores/uiStore';
import { useAuditStore } from '@/stores/auditStore';
import { getMetadataProblems } from '@/services/auditProblems';
import { ProblemsOnlyNotice } from './ProblemsOnlyNotice';
import { copyText } from '@/services/clipboard';
import { ShowOnPageButton } from '@/components/Results/ShowOnPageButton';

interface MetadataTableProps {
  audit: PageAuditData;
}

export const MetadataTable: React.FC<MetadataTableProps> = ({ audit }) => {
  const { t } = useTranslation();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const openModal = useUIStore((s) => s.openModal);
  const showOnlyProblems = useAuditStore((state) => state.showOnlyProblems);

  const { meta_tags } = audit;

  const copyToClipboard = async (text: string, key: string) => {
    const copied = await copyText(text);
    if (!copied) return;
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const titleLength = meta_tags.title_length;
  const isTitleOptimal = titleLength >= 40 && titleLength <= 65;

  const descLength = meta_tags.description_length;
  const isDescOptimal = descLength >= 120 && descLength <= 165;
  const metadataProblems = getMetadataProblems(audit);

  const accessibilityFindingMessage = (finding: AccessibilityFinding): string => {
    switch (finding.code) {
      case 'accessibility-document-language-missing':
        return t('accessibility.findingMessages.documentLanguageMissing');
      case 'accessibility-document-language-invalid':
        return t('accessibility.findingMessages.documentLanguageInvalid');
      case 'accessibility-main-landmark-missing':
        return t('accessibility.findingMessages.mainLandmarkMissing');
      case 'accessibility-multiple-main-landmarks':
        return t('accessibility.findingMessages.multipleMainLandmarks', {
          count: finding.elements?.length || Number(finding.message.match(/\d+/)?.[0] || 0),
        });
      case 'accessibility-form-controls-unlabeled':
        return t('accessibility.findingMessages.unlabeledControls', {
          unlabeled: audit.accessibility?.unlabeled_form_control_count ?? 0,
          total: audit.accessibility?.form_control_count ?? 0,
        });
      case 'accessibility-focusable-aria-hidden':
        return t('accessibility.findingMessages.focusableAriaHidden', {
          count: Number(finding.message.match(/\d+/)?.[0] || finding.elements?.length || 0),
        });
      default:
        return finding.message;
    }
  };

  const accessibilityFindingRecommendation = (finding: AccessibilityFinding): string => {
    const keyByCode: Record<string, string> = {
      'accessibility-document-language-missing': 'accessibility.findingRecommendations.documentLanguageMissing',
      'accessibility-document-language-invalid': 'accessibility.findingRecommendations.documentLanguageInvalid',
      'accessibility-main-landmark-missing': 'accessibility.findingRecommendations.mainLandmarkMissing',
      'accessibility-multiple-main-landmarks': 'accessibility.findingRecommendations.multipleMainLandmarks',
      'accessibility-antispam-control-not-text': 'accessibility.findingRecommendations.antispamNonText',
      'accessibility-form-controls-unlabeled': 'accessibility.findingRecommendations.unlabeledControls',
      'accessibility-duplicate-id': 'accessibility.findingRecommendations.duplicateId',
      'accessibility-aria-reference-unresolved': 'accessibility.findingRecommendations.ariaReference',
      'accessibility-interactive-name-missing': 'accessibility.findingRecommendations.interactiveName',
      'accessibility-focusable-aria-hidden': 'accessibility.findingRecommendations.focusableAriaHidden',
      'accessibility-image-alt-missing': 'accessibility.findingRecommendations.imageAlt',
    };
    const key = keyByCode[finding.code];
    return key ? t(key) : finding.recommendation;
  };

  const accessibilityFindingEvidence = (finding: AccessibilityFinding): string => {
    const stripPrefix = (value: string): string => value.replace(/^[^:：]+[:：]\s*/, '').trim();
    switch (finding.code) {
      case 'accessibility-document-language-missing':
        return t('accessibility.findingEvidence.documentLanguageMissing');
      case 'accessibility-document-language-invalid':
        return t('accessibility.findingEvidence.documentLanguageInvalid', { value: finding.evidence.replace(/^lang=/i, '') });
      case 'accessibility-main-landmark-missing':
        return t('accessibility.findingEvidence.mainLandmarkMissing');
      case 'accessibility-multiple-main-landmarks':
        return t('accessibility.findingEvidence.multipleMainLandmarks', { count: finding.elements?.length || Number(finding.message.match(/\d+/)?.[0] || 0) });
      case 'accessibility-antispam-control-not-text':
        return t('accessibility.findingEvidence.antispamNonText');
      case 'accessibility-form-controls-unlabeled':
        return t('accessibility.findingEvidence.unlabeledControls', {
          unlabeled: audit.accessibility?.unlabeled_form_control_count ?? 0,
          total: audit.accessibility?.form_control_count ?? 0,
        });
      case 'accessibility-duplicate-id':
        return t('accessibility.findingEvidence.duplicateId', { value: stripPrefix(finding.evidence) });
      case 'accessibility-aria-reference-unresolved':
        return t('accessibility.findingEvidence.ariaReference', { value: finding.evidence });
      case 'accessibility-interactive-name-missing':
        return t('accessibility.findingEvidence.interactiveName', { value: stripPrefix(finding.evidence) });
      case 'accessibility-focusable-aria-hidden':
        return t('accessibility.findingEvidence.focusableAriaHidden', { count: Number(finding.message.match(/\d+/)?.[0] || finding.elements?.length || 0) });
      case 'accessibility-image-alt-missing':
        return t('accessibility.findingEvidence.imageAlt', { count: Number(finding.message.match(/\d+/)?.[0] || finding.elements?.length || 0) });
      default:
        return finding.evidence;
    }
  };

  const accessibilityManualReview = (items: string[]): string => items.map((item, index) => {
    const key = ['contrast', 'keyboard', 'ariaTree'][index];
    return key ? t(`accessibility.manualReview.${key}`) : item;
  }).join(' ');

  const technologyCategoryKey: Record<string, string> = {
    'CMS / platform': 'legacyUi.metadata.technologyCategories.cmsPlatform',
    'CMS / generator': 'legacyUi.metadata.technologyCategories.cmsGenerator',
    CMS: 'legacyUi.metadata.technologyCategories.cms',
    'Commerce platform': 'legacyUi.metadata.technologyCategories.commercePlatform',
    'JavaScript framework': 'legacyUi.metadata.technologyCategories.javascriptFramework',
    'Tag manager': 'legacyUi.metadata.technologyCategories.tagManager',
    'Analytics / tag': 'legacyUi.metadata.technologyCategories.analyticsTag',
    'JavaScript library': 'legacyUi.metadata.technologyCategories.javascriptLibrary',
    'CSS / UI framework': 'legacyUi.metadata.technologyCategories.cssFramework',
    Analytics: 'legacyUi.metadata.technologyCategories.analytics',
  };
  const technologyCategory = (category: string): string => {
    const key = technologyCategoryKey[category];
    return key ? t(key, { defaultValue: category }) : category;
  };

  if (showOnlyProblems) {
    return <div className="mx-auto max-w-5xl animate-in fade-in duration-200 p-4 md:p-6"><ProblemsOnlyNotice problems={metadataProblems} subject={t('sidebar.metadata')} /></div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-6 animate-in fade-in duration-200">
      {/* Title & Description Spotlight Card */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Code className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">{t('metadata.metaTableTitle')}</h3>
          </div>
          <button
            onClick={() => openModal('ai')}
            className="px-2.5 py-1 text-xs rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:border-emerald-500/40 transition flex items-center space-x-1"
          >
            <Sparkles className="w-3 h-3 text-emerald-400" />
            <span>{t('legacyUi.metadata.aiOptimize')}</span>
          </button>
        </div>

        {/* Page Title Row */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300">{t('legacyUi.metadata.pageTitle')}</span>
            <div className="flex items-center space-x-2">
              <span className={`font-mono text-[11px] ${isTitleOptimal ? 'text-emerald-400' : 'text-amber-400'}`}>
                {titleLength} / 60 {t('metadata.characters')}
              </span>
              <button
                onClick={() => copyToClipboard(meta_tags.title || '', 'title')}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition"
                title={t('legacyUi.metadata.copyTitle')}
              >
                {copiedKey === 'title' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white break-words font-sans">
            {meta_tags.title || <span className="text-rose-400 italic">{t('legacyUi.metadata.missingTitle')}</span>}
          </div>
          {/* Progress bar */}
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                isTitleOptimal ? 'bg-emerald-500' : titleLength > 65 ? 'bg-amber-500' : 'bg-rose-500'
              }`}
              style={{ width: `${Math.min(100, (titleLength / 60) * 100)}%` }}
            />
          </div>
        </div>

        {/* Meta Description Row */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300">{t('legacyUi.metadata.description')}</span>
            <div className="flex items-center space-x-2">
              <span className={`font-mono text-[11px] ${isDescOptimal ? 'text-emerald-400' : 'text-amber-400'}`}>
                {descLength} / 160 {t('metadata.characters')}
              </span>
              <button
                onClick={() => copyToClipboard(meta_tags.description || '', 'desc')}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition"
                title={t('legacyUi.metadata.copyDescription')}
              >
                {copiedKey === 'desc' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-slate-300 leading-relaxed break-words font-sans">
            {meta_tags.description || <span className="text-rose-400 italic">{t('legacyUi.metadata.missingDescription')}</span>}
          </div>
          {/* Progress bar */}
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                isDescOptimal ? 'bg-emerald-500' : descLength > 165 ? 'bg-amber-500' : 'bg-rose-500'
              }`}
              style={{ width: `${Math.min(100, (descLength / 160) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Technical Directives Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider">{t('legacyUi.metadata.technicalDirectives')}</h4>
        </div>

        <div className="divide-y divide-slate-800/80 text-xs">
          {/* Canonical */}
          <div className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 hover:bg-slate-800/30 transition">
            <span className="font-semibold text-slate-400 sm:w-40 shrink-0">{t('legacyUi.metadata.canonical')}</span>
            <span className="font-mono text-slate-200 break-all flex-1">
              {meta_tags.canonical || <span className="text-amber-400">{t('legacyUi.metadata.notSpecified')}</span>}
            </span>
            {audit.indexability?.canonical_target_checked && <span className={audit.indexability.canonical_target_status && audit.indexability.canonical_target_status < 400 ? 'text-[11px] font-semibold text-emerald-300' : 'text-[11px] font-semibold text-rose-300'}>{t('exportUi.statuses.http', { status: audit.indexability.canonical_target_status })}</span>}
            {audit.indexability?.canonical_target_check_error && <span className="text-[11px] text-amber-300" title={audit.indexability.canonical_target_check_error}>{t('legacyUi.metadata.canonicalUnverified')}</span>}
            {meta_tags.canonical && (
              <button
                onClick={() => copyToClipboard(meta_tags.canonical || '', 'canonical')}
                className="text-slate-400 hover:text-white p-1"
              >
                {copiedKey === 'canonical' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>

          {/* Robots */}
          <div className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 hover:bg-slate-800/30 transition">
            <span className="font-semibold text-slate-400 sm:w-40 shrink-0">{t('legacyUi.metadata.robots')}</span>
            <span className="font-mono text-slate-200 flex-1">
              {meta_tags.robots || t('legacyUi.metadata.robotsDefault')}
            </span>
          </div>

          {/* Viewport */}
          <div className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 hover:bg-slate-800/30 transition">
            <span className="font-semibold text-slate-400 sm:w-40 shrink-0">{t('legacyUi.metadata.viewport')}</span>
            <span className="font-mono text-slate-200 flex-1">
              {meta_tags.viewport || <span className="text-rose-400">{t('legacyUi.metadata.missingViewport')}</span>}
            </span>
          </div>

          {/* Charset */}
          <div className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 hover:bg-slate-800/30 transition">
            <span className="font-semibold text-slate-400 sm:w-40 shrink-0">{t('legacyUi.metadata.charset')}</span>
            <span className="font-mono text-slate-200 flex-1">
              {meta_tags.charset || t('legacyUi.metadata.utf8')}
            </span>
          </div>

          {/* Keywords */}
          {meta_tags.keywords && (
            <div className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 hover:bg-slate-800/30 transition">
              <span className="font-semibold text-slate-400 sm:w-40 shrink-0">{t('legacyUi.metadata.keywords')}</span>
              <span className="text-slate-200 flex-1">{meta_tags.keywords}</span>
            </div>
          )}

          {/* Theme Color */}
          {meta_tags.theme_color && (
            <div className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 hover:bg-slate-800/30 transition">
              <span className="font-semibold text-slate-400 sm:w-40 shrink-0">{t('legacyUi.metadata.themeColor')}</span>
              <div className="flex items-center space-x-2 flex-1">
                <span
                  className="w-4 h-4 rounded-full border border-slate-700"
                  style={{ backgroundColor: meta_tags.theme_color }}
                />
                <span className="font-mono text-slate-200">{meta_tags.theme_color}</span>
              </div>
            </div>
          )}

          {/* Generator */}
          {meta_tags.generator && (
            <div className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 hover:bg-slate-800/30 transition">
              <span className="font-semibold text-slate-400 sm:w-40 shrink-0">{t('legacyUi.metadata.generator')}</span>
              <span className="text-slate-200 flex-1">{meta_tags.generator}</span>
            </div>
          )}

          {/* Author */}
          {meta_tags.author && (
            <div className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 hover:bg-slate-800/30 transition">
              <span className="font-semibold text-slate-400 sm:w-40 shrink-0">{t('legacyUi.metadata.author')}</span>
              <span className="text-slate-200 flex-1">{meta_tags.author}</span>
            </div>
          )}
        </div>
      </div>

      {audit.technical.technology_signals && audit.technical.technology_signals.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">{t('legacyUi.metadata.technologies')}</h4>
            <span className="text-[11px] text-slate-500">{t('legacyUi.metadata.documentHttpSignals')}</span>
          </div>
          <div className="divide-y divide-slate-800/80 text-xs">
            {audit.technical.technology_signals.map((signal) => (
              <div key={`${signal.category}-${signal.name}`} className="flex flex-col gap-1.5 p-3.5 hover:bg-slate-800/30 sm:flex-row sm:items-center sm:gap-4">
                <span className="font-medium text-slate-100 sm:w-44">{signal.name}{signal.version ? <span className="ml-1 font-mono text-[10px] text-sky-200">{signal.version}</span> : null}</span>
                <span className="text-slate-400 sm:w-36">{technologyCategory(signal.category)}</span>
                <span className="min-w-0 flex-1 break-words text-slate-400">{signal.evidence}</span>
                <span className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold ${signal.confidence === 'confirmed' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-300'}`}>{signal.confidence === 'confirmed' ? t('legacyUi.metadata.confirmed') : t('legacyUi.metadata.heuristic')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {audit.accessibility && (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="flex flex-col gap-1 border-b border-slate-800 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">{t('accessibility.title')}</h4>
            <span className="text-[11px] text-slate-500">{t('accessibility.staticChecks')}</span>
          </div>
          <div className="grid gap-px bg-slate-800 sm:grid-cols-2">
            <div className="bg-slate-900/60 p-4"><p className="text-[11px] text-slate-500">{t('accessibility.documentLanguage')}</p><p className={audit.accessibility.document_language ? 'mt-1 font-mono text-sm text-emerald-300' : 'mt-1 text-sm text-amber-300'}>{audit.accessibility.document_language || t('accessibility.missingLang')}</p></div>
            <div className="bg-slate-900/60 p-4"><p className="text-[11px] text-slate-500">{t('accessibility.unlabeledControls')}</p><p className={audit.accessibility.unlabeled_form_control_count ? 'mt-1 text-sm font-semibold text-amber-300' : 'mt-1 text-sm font-semibold text-emerald-300'}>{audit.accessibility.unlabeled_form_control_count} / {audit.accessibility.form_control_count}</p></div>
            <div className="bg-slate-900/60 p-4"><p className="text-[11px] text-slate-500">{t('accessibility.landmarks')}</p><p className="mt-1 text-xs text-slate-300">{audit.accessibility.landmarks.map((landmark) => `${landmark.name} (${landmark.count})`).join(', ') || t('accessibility.noLandmarks')}</p></div>
            <div className="bg-slate-900/60 p-4"><p className="text-[11px] text-slate-500">{t('accessibility.ariaAttributes')}</p><p className="mt-1 text-sm font-semibold text-slate-200">{audit.accessibility.aria_attribute_count}</p></div>
          </div>
          {(audit.accessibility.findings?.length ?? 0) > 0 && (
            <div className="border-t border-slate-800">
              <div className="flex items-center justify-between px-4 py-3">
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-300">{t('accessibility.findingsTitle')}</h5>
                <span className="text-[10px] text-slate-500">{t('accessibility.findingsMeta', { count: audit.accessibility.findings?.length })}</span>
              </div>
              <div className="divide-y divide-slate-800/80">
                {audit.accessibility.findings?.map((finding) => {
                  const isFormFinding = finding.code === 'accessibility-form-controls-unlabeled' || finding.code === 'accessibility-antispam-control-not-text';
                  const isInteractiveFinding = finding.code === 'accessibility-interactive-name-missing';
                  const isAriaHiddenFocusableFinding = finding.code === 'accessibility-focusable-aria-hidden';
                  const isImageFinding = finding.code === 'accessibility-image-alt-missing';
                  const isDuplicateIdFinding = finding.code === 'accessibility-duplicate-id';
                  const isAriaReferenceFinding = finding.code === 'accessibility-aria-reference-unresolved';
                  const isLanguageFinding = finding.code === 'accessibility-document-language-invalid';
                  const isMainLandmarkFinding = finding.code === 'accessibility-multiple-main-landmarks';
                  const evidenceSelector = isAriaHiddenFocusableFinding
                    ? "a[href], button, input:not([type='hidden']), select, textarea, [tabindex]:not([tabindex='-1']), [contenteditable='true'], [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='switch'], [role='tab'], [role='menuitem']"
                    : isInteractiveFinding
                    ? "a[href], button, input[type='button'], input[type='submit'], input[type='reset'], [role='button']"
                    : isImageFinding
                      ? 'img:not([alt])'
                      : isDuplicateIdFinding
                        ? '[id]'
                        : isAriaReferenceFinding
                          ? '[aria-labelledby], [aria-describedby], [aria-controls], [aria-owns], [aria-flowto], [aria-details], [aria-errormessage]'
                          : isLanguageFinding
                            ? 'html'
                            : isMainLandmarkFinding
                              ? "main, [role='main']"
                              : 'input, select, textarea';
                  const evidenceLabel = isAriaHiddenFocusableFinding
                    ? t('accessibility.focusableAriaHidden')
                    : isInteractiveFinding
                    ? t('accessibility.interactiveElement')
                    : isImageFinding
                      ? t('accessibility.image')
                      : isDuplicateIdFinding
                        ? t('accessibility.duplicateId')
                        : isAriaReferenceFinding
                          ? t('accessibility.ariaReference')
                          : isLanguageFinding
                            ? t('accessibility.htmlLanguageElement')
                            : isMainLandmarkFinding
                              ? t('accessibility.mainLandmark')
                              : t('accessibility.formControl');
                  const evidencePositionLabel = isFormFinding ? t('accessibility.control') : evidenceLabel;
                  const evidencePositionOrder = isFormFinding ? t('accessibility.domOrder') : t('accessibility.selectorOrder');
                  return (
                  <div key={finding.code} className="space-y-1.5 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${finding.severity === 'error' ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : finding.severity === 'warning' ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-sky-500/30 bg-sky-500/10 text-sky-300'}`}>{t(`ampUi.severity.${finding.severity}`)}</span>
                      <span className="text-xs font-medium text-slate-100">{accessibilityFindingMessage(finding)}</span>
                    </div>
                    <p className="break-words text-[11px] text-slate-400">{t('accessibility.evidence', { value: accessibilityFindingEvidence(finding) })}</p>
                    <p className="text-[11px] text-slate-500">{accessibilityFindingRecommendation(finding)}</p>
                    {(finding.elements?.length ?? 0) > 0 && (
                      <details open className="rounded-md border border-slate-700/70 bg-slate-950/50 px-3 py-2">
                        <summary className="cursor-pointer text-[11px] font-medium text-emerald-200">{t('accessibility.elementCount', { count: finding.elements?.length })}</summary>
                        <p className="mt-1 text-[10px] text-slate-500">{t('accessibility.locatorDescription')}</p>
                        {finding.code === 'accessibility-form-controls-unlabeled' && finding.elements!.length < (audit.accessibility?.unlabeled_form_control_count ?? 0) && <p className="mt-1 text-[10px] text-amber-300">{t('accessibility.shownCount', { shown: finding.elements!.length, total: audit.accessibility?.unlabeled_form_control_count ?? 0 })}</p>}
                        {finding.elements!.length === 50 && <p className="mt-1 text-[10px] text-amber-300">{t('accessibility.shownMax')}</p>}
                        <div className="mt-2 space-y-2">
                          {finding.elements?.map((element) => (
                            <div key={`${element.dom_position}-${element.dom_query}`} className="rounded border border-slate-800 bg-slate-900/70 p-2">
                              <p className="text-[10px] text-slate-400">{t('accessibility.elementPosition', { label: evidencePositionLabel, position: element.dom_position, order: evidencePositionOrder, source: element.line ? t('accessibility.source', { line: element.line, column: element.column ?? 1 }) : t('accessibility.sourceUnavailable') })}</p>
                              <code className="mt-1 block break-all text-[10px] text-emerald-200">{element.dom_query}</code>
                              <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-slate-300">{element.html_snippet}</pre>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(`${element.dom_query}\n${element.html_snippet}`, `a11y-${finding.code}-${element.dom_position}`)}
                                aria-label={`${t('accessibility.copyEvidence')} ${evidenceLabel} #${element.dom_position}`}
                                className="mt-1 inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-400 transition hover:border-emerald-400/50 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                              >
                                {copiedKey === `a11y-${finding.code}-${element.dom_position}` ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                                {copiedKey === `a11y-${finding.code}-${element.dom_position}` ? t('accessibility.copiedEvidence') : t('accessibility.copyEvidence')}
                              </button>
                              <ShowOnPageButton
                                url={audit.final_url || audit.url}
                                selector={evidenceSelector}
                                domIndex={element.dom_position - 1}
                                label={`${evidenceLabel} #${element.dom_position}`}
                              />
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}
          {(audit.accessibility.hidden_form_control_count ?? 0) > 0 && (
            <section className="border-t border-slate-800 px-4 py-3">
              <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-300">{t('accessibility.hiddenTitle', { count: audit.accessibility?.hidden_form_control_count ?? 0 })}</h5>
              <p className="mt-1 text-[10px] text-slate-500">{t('accessibility.hiddenDescription')}</p>
              <div className="mt-2 space-y-2">
                {(audit.accessibility.hidden_form_controls ?? []).map((element) => (
                  <div key={`${element.dom_position}-${element.dom_query}`} className="rounded border border-slate-800 bg-slate-950/50 p-2">
                    <p className="text-[10px] text-slate-400">{t('accessibility.hiddenControlPosition', { position: element.dom_position })}{element.line ? t('accessibility.source', { line: element.line, column: element.column ?? 1 }) : t('accessibility.sourceUnavailable')}</p>
                    <code className="mt-1 block break-all text-[10px] text-emerald-200">{element.dom_query}</code>
                    <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-slate-300">{element.html_snippet}</pre>
                    <ShowOnPageButton
                      url={audit.final_url || audit.url}
                      selector="input, select, textarea"
                      domIndex={element.dom_position - 1}
                      label={`${t('accessibility.hiddenControl')} #${element.dom_position}`}
                    />
                  </div>
                ))}
                {(audit.accessibility.hidden_form_controls?.length ?? 0) < (audit.accessibility?.hidden_form_control_count ?? 0) && <p className="text-[10px] text-amber-300">{t('accessibility.limitFirst', { shown: audit.accessibility.hidden_form_controls?.length ?? 0 })}</p>}
              </div>
            </section>
          )}
          {(audit.accessibility.anti_spam_text_control_count ?? 0) > 0 && (
            <section className="border-t border-slate-800 px-4 py-3">
              <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-300">{t('accessibility.antispamTitle', { count: audit.accessibility.anti_spam_text_control_count })}</h5>
              <p className="mt-1 text-[10px] text-slate-500">{t('accessibility.antispamDescription')}</p>
              <div className="mt-2 space-y-2">
                {(audit.accessibility.anti_spam_text_controls ?? []).map((element) => (
                  <div key={`${element.dom_position}-${element.dom_query}`} className="rounded border border-slate-800 bg-slate-950/50 p-2">
                    <p className="text-[10px] text-slate-400">{t('accessibility.textFieldPosition', { position: element.dom_position })}</p>
                    <code className="mt-1 block break-all text-[10px] text-emerald-200">{element.dom_query}</code>
                    <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-slate-300">{element.html_snippet}</pre>
                    <ShowOnPageButton
                      url={audit.final_url || audit.url}
                      selector="input, select, textarea"
                      domIndex={element.dom_position - 1}
                      label={t('accessibility.antispamLabel', { position: element.dom_position })}
                    />
                  </div>
                ))}
                {(audit.accessibility.anti_spam_text_controls?.length ?? 0) < (audit.accessibility?.anti_spam_text_control_count ?? 0) && <p className="text-[10px] text-amber-300">{t('accessibility.limitFirst', { shown: audit.accessibility.anti_spam_text_controls?.length ?? 0 })}</p>}
              </div>
            </section>
          )}
          <div className="border-t border-amber-500/15 bg-amber-500/5 px-4 py-3 text-[11px] leading-5 text-amber-200">{accessibilityManualReview(audit.accessibility.manual_review_items)}</div>
        </div>
      )}

      {audit.technical.favicons && audit.technical.favicons.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5"><h4 className="text-xs font-bold uppercase tracking-wider text-white">{t('legacyUi.metadata.favicons')}</h4><span className="text-[11px] text-slate-500">{t('legacyUi.metadata.faviconVariants', { count: audit.technical.favicons.length })}</span></div>
          <div className="divide-y divide-slate-800/80 text-xs">{audit.technical.favicons.map((favicon) => <div key={`${favicon.rel}-${favicon.href}`} className="grid gap-1.5 p-3.5 sm:grid-cols-[minmax(0,1fr)_8rem_7rem_7rem]"><span className="break-all font-mono text-slate-300">{favicon.href}</span><span className="text-slate-400">{favicon.rel}</span><span className="text-slate-400">{favicon.declared_type || favicon.inferred_format || t('legacyUi.metadata.unknownType')}</span><span className="text-slate-400">{favicon.declared_sizes || t('legacyUi.metadata.unknownSize')}</span></div>)}</div>
        </div>
      )}

      {/* Hreflang Tags */}
      {audit.technical.hreflang_tags && audit.technical.hreflang_tags.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              {t('legacyUi.metadata.hreflang', { count: audit.technical.hreflang_tags.length })}
            </h4>
          </div>
          <div className="divide-y divide-slate-800/80 text-xs">
            {audit.technical.hreflang_tags.map((tag, idx) => (
              <div key={idx} className="p-3.5 flex items-center justify-between gap-4 hover:bg-slate-800/30 transition">
                <span className="font-mono font-semibold text-emerald-400 w-24 shrink-0">{tag.hreflang}</span>
                <span className="font-mono text-slate-300 break-all flex-1">{tag.href}</span>
                <button
                  onClick={() => copyToClipboard(tag.href, `href-${idx}`)}
                  className="text-slate-400 hover:text-white p-1"
                  title={t('legacyUi.metadata.copyLink')}
                >
                  {copiedKey === `href-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw / Other Meta Tags */}
      {meta_tags.other_tags && meta_tags.other_tags.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              {t('legacyUi.metadata.otherTags', { count: meta_tags.other_tags.length })}
            </h4>
          </div>
          <div className="divide-y divide-slate-800/80 text-xs">
            {meta_tags.other_tags.map((tag, idx) => {
              const tagIdentifier = tag.name ? `name="${tag.name}"` : tag.property ? `property="${tag.property}"` : 'tag';
              return (
                <div key={idx} className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 hover:bg-slate-800/30 transition">
                  <span className="font-mono font-semibold text-amber-400/90 sm:w-56 shrink-0">{tagIdentifier}</span>
                  <span className="font-mono text-slate-300 break-all flex-1">{tag.content}</span>
                  <button
                    onClick={() => copyToClipboard(tag.content, `other-${idx}`)}
                    className="text-slate-400 hover:text-white p-1 shrink-0"
                    title={t('legacyUi.metadata.copyContent')}
                  >
                    {copiedKey === `other-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
