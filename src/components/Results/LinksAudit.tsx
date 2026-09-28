import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ShieldAlert,
  CheckCircle2,
  Search,
  Copy,
  Check,
  Loader2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Wifi,
  AlertTriangle,
  Download,
} from "lucide-react";
import { PageAuditData, LinkData } from "@/types";
import { invokeTauriCommand, isTauriEnvironment } from "@/services/tauri";
import { downloadAuditLinksCsv } from "@/services/export";
import { useAuditStore } from "@/stores/auditStore";
import { ShowOnPageButton } from "@/components/Results/ShowOnPageButton";
import { copyText } from "@/services/clipboard";

interface LinksAuditProps {
  audit: PageAuditData;
}

type LinkFilterType = "all" | "internal" | "external" | "security" | "nofollow";

const ITEMS_PER_PAGE = 50;

export const LinksAudit: React.FC<LinksAuditProps> = ({ audit }) => {
  const { t } = useTranslation();
  const [filterType, setFilterType] = useState<LinkFilterType>("all");
  const [search, setSearch] = useState("");
  const [verifiedLinks, setVerifiedLinks] = useState<
    Record<string, { status: number; isBroken: boolean; checking?: boolean; error?: string }>
  >({});
  const [isVerifyingBatch, setIsVerifyingBatch] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const showOnlyProblems = useAuditStore((state) => state.showOnlyProblems);

  const { links, url } = audit;
  const isPageHttps = url.toLowerCase().startsWith("https://");

  // Pre-calculate security warnings count
  const unsafeBlankCount = links.links.filter(
    (l) =>
      l.target === "_blank" &&
      (!l.rel ||
        (!l.rel.includes("noopener") && !l.rel.includes("noreferrer"))),
  ).length;

  const insecureHttpCount = links.links.filter(
    (l) =>
      l.is_insecure ||
      (isPageHttps && l.href.toLowerCase().startsWith("http://")),
  ).length;

  const securityIssuesCount = unsafeBlankCount + insecureHttpCount;

  // Filter links
  const filteredLinks = links.links.filter((l) => {
    const isUnsafeBlank =
      l.target === "_blank" &&
      (!l.rel ||
        (!l.rel.includes("noopener") && !l.rel.includes("noreferrer")));
    const isInsecure =
      l.is_insecure ||
      (isPageHttps && l.href.toLowerCase().startsWith("http://"));
    const isBroken = verifiedLinks[l.href]?.isBroken === true;

    if (showOnlyProblems && !isUnsafeBlank && !isInsecure && !isBroken)
      return false;

    if (filterType === "internal" && !l.is_internal) return false;
    if (filterType === "external" && l.is_internal) return false;
    if (filterType === "security" && !isUnsafeBlank && !isInsecure)
      return false;
    if (filterType === "nofollow") {
      const isNofollow = l.rel?.toLowerCase().includes("nofollow");
      if (!isNofollow) return false;
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        l.href.toLowerCase().includes(q) || l.text.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Pagination calculation
  const totalPages = Math.max(
    1,
    Math.ceil(filteredLinks.length / ITEMS_PER_PAGE),
  );
  const currentSafePage = Math.min(currentPage, totalPages);
  const startIndex = (currentSafePage - 1) * ITEMS_PER_PAGE;
  const paginatedLinks = filteredLinks.slice(
    startIndex,
    startIndex + ITEMS_PER_PAGE,
  );

  const handleCopy = async (href: string) => {
    const copied = await copyText(href);
    if (!copied) return;
    setCopiedUrl(href);
    setTimeout(() => setCopiedUrl(null), 1500);
  };

  const handleVerifySingleLink = async (href: string) => {
    setVerifiedLinks((prev) => ({
      ...prev,
      [href]: { status: 0, isBroken: false, checking: true },
    }));

    try {
      const res = await invokeTauriCommand<{
        status: number;
        is_broken: boolean;
      }>("check_link", {
        url: href,
      });
      setVerifiedLinks((prev) => ({
        ...prev,
        [href]: {
          status: res.status,
          isBroken: res.is_broken,
          checking: false,
        },
      }));
    } catch {
      setVerifiedLinks((prev) => ({
        ...prev,
        // A browser preview cannot perform native link checks. Keep this
        // distinct from an HTTP failure so an unavailable desktop bridge does
        // not turn every unverified link into a false broken-link finding.
        [href]: {
          status: 0,
          isBroken: false,
          checking: false,
          error: !isTauriEnvironment() ? t('runtimeErrors.tauri.desktopOnly') : t('legacyUi.links.offline'),
        },
      }));
    }
  };

  const handleVerifyBatch = async () => {
    setIsVerifyingBatch(true);
    const toCheck = paginatedLinks.slice(0, 25);
    for (const l of toCheck) {
      if (!verifiedLinks[l.href]) {
        await handleVerifySingleLink(l.href);
      }
    }
    setIsVerifyingBatch(false);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-6 animate-in fade-in duration-200">
      {/* 5 Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">
            {t("links.totalLinks")}
          </span>
          <span className="text-xl font-bold text-white font-mono">
            {links.total_links}
          </span>
        </div>

        <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">
            {t("links.internal")}
          </span>
          <span className="text-xl font-bold text-emerald-400 font-mono">
            {links.internal_links}
          </span>
        </div>

        <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">
            {t("links.external")}
          </span>
          <span className="text-xl font-bold text-blue-400 font-mono">
            {links.external_links}
          </span>
        </div>

        <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">
            {t("links.nofollow")}
          </span>
          <span className="text-xl font-bold text-amber-400 font-mono">
            {links.nofollow_links}
          </span>
        </div>

        <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">
            {t("legacyUi.links.securityRisks")}
          </span>
          <span
            className={`text-xl font-bold font-mono ${
              securityIssuesCount > 0 ? "text-rose-400" : "text-slate-400"
            }`}
          >
            {securityIssuesCount}
          </span>
        </div>
      </div>

      {/* Filter, Search & Batch Verification Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder={t("legacyUi.links.searchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full h-9 pl-9 pr-3 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {/* Tab Filters and Action */}
        <div className="flex items-center space-x-2 w-full sm:w-auto justify-between sm:justify-end overflow-x-auto">
          <div className="flex items-center space-x-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => {
                setFilterType("all");
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                filterType === "all"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t("legacyUi.links.all", { count: links.total_links })}
            </button>
            <button
              onClick={() => {
                setFilterType("internal");
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                filterType === "internal"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t("legacyUi.links.internal", { count: links.internal_links })}
            </button>
            <button
              onClick={() => {
                setFilterType("external");
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                filterType === "external"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t("legacyUi.links.external", { count: links.external_links })}
            </button>
            <button
              onClick={() => {
                setFilterType("security");
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                filterType === "security"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t("legacyUi.links.risks", { count: securityIssuesCount })}
            </button>
            <button
              onClick={() => {
                setFilterType("nofollow");
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                filterType === "nofollow"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t("legacyUi.links.nofollow", { count: links.nofollow_links })}
            </button>
          </div>

          <button
            onClick={handleVerifyBatch}
            disabled={isVerifyingBatch || paginatedLinks.length === 0}
            className="h-9 px-3 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg transition border border-slate-700 flex items-center space-x-1.5 disabled:opacity-50 shrink-0"
          >
            {isVerifyingBatch ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span className="hidden sm:inline">
              {t("legacyUi.links.verifyPage", { count: paginatedLinks.length })}
            </span>
          </button>
          <button
            type="button"
            onClick={() => downloadAuditLinksCsv(audit)}
            className="h-9 shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white"
            title={t("legacyUi.links.exportTitle")}
          >
            <span className="inline-flex items-center gap-1.5">
              <Download className="h-3.5 w-3.5 text-emerald-400" />
              {t("legacyUi.url.csv")}
            </span>
          </button>
        </div>
      </div>

      {/* Links List */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="divide-y divide-slate-800/80">
          {paginatedLinks.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              <ExternalLink className="w-8 h-8 mx-auto mb-2 text-slate-600" />
              {t("legacyUi.links.empty")}
            </div>
          ) : (
            paginatedLinks.map((link: LinkData, idx: number) => {
              const isUnsafeBlank =
                link.target === "_blank" &&
                (!link.rel ||
                  (!link.rel.includes("noopener") &&
                    !link.rel.includes("noreferrer")));
              const isInsecure =
                link.is_insecure ||
                (isPageHttps && link.href.toLowerCase().startsWith("http://"));
              const verified = verifiedLinks[link.href];

              return (
                <div
                  key={idx}
                  className="p-3.5 hover:bg-slate-800/30 transition flex items-start space-x-3 text-xs"
                >
                  {/* Internal / External Pill */}
                  <div className="pt-0.5 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase ${
                        link.is_internal
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      }`}
                    >
                      {link.is_internal
                        ? t("legacyUi.links.internalLabel")
                        : t("legacyUi.links.externalLabel")}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-medium text-white truncate max-w-sm">
                        {link.text || (
                          <span className="text-slate-500 italic">
                            {t("legacyUi.links.noAnchor")}
                          </span>
                        )}
                      </span>

                      {link.rel && (
                        <span className="text-[10px] text-slate-400 font-mono bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                          {t("uiUnits.relAttribute", { value: link.rel })}
                        </span>
                      )}

                      {link.target && (
                        <span className="text-[10px] text-slate-400 font-mono bg-slate-800/60 px-1.5 py-0.5 rounded">
                          {t("uiUnits.targetAttribute", { value: link.target })}
                        </span>
                      )}
                    </div>

                    <div className="font-mono text-slate-400 text-[11px] truncate mt-0.5">
                      {link.href}
                    </div>

                    {/* Security Warning Badges */}
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {isUnsafeBlank && (
                        <div className="inline-flex items-center space-x-1 text-rose-400 text-[10px] font-medium bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                          <ShieldAlert className="w-3 h-3 shrink-0" />
                          <span>{t("legacyUi.links.tabnabbing")}</span>
                        </div>
                      )}

                      {isInsecure && (
                        <div className="inline-flex items-center space-x-1 text-amber-400 text-[10px] font-medium bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>{t("legacyUi.links.mixedContent")}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Verification Status & Individual Ping Button */}
                  <div className="flex items-center space-x-2 shrink-0">
                    {verified?.checking ? (
                      <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-300 flex items-center space-x-1">
                        <Loader2 className="w-2.5 h-2.5 animate-spin text-emerald-400" />
                        <span>{t("legacyUi.links.pinging")}</span>
                      </span>
                    ) : verified ? (
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                          verified.error
                            ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                            : verified.isBroken
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        }`}
                      >
                        {verified.error || (verified.status
                          ? t("crawl.ui.httpStatus", { status: verified.status })
                          : t("legacyUi.links.offline"))}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleVerifySingleLink(link.href)}
                        className="text-[10px] text-slate-400 hover:text-emerald-400 bg-slate-800/80 hover:bg-slate-800 px-2 py-0.5 rounded border border-slate-700 transition flex items-center space-x-1"
                        title={t("legacyUi.links.pingTitle")}
                      >
                        <Wifi className="w-2.5 h-2.5" />
                        <span>{t("legacyUi.links.ping")}</span>
                      </button>
                    )}

                    <ShowOnPageButton
                      url={audit.final_url || audit.url}
                      selector="a[href]"
                      needle={link.href}
                      label={`${t("legacyUi.links.internalLabel")} ${link.text || link.href}`}
                    />

                    <button
                      onClick={() => handleCopy(link.href)}
                      className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
                      title={t("legacyUi.links.copyUrl")}
                    >
                      {copiedUrl === link.href ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="p-3 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <div>
              {t("legacyUi.links.showing", {
                from: startIndex + 1,
                to: Math.min(startIndex + ITEMS_PER_PAGE, filteredLinks.length),
                count: filteredLinks.length,
              })}
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentSafePage === 1}
                className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-slate-900 text-white transition"
                title={t("legacyUi.links.previousPage")}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-mono text-slate-300 px-2">
                {t("legacyUi.links.pageOf", {
                  page: currentSafePage,
                  pages: totalPages,
                })}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentSafePage === totalPages}
                className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-slate-900 text-white transition"
                title={t("legacyUi.links.nextPage")}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
