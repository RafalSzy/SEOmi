import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Activity,
  ArrowUpRight,
  Sparkles,
  Database,
  Download,
  Copy,
  Search,
} from "lucide-react";
import type { IssueCategory, PageAuditData } from "@/types";
import { useUIStore } from "@/stores/uiStore";
import { useAuditStore } from "@/stores/auditStore";
import {
  downloadAuditCsv,
  downloadAuditJson,
  downloadAuditPdf,
} from "@/services/export";
import { buildLocalAuditChecks } from "@/services/auditChecks";
import { copyText } from "@/services/clipboard";
import { localizeAuditIssue } from "@/services/auditIssueLocalization";
import { ShowOnPageButton } from "@/components/Results/ShowOnPageButton";

interface OverviewProps {
  audit: PageAuditData;
}

const issueCategoryTranslationKeys: Record<IssueCategory, string> = {
  MetaTags: "metaIIndeksacja",
  OpenGraph: "openGraph",
  TwitterCard: "twitterCard",
  Headings: "nagOwki",
  Images: "obrazy",
  Links: "linki",
  Security: "bezpieczenstwo",
  Performance: "performance",
  Technical: "techniczne",
  StructuredData: "daneStrukturalne",
};

const accessibilitySelectorForCode = (code?: string): string => {
  switch (code) {
    case "accessibility-interactive-name-missing":
      return "a[href], button, input[type='button'], input[type='submit'], input[type='reset'], [role='button']";
    case "accessibility-focusable-aria-hidden":
      return "a[href], button, input:not([type='hidden']), select, textarea, [tabindex]:not([tabindex='-1']), [contenteditable='true'], [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='switch'], [role='tab'], [role='menuitem']";
    case "accessibility-image-alt-missing":
      return "img:not([alt])";
    case "accessibility-duplicate-id":
      return "[id]";
    case "accessibility-aria-reference-unresolved":
      return "[aria-labelledby], [aria-describedby], [aria-controls], [aria-owns], [aria-flowto], [aria-details], [aria-errormessage]";
    case "accessibility-document-language-invalid":
      return "html";
    case "accessibility-multiple-main-landmarks":
      return "main, [role='main']";
    case "accessibility-form-controls-unlabeled":
    case "accessibility-antispam-control-not-text":
      return "input, select, textarea";
    default:
      return "input, select, textarea";
  }
};

const accessibilityEvidenceLabelKey = (code?: string): string => {
  switch (code) {
    case "accessibility-interactive-name-missing":
      return "accessibility.interactiveElement";
    case "accessibility-focusable-aria-hidden":
      return "accessibility.focusableAriaHidden";
    case "accessibility-image-alt-missing":
      return "accessibility.image";
    case "accessibility-duplicate-id":
      return "accessibility.duplicateId";
    case "accessibility-aria-reference-unresolved":
      return "accessibility.ariaReference";
    case "accessibility-document-language-invalid":
      return "accessibility.htmlLanguageElement";
    case "accessibility-multiple-main-landmarks":
      return "accessibility.mainLandmark";
    case "accessibility-form-controls-unlabeled":
    case "accessibility-antispam-control-not-text":
      return "accessibility.formControl";
    default:
      return "accessibility.formControl";
  }
};

