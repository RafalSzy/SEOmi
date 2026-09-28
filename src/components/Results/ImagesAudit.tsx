import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Image as ImageIcon,
  AlertCircle,
  Copy,
  Check,
  Search,
  Sparkles,
  Layers,
  AlertTriangle,
  Download,
} from "lucide-react";
import { PageAuditData } from "@/types";
import { downloadAuditImagesCsv } from "@/services/export";
import { useAuditStore } from "@/stores/auditStore";
import { ShowOnPageButton } from "@/components/Results/ShowOnPageButton";
import { copyText } from "@/services/clipboard";

interface ImagesAuditProps {
  audit: PageAuditData;
}

type FilterType = "all" | "missing-alt" | "missing-dim" | "legacy" | "modern";

export const ImagesAudit: React.FC<ImagesAuditProps> = ({ audit }) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const showOnlyProblems = useAuditStore((state) => state.showOnlyProblems);

  const images = audit.images;

  // Metric Computations
  const missingAltCount = images.filter((img) => !img.has_alt).length;
  const missingDimCount = images.filter(
    (img) => !img.width || !img.height,
  ).length;

  const isModern = (format?: string, src?: string) => {
    const f = (format || "").toLowerCase();
    const s = (src || "").toLowerCase();
    return (
      f === "webp" ||
      f === "avif" ||
      f === "svg" ||
      s.endsWith(".webp") ||
      s.endsWith(".avif") ||
      s.endsWith(".svg")
    );
  };

  const isLegacy = (format?: string, src?: string) => {
    const f = (format || "").toLowerCase();
    const s = (src || "").toLowerCase();
    return (
      f === "png" ||
      f === "jpeg" ||
      f === "jpg" ||
      f === "gif" ||
      s.endsWith(".png") ||
      s.endsWith(".jpg") ||
      s.endsWith(".jpeg") ||
      s.endsWith(".gif")
    );
  };

  const modernCount = images.filter((img) =>
    isModern(img.format, img.src),
  ).length;
  const legacyCount = images.filter((img) =>
    isLegacy(img.format, img.src),
  ).length;

  // Filter & Search Logic
  const filteredImages = images.filter((img) => {
    if (showOnlyProblems && img.has_alt && img.width && img.height)
      return false;
    if (filter === "missing-alt" && img.has_alt) return false;
    if (filter === "missing-dim" && img.width && img.height) return false;
    if (filter === "legacy" && !isLegacy(img.format, img.src)) return false;
    if (filter === "modern" && !isModern(img.format, img.src)) return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const matchSrc = img.src.toLowerCase().includes(q);
      const matchAlt = (img.alt || "").toLowerCase().includes(q);
      const matchFormat = (img.format || "").toLowerCase().includes(q);
      return matchSrc || matchAlt || matchFormat;
    }

    return true;
  });

  const handleCopy = async (url: string) => {
    const copied = await copyText(url);
    if (!copied) return;
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 1500);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-6 animate-in fade-in duration-200">
      {/* 4 Stat Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shrink-0">
            <ImageIcon className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">
              {t("images.imagesFound")}
            </span>
            <span className="text-lg font-bold text-white font-mono">
              {images.length}
            </span>
          </div>
        </div>

        <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 shrink-0">
            <AlertCircle className="w-4 h-4 text-rose-400" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">
              {t("images.missingAlt")}
            </span>
            <span className="text-lg font-bold text-rose-400 font-mono">
              {missingAltCount}
            </span>
          </div>
        </div>

        <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">
              {t("legacyUi.images.clsRisk")}
            </span>
            <span className="text-lg font-bold text-amber-400 font-mono">
              {missingDimCount}
            </span>
          </div>
        </div>

        <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 shrink-0">
            <Sparkles className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">
              {t("legacyUi.images.modernHints")}
            </span>
            <span
              className="text-lg font-bold text-indigo-400 font-mono"
              title={t("legacyUi.images.modernHintTitle")}
            >
              {modernCount}/{images.length}
            </span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder={t("legacyUi.images.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto text-xs">
          <div className="flex items-center space-x-1.5 p-1 bg-slate-900/80 rounded-xl border border-slate-800">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap ${
                filter === "all"
                  ? "bg-slate-800 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t("legacyUi.images.all", { count: images.length })}
            </button>
            <button
              onClick={() => setFilter("missing-alt")}
              className={`px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap ${
                filter === "missing-alt"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t("legacyUi.images.missingAlt", { count: missingAltCount })}
            </button>
            <button
              onClick={() => setFilter("missing-dim")}
              className={`px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap ${
                filter === "missing-dim"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t("legacyUi.images.missingDimensions", {
                count: missingDimCount,
              })}
            </button>
            <button
              onClick={() => setFilter("legacy")}
              className={`px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap ${
                filter === "legacy"
                  ? "bg-orange-500/20 text-orange-300 border border-orange-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t("legacyUi.images.legacy", { count: legacyCount })}
            </button>
            <button
              onClick={() => setFilter("modern")}
              className={`px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap ${
                filter === "modern"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t("legacyUi.images.modern", { count: modernCount })}
            </button>
          </div>
          <button
            type="button"
            onClick={() => downloadAuditImagesCsv(audit)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white"
            title={t("legacyUi.images.exportTitle")}
          >
            <Download className="h-3.5 w-3.5 text-emerald-400" />
            {t("legacyUi.url.csv")}
          </button>
        </div>
      </div>

      {/* Images List */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="divide-y divide-slate-800/80">
          {filteredImages.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              <ImageIcon className="w-8 h-8 mx-auto mb-2 text-slate-600" />
              {t("legacyUi.images.empty")}
            </div>
          ) : (
            filteredImages.map((img, idx) => {
              const modern = isModern(img.format, img.src);
              const formatLabel = (
                img.format ||
                img.src.split(".").pop()?.split("?")[0] ||
                "img"
              ).toUpperCase();
              const hasDimensions = Boolean(img.width && img.height);

              return (
                <div
                  key={idx}
                  className="p-4 hover:bg-slate-800/30 transition flex items-start space-x-4"
                >
                  {/* Thumbnail Preview with Fallback */}
                  <div className="w-16 h-16 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center relative">
                    <img
                      src={img.src}
                      alt={img.alt || ""}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />
                    <ImageIcon className="w-6 h-6 text-slate-700 absolute -z-10" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-mono text-slate-200 truncate max-w-xl">
                        {img.src}
                      </span>
                      <button
                        onClick={() => handleCopy(img.src)}
                        className="text-slate-400 hover:text-white p-1 shrink-0 rounded hover:bg-slate-800 transition"
                        title={t("legacyUi.images.copyUrl")}
                      >
                        {copiedUrl === img.src ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <ShowOnPageButton
                        url={audit.final_url || audit.url}
                        selector="img"
                        needle={img.src}
                        label={t("legacyUi.images.imageLabel", {
                          value: img.alt || img.src,
                        })}
                      />
                    </div>

                    {/* Alt Text Box */}
                    <div className="mb-2.5">
                      {img.has_alt ? (
                        <p className="text-xs text-slate-300 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                          <span className="font-semibold text-emerald-400 font-mono mr-1.5">
                            {t("uiUnits.altPrefix")}
                          </span>
                          {img.alt}
                        </p>
                      ) : (
                        <span className="inline-flex items-center space-x-1.5 text-[11px] font-semibold text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-md border border-rose-500/20">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>{t("legacyUi.images.missingAltWarning")}</span>
                        </span>
                      )}
                    </div>

                    {/* Meta Badges: Format, Dimensions, Lazy Loading, Srcset */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                      {/* Format Badge */}
                      <span
                        className={`px-2 py-0.5 rounded font-bold uppercase ${
                          modern
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-orange-500/10 text-orange-400 border border-orange-500/20"
                        }`}
                      >
                        {formatLabel}{" "}
                        {modern
                          ? t("legacyUi.images.modernHint")
                          : t("legacyUi.images.legacyHint")}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {t("legacyUi.images.formatHint")}
                      </span>

                      {/* Dimensions / CLS Badge */}
                      {hasDimensions ? (
                        <span
                          className="bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded border border-slate-700"
                          title={
                            img.dimensions_source === "intrinsic-data-uri"
                              ? t("legacyUi.images.decodedDataUri")
                              : img.dimensions_source === "mixed"
                                ? t("legacyUi.images.mixedDataUri")
                                : t("legacyUi.images.markupDimensions")
                          }
                        >
                          {img.width} × {img.height} {t("uiUnits.pixels")}
                          {img.dimensions_source === "intrinsic-data-uri"
                            ? ` · ${t("legacyUi.images.intrinsicDataUri")}`
                            : img.dimensions_source === "mixed"
                              ? ` · ${t("legacyUi.images.mixedEvidence")}`
                              : ""}
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded border border-amber-500/20 font-semibold">
                          <AlertTriangle className="w-3 h-3" />
                          <span>
                            {t("legacyUi.images.missingDimensionsWarning")}
                          </span>
                        </span>
                      )}

                      {/* Loading Badge */}
                      {img.loading ? (
                        <span className="bg-slate-800/80 text-slate-400 px-2 py-0.5 rounded border border-slate-700">
                          {t("uiUnits.loadingAttribute", { value: img.loading })}
                        </span>
                      ) : (
                        <span className="bg-slate-800/50 text-slate-500 px-2 py-0.5 rounded">
                          {t("legacyUi.images.loadingUnspecified")}
                        </span>
                      )}

                      {/* Responsive Srcset Badge */}
                      {img.srcset && (
                        <span className="inline-flex items-center space-x-1 bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20">
                          <Layers className="w-3 h-3" />
                          <span>{t("legacyUi.images.responsive")}</span>
                        </span>
                      )}
                    </div>
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