export const Overview: React.FC<OverviewProps> = ({ audit }) => {
  const { t } = useTranslation();
  const openModal = useUIStore((s) => s.openModal);
  const dataforseoData = useAuditStore((s) => s.dataforseoData);
  const dataforseoError = useAuditStore((s) => s.dataforseoError);
  const setActiveTab = useAuditStore((s) => s.setActiveTab);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [localCheckQuery, setLocalCheckQuery] = useState("");
  const [localCheckStatus, setLocalCheckStatus] = useState<
    "all" | "pass" | "warning" | "error" | "not_applicable"
  >("all");
  const [localCheckCategory, setLocalCheckCategory] = useState("all");
  const [localCheckPage, setLocalCheckPage] = useState(0);
  const [coverageCopyState, setCoverageCopyState] = useState<
    "idle" | "copied" | "failed"
  >("idle");

  const exportPdf = async () => {
    setPdfError(null);
    try {
      await downloadAuditPdf(audit);
    } catch (error) {
      setPdfError(
        error instanceof Error
          ? error.message
          : t("legacyUi.overview.pdfError"),
      );
    }
  };

  const criticalIssues = audit.issues.filter((i) => i.severity === "Critical");
  const warnings = audit.issues.filter((i) => i.severity === "Warning");
  const infoIssues = audit.issues.filter((i) => i.severity === "Info");
  const localChecks = buildLocalAuditChecks(audit);
  const showOnlyProblems = useAuditStore((s) => s.showOnlyProblems);
  const checksByStatus = {
    pass: localChecks.filter((item) => item.status === "pass"),
    warning: localChecks.filter((item) => item.status === "warning"),
    error: localChecks.filter((item) => item.status === "error"),
  };
  const localCheckCategories = useMemo(
    () => Array.from(new Set(localChecks.map((item) => item.category))),
    [localChecks],
  );
  const filteredLocalChecks = useMemo(() => {
    const needle = localCheckQuery.trim().toLocaleLowerCase();
    return localChecks.filter((item) => {
      if (
        showOnlyProblems &&
        item.status !== "warning" &&
        item.status !== "error"
      )
        return false;
      if (localCheckStatus !== "all" && item.status !== localCheckStatus)
        return false;
      if (localCheckCategory !== "all" && item.category !== localCheckCategory)
        return false;
      if (!needle) return true;
      return `${item.label} ${item.category} ${item.evidence}`
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [
    localCheckCategory,
    localCheckQuery,
    localCheckStatus,
    localChecks,
    showOnlyProblems,
  ]);
  const localCheckPageSize = 24;
  const localCheckPageCount = Math.max(
    1,
    Math.ceil(filteredLocalChecks.length / localCheckPageSize),
  );
  const safeLocalCheckPage = Math.min(localCheckPage, localCheckPageCount - 1);
  const visibleCoverageChecks = filteredLocalChecks.slice(
    safeLocalCheckPage * localCheckPageSize,
    (safeLocalCheckPage + 1) * localCheckPageSize,
  );
  const copyCoverage = async () => {
    const text = filteredLocalChecks
      .map(
        (item) =>
          `[${item.status}] ${item.category} · ${item.label}\n${item.evidence}`,
      )
      .join("\n\n");
    const copied = await copyText(text);
    setCoverageCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setCoverageCopyState("idle"), 1800);
  };
  const complexityLabels: Record<
    NonNullable<typeof audit.content_stats.complexity_label>,
    string
  > = {
    simple: t("overview.complexitySimple"),
    moderate: t("overview.complexityModerate"),
    complex: t("overview.complexityComplex"),
    unavailable: t("overview.complexityUnavailable"),
  };
  const complexityLabel = audit.content_stats.complexity_label || "unavailable";

  // Gauge color based on health score
  const getScoreColor = (score: number) => {
    if (score >= 85) return "text-emerald-400 stroke-emerald-500";
    if (score >= 65) return "text-amber-400 stroke-amber-500";
    return "text-rose-400 stroke-rose-500";
  };

  const getScoreBg = (score: number) => {
    if (score >= 85) return "bg-emerald-500/10 border-emerald-500/20";
    if (score >= 65) return "bg-amber-500/10 border-amber-500/20";
    return "bg-rose-500/10 border-rose-500/20";
  };

  // SVG Radial circle calculation
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (audit.health_score / 100) * circumference;

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 md:p-6 animate-in fade-in duration-200">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-2.5">
        <span className="text-xs text-slate-400">
          {t("legacyUi.overview.exportDescription")}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => downloadAuditJson(audit)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:text-white"
          >
            <Download className="h-3.5 w-3.5" /> {t("overview.exportJson")}
          </button>
          <button
            onClick={() => downloadAuditCsv(audit)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            <Download className="h-3.5 w-3.5" /> {t("overview.exportCsv")}
          </button>
          <button
            onClick={() => void exportPdf()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/20"
          >
            <Download className="h-3.5 w-3.5" /> {t("overview.exportPdf")}
          </button>
        </div>
      </div>
      {pdfError && (
        <p className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {pdfError}
        </p>
      )}
      {/* Top Banner: Score Gauge & Key Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Main Health Score Card */}
        <div
          className={`p-5 rounded-2xl border flex items-center space-x-5 ${getScoreBg(audit.health_score)}`}
        >
          <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
            <svg
              className="w-24 h-24 transform -rotate-90"
              viewBox="0 0 100 100"
            >
              <circle
                cx="50"
                cy="50"
                r={radius}
                className="stroke-slate-800"
                strokeWidth="8"
                fill="transparent"
              />
              <circle
                cx="50"
                cy="50"
                r={radius}
                className={`transition-all duration-1000 ease-out ${getScoreColor(audit.health_score)}`}
                strokeWidth="8"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span
                className={`text-2xl font-black ${getScoreColor(audit.health_score).split(" ")[0]}`}
              >
                {audit.health_score}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">
                / 100
              </span>
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {t("overview.healthScore")}
            </span>
            <h3 className="text-lg font-bold text-white mt-0.5">
              {audit.health_score >= 85
                ? t("legacyUi.overview.excellent")
                : audit.health_score >= 65
                  ? t("legacyUi.overview.attention")
                  : t("legacyUi.overview.poor")}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {audit.issues.length === 0
                ? t("legacyUi.overview.noIssuesRule")
                : t("legacyUi.overview.criticalFound", {
                    count: criticalIssues.length,
                  })}
            </p>
          </div>
        </div>

        {/* Issues Summary Card */}
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            {t("legacyUi.overview.issuesAudit")}
          </span>
          <div className="grid grid-cols-3 gap-2 my-2">
            <div className="text-center p-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <div className="text-lg font-bold text-rose-400">
                {criticalIssues.length}
              </div>
              <div className="text-[10px] text-slate-400 uppercase font-medium">
                {t("legacyUi.overview.critical")}
              </div>
            </div>
            <div className="text-center p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="text-lg font-bold text-amber-400">
                {warnings.length}
              </div>
              <div className="text-[10px] text-slate-400 uppercase font-medium">
                {t("legacyUi.overview.warnings")}
              </div>
            </div>
            <div className="text-center p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="text-lg font-bold text-blue-400">
                {infoIssues.length}
              </div>
              <div className="text-[10px] text-slate-400 uppercase font-medium">
                {t("legacyUi.overview.info")}
              </div>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center space-x-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              {audit.issues.length === 0
                ? t("legacyUi.overview.noReportedIssues")
                : t("legacyUi.overview.totalReported", {
                    count: audit.issues.length,
                  })}
            </span>
          </div>
        </div>

        {/* Server & HTTP Speed Card */}
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            {t("overview.responseTime")}
          </span>
          <div className="my-2">
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-bold text-white font-mono">
                {audit.response_time_ms}
              </span>
              <span className="text-xs text-slate-400">
                {t("legacyUi.overview.milliseconds")}
              </span>
            </div>
            <div className="flex items-center space-x-2 mt-1">
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${
                  audit.http_status === 200
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }`}
              >
                {t("exportUi.statuses.http", { status: audit.http_status })}
              </span>
              <span className="text-xs text-slate-400">
                {audit.redirect_chain.length === 0
                  ? t("legacyUi.overview.directResponse")
                  : t("legacyUi.overview.redirectHops", {
                      count: audit.redirect_chain.length,
                    })}
              </span>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center space-x-1 truncate">
            <Activity className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="truncate">
              {audit.technical.server ||
                t("legacyUi.overview.serverHeaderMissing")}
            </span>
          </div>
        </div>

        {/* Content & Readability Card */}
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {t("overview.wordCount")}
            </span>
            <button
              onClick={() => openModal("ai")}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center space-x-1"
            >
              <Sparkles className="w-3 h-3" />
              <span>{t("legacyUi.overview.aiFix")}</span>
            </button>
          </div>
          <div className="my-2">
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-bold text-white font-mono">
                {audit.content_stats.word_count}
              </span>
              <span className="text-xs text-slate-400">
                {t("legacyUi.overview.words")}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 flex items-center space-x-1">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>
                {t("legacyUi.overview.readingTime", {
                  count: audit.content_stats.reading_time_minutes,
                })}
              </span>
            </p>
          </div>
          <div className="text-[11px] text-slate-400">
            {t("legacyUi.overview.textRatio")}{" "}
            <span className="text-white font-medium">
              {audit.content_stats.text_ratio_percent.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
        <header className="flex flex-col gap-1 border-b border-slate-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">
              {t("legacyUi.overview.contentAnalysisTitle")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              {t("legacyUi.overview.contentAnalysisDescription")}
            </p>
          </div>
          <span
            className={`w-fit rounded-full border px-2 py-1 text-[11px] font-semibold ${complexityLabel === "complex" ? "border-rose-500/25 bg-rose-500/10 text-rose-300" : complexityLabel === "moderate" ? "border-amber-500/25 bg-amber-500/10 text-amber-300" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"}`}
          >
            {complexityLabels[complexityLabel]}
          </span>
        </header>
        {audit.content_stats.word_count === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400">
            {t("legacyUi.overview.noVisibleText")}
          </p>
        ) : (
          <div className="grid gap-px bg-slate-800 lg:grid-cols-[.8fr_1.2fr]">
            <div className="grid grid-cols-2 gap-px bg-slate-800 sm:grid-cols-5 lg:grid-cols-2">
              <div className="bg-slate-900/60 p-4">
                <p className="text-[11px] text-slate-500">
                  {t("legacyUi.overview.sentences")}
                </p>
                <p className="mt-1 font-mono text-lg font-semibold text-slate-100">
                  {audit.content_stats.sentence_count ?? "—"}
                </p>
              </div>
              <div className="bg-slate-900/60 p-4">
                <p className="text-[11px] text-slate-500">
                  {t("legacyUi.overview.wordsPerSentence")}
                </p>
                <p className="mt-1 font-mono text-lg font-semibold text-slate-100">
                  {audit.content_stats.average_words_per_sentence?.toFixed(1) ??
                    "—"}
                </p>
              </div>
              <div className="bg-slate-900/60 p-4">
                <p className="text-[11px] text-slate-500">
                  {t("legacyUi.overview.charactersPerWord")}
                </p>
                <p className="mt-1 font-mono text-lg font-semibold text-slate-100">
                  {audit.content_stats.average_characters_per_word?.toFixed(
                    1,
                  ) ?? "—"}
                </p>
              </div>
              <div className="bg-slate-900/60 p-4">
                <p className="text-[11px] text-slate-500">
                  {t("legacyUi.overview.complexityIndex")}
                </p>
                <p className="mt-1 font-mono text-lg font-semibold text-slate-100">
                  {audit.content_stats.complexity_score ?? "—"}
                  <span className="ml-1 text-xs text-slate-500">/100</span>
                </p>
              </div>
              <div className="bg-slate-900/60 p-4">
                <p className="text-[11px] text-slate-500">
                  {t("legacyUi.overview.readability")}
                </p>
                <p className="mt-1 font-mono text-lg font-semibold text-slate-100">
                  {audit.content_stats.readability_ease_score
                    ? audit.content_stats.readability_ease_score.toFixed(0)
                    : "—"}
                  <span className="ml-1 text-xs text-slate-500">/100</span>
                </p>
                <p className="mt-1 text-[10px] text-slate-500">
                  {t("legacyUi.overview.grade")}{" "}
                  {audit.content_stats.readability_grade?.toFixed(1) ?? "—"} ·{" "}
                  {audit.content_stats.readability_label ||
                    t("legacyUi.overview.noData")}
                  {audit.content_stats.readability_method ? (
                    <>
                      {" · "}
                      {t("legacyUi.overview.formula")}:{" "}
                      {audit.content_stats.readability_method}
                    </>
                  ) : null}
                </p>
              </div>
            </div>
            <div className="bg-slate-900/60 p-4">
              <p className="text-[11px] font-medium text-slate-400">
                {t("legacyUi.overview.topTerms")}
              </p>
              {audit.content_stats.top_keywords.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {audit.content_stats.top_keywords.map((term) => (
                    <span
                      key={term.keyword}
                      className="rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-xs text-slate-200"
                    >
                      <span className="font-medium">{term.keyword}</span>
                      <span className="ml-1.5 font-mono text-slate-500">
                        {term.count}
                        {term.density_percent !== undefined
                          ? ` · ${term.density_percent.toFixed(2)}%`
                          : ""}
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  {t("legacyUi.overview.noTerms")}
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">
              {t("legacyUi.overview.coverageTitle", {
                count: localChecks.length,
              })}
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              {t("legacyUi.overview.coverageDescription")}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs font-medium">
            <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-300">
              {checksByStatus.pass.length} {t("legacyUi.overview.passed")}
            </span>
            <span className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-300">
              {checksByStatus.warning.length}{" "}
              {t("legacyUi.overview.warningCount")}
            </span>
            <span className="rounded-md bg-rose-500/10 px-2 py-1 text-rose-300">
              {checksByStatus.error.length} {t("legacyUi.overview.errorCount")}
            </span>
            <button
              type="button"
              onClick={() => void copyCoverage()}
              disabled={filteredLocalChecks.length === 0}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t("legacyUi.overview.copyChecks")}
            >
              <Copy className="h-3 w-3" aria-hidden="true" />
              {coverageCopyState === "copied"
                ? t("legacyUi.overview.copied")
                : coverageCopyState === "failed"
                  ? t("legacyUi.overview.copyFailed")
                  : t("legacyUi.overview.copy")}
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3 md:grid-cols-[1.3fr_.8fr_.9fr_auto]">
          <label className="relative block">
            <span className="sr-only">
              {t("legacyUi.overview.searchChecks")}
            </span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
              aria-hidden="true"
            />
            <input
              value={localCheckQuery}
              onChange={(event) => {
                setLocalCheckQuery(event.target.value.slice(0, 120));
                setLocalCheckPage(0);
              }}
              placeholder={t("legacyUi.overview.searchPlaceholder")}
              className="h-8 w-full rounded-lg border border-slate-800 bg-slate-900 pl-8 pr-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-emerald-500/60"
            />
          </label>
          <label className="flex items-center">
            <span className="sr-only">
              {t("legacyUi.overview.checkStatus")}
            </span>
            <select
              value={localCheckStatus}
              onChange={(event) => {
                setLocalCheckStatus(
                  event.target.value as typeof localCheckStatus,
                );
                setLocalCheckPage(0);
              }}
              className="h-8 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 text-xs text-slate-300 outline-none focus:border-emerald-500/60"
            >
              <option value="all">{t("legacyUi.overview.allStatuses")}</option>
              <option value="pass">{t("legacyUi.overview.pass")}</option>
              <option value="warning">{t("legacyUi.overview.warning")}</option>
              <option value="error">{t("legacyUi.overview.error")}</option>
              <option value="not_applicable">
                {t("legacyUi.overview.notApplicable")}
              </option>
            </select>
          </label>
          <label className="flex items-center">
            <span className="sr-only">
              {t("legacyUi.overview.checkCategory")}
            </span>
            <select
              value={localCheckCategory}
              onChange={(event) => {
                setLocalCheckCategory(event.target.value);
                setLocalCheckPage(0);
              }}
              className="h-8 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 text-xs text-slate-300 outline-none focus:border-emerald-500/60"
            >
              <option value="all">
                {t("legacyUi.overview.allCategories")}
              </option>
              {localCheckCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 whitespace-nowrap text-[11px] text-slate-400">
            <input
              type="checkbox"
              checked={showOnlyProblems}
              onChange={(event) =>
                useAuditStore
                  .getState()
                  .setShowOnlyProblems(event.target.checked)
              }
              className="accent-emerald-500"
            />
            {t("legacyUi.overview.problemsOnly")}
          </label>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visibleCoverageChecks.map((item) => (
            <div
              key={item.id}
              className={`rounded-lg border p-3 ${item.status === "pass" ? "border-emerald-500/20 bg-emerald-500/5" : item.status === "error" ? "border-rose-500/20 bg-rose-500/5" : item.status === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-slate-800 bg-slate-950/50"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="truncate text-xs font-medium text-slate-200"
                  title={item.label}
                >
                  {item.label}
                </span>
                <span
                  className={`shrink-0 text-[10px] font-semibold uppercase ${item.status === "pass" ? "text-emerald-300" : item.status === "error" ? "text-rose-300" : item.status === "warning" ? "text-amber-300" : "text-slate-500"}`}
                >
                  {item.status === "pass"
                    ? t("legacyUi.overview.pass")
                    : item.status === "error"
                      ? t("legacyUi.overview.error")
                      : item.status === "warning"
                        ? t("legacyUi.overview.warning")
                        : t("legacyUi.overview.notApplicable")}
                </span>
              </div>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-600">
                {item.category}
              </p>
              <p
                className="mt-1 truncate text-[11px] text-slate-400"
                title={item.evidence}
              >
                {item.evidence}
              </p>
            </div>
          ))}
        </div>
        {visibleCoverageChecks.length === 0 && (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-5 text-center text-xs text-slate-500">
            {t("legacyUi.overview.noMatchingChecks")}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-3 text-[11px] text-slate-500">
          <span>
            {t("legacyUi.overview.resultsPage", {
              count: filteredLocalChecks.length,
              page: safeLocalCheckPage + 1,
              pages: localCheckPageCount,
            })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={safeLocalCheckPage === 0}
              onClick={() => setLocalCheckPage((page) => Math.max(0, page - 1))}
              className="rounded-md border border-slate-700 px-2.5 py-1 text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("legacyUi.overview.previous")}
            </button>
            <button
              type="button"
              disabled={safeLocalCheckPage >= localCheckPageCount - 1}
              onClick={() =>
                setLocalCheckPage((page) =>
                  Math.min(localCheckPageCount - 1, page + 1),
                )
              }
              className="rounded-md border border-slate-700 px-2.5 py-1 text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("legacyUi.overview.next")}
            </button>
          </div>
        </div>
      </section>

      {/* DataForSEO Live Intelligence Bar */}
      <div className="bg-gradient-to-r from-slate-900/80 via-emerald-950/20 to-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h4 className="text-sm font-bold text-white">
                {t("legacyUi.overview.dataforseoTitle")}
              </h4>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                {dataforseoData
                  ? t("legacyUi.overview.liveData")
                  : t("legacyUi.overview.connectionRequired")}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {dataforseoData
                ? t("legacyUi.overview.liveDomainMetrics", {
                    domain: new URL(audit.final_url).hostname,
                  })
                : dataforseoError || t("legacyUi.overview.connectPrompt")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="text-lg font-black text-white font-mono">
              {dataforseoData
                ? dataforseoData.total_backlinks.toLocaleString()
                : "—"}
            </div>
            <span className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider">
              {t("legacyUi.overview.backlinks")}
            </span>
          </div>

          <div>
            <div className="text-lg font-black text-emerald-400 font-mono">
              {dataforseoData
                ? dataforseoData.referring_domains.toLocaleString()
                : "—"}
            </div>
            <span className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider">
              {t("legacyUi.overview.refDomains")}
            </span>
          </div>

          <div>
            <div className="text-lg font-black text-amber-400 font-mono">
              {dataforseoData ? `${dataforseoData.rank}/100` : "—"}
            </div>
            <span className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider">
              {t("legacyUi.overview.domainRank")}
            </span>
          </div>

          <button
            onClick={() => setActiveTab("dataforseo")}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition flex items-center space-x-1 shadow-sm"
          >
            <span>{t("legacyUi.overview.exploreSerp")}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Actionable Quick Wins Recommendation Box */}
      {audit.issues.length > 0 && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-blue-950/40 via-slate-900 to-emerald-950/30 border border-blue-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">
                {t("overview.quickWins")}
              </h4>
              <p className="text-xs text-slate-400">
                {t("legacyUi.overview.quickWinsDescription")}
              </p>
            </div>
          </div>
          <button
            onClick={() => openModal("ai")}
            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition shadow-sm shadow-emerald-600/30 shrink-0 flex items-center space-x-1"
          >
            <span>{t("legacyUi.overview.launchAi")}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Detailed Issues List */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <span>{t("overview.issuesTitle")}</span>
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-slate-800 text-slate-300 font-mono">
              {audit.issues.length}
            </span>
          </h3>
        </div>

        <div className="divide-y divide-slate-800/80">
          {audit.issues.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-white">
                {t("legacyUi.overview.cleanHealth")}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {t("legacyUi.overview.cleanHealthDescription")}
              </p>
            </div>
          ) : (
            audit.issues.map((issue, idx) => {
              const localizedIssue = localizeAuditIssue(issue, t);
              const isCritical = issue.severity === "Critical";
              const isWarning = issue.severity === "Warning";
              const accessibilityFinding = audit.accessibility?.findings?.find(
                (finding) =>
                  finding.code === issue.code ||
                  issue.message.includes(finding.code),
              );
              const accessibilityElements = accessibilityFinding?.elements ?? [];
              const evidenceCode = accessibilityFinding?.code ?? issue.code;
              const evidenceSelector = accessibilitySelectorForCode(evidenceCode);
              const evidenceLabel = t(accessibilityEvidenceLabelKey(evidenceCode));
              const Icon = isCritical
                ? AlertCircle
                : isWarning
                  ? AlertTriangle
                  : CheckCircle2;

              return (
                <div
                  key={idx}
                  className="p-4 hover:bg-slate-800/30 transition flex items-start space-x-3.5"
                >
                  <div
                    className={`p-1.5 rounded-md shrink-0 mt-0.5 ${
                      isCritical
                        ? "bg-rose-500/10 text-rose-400"
                        : isWarning
                          ? "bg-amber-500/10 text-amber-400"
                          : "bg-blue-500/10 text-blue-400"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-semibold text-white">
                        {localizedIssue.displayMessage}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-semibold uppercase ${
                          isCritical
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                            : isWarning
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                              : "bg-blue-500/10 text-blue-400 border border-blue-500/30"
                        }`}
                      >
                        {t(`crawl.ui.severityValues.${issue.severity.toLowerCase()}`)}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        [{t(`auditChecks.categories.${issueCategoryTranslationKeys[issue.category]}`)}]
                      </span>
                    </div>

                    {localizedIssue.displayRecommendation && (
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        <span className="text-slate-300 font-medium">
                          {t("legacyUi.overview.action")}
                        </span>
                        {localizedIssue.displayRecommendation}
                      </p>
                    )}
                    {accessibilityElements.length > 0 && (
                      <details className="mt-2 rounded-md border border-slate-700/70 bg-slate-950/40 px-3 py-2">
                        <summary className="cursor-pointer text-[11px] font-medium text-emerald-200">
                          {t("accessibility.locationSummary", {
                            count: accessibilityElements.length,
                          })}
                        </summary>
                        <p className="mt-1 text-[10px] text-slate-500">
                          {t("accessibility.locationDescription")}
                        </p>
                        <div className="mt-2 space-y-2">
                          {accessibilityElements.map((element) => (
                            <div
                              key={`${element.dom_position}-${element.dom_query}`}
                              className="rounded border border-slate-800 bg-slate-900/70 p-2"
                            >
                              <p className="text-[10px] text-slate-400">
                                {t("accessibility.elementPosition", {
                                  label: evidenceLabel,
                                  position: element.dom_position,
                                  order:
                                    evidenceCode ===
                                      "accessibility-form-controls-unlabeled" ||
                                    evidenceCode ===
                                      "accessibility-antispam-control-not-text"
                                      ? t("accessibility.domOrder")
                                      : t("accessibility.selectorOrder"),
                                  source: element.line
                                    ? t("accessibility.source", {
                                        line: element.line,
                                        column: element.column ?? 1,
                                      })
                                    : t("accessibility.sourceUnavailable"),
                                })}
                              </p>
                              <code className="mt-1 block break-all text-[10px] text-emerald-200">
                                {element.dom_query}
                              </code>
                              <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-slate-300">
                                {element.html_snippet}
                              </pre>
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
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
