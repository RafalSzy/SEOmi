import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrawlResultsTabs } from "@/components/Domain/CrawlResultsTabs";
import { useProjectStore } from "@/stores/projectStore";
import { useToolsStore } from "@/stores/toolsStore";
import * as tauriService from "@/services/tauri";
import type { CrawlRunRecord, SiteCrawlResult } from "@/types";
import i18n from "@/i18n";

const result = {
  start_url: "https://example.com/",
  pages_crawled: 2,
  health_score: 80,
  critical_count: 1,
  warning_count: 1,
  notice_count: 0,
  duration_ms: 250,
  cancelled: false,
  robots_txt_status: "loaded",
  robots_blocked_count: 0,
  sitemap_status: "loaded",
  sitemap_urls_discovered: 0,
  sitemap_urls: [],
  pages: [
    {
      url: "https://example.com/",
      final_url: "https://example.com/",
      redirect_chain: [],
      depth: 0,
      http_status: 200,
      response_time_ms: 120,
      title: "Example home",
      title_length: 12,
      meta_description: "Home page",
      indexability_status: "Eligible from this response only",
      body_truncated: false,
      word_count: 80,
      schema_types: ["Organization"],
      schema_syntax_errors: 0,
      document_language: "en",
      hreflangs: [],
      h1_count: 1,
      internal_link_count: 1,
      external_link_count: 0,
      links: [
        {
          target_url: "https://example.com/missing",
          anchor_text: "Missing page",
          is_internal: true,
          target_http_status: 404,
        },
      ],
      images: [
        {
          src: "https://example.com/logo.webp",
          alt: "Example",
          format: "webp",
          lazy_loaded: false,
        },
      ],
      issues_count: 1,
      issues: [
        {
          severity: "Warning",
          message: "Image could use a descriptive filename",
        },
      ],
    },
    {
      url: "https://example.com/missing",
      final_url: "https://example.com/missing",
      redirect_chain: [],
      depth: 1,
      http_status: 404,
      response_time_ms: 80,
      request_error_kind: undefined,
      title: "",
      indexability_status: "Blocked by HTTP status",
      body_truncated: false,
      word_count: 0,
      schema_types: [],
      schema_syntax_errors: 0,
      hreflangs: [],
      h1_count: 0,
      internal_link_count: 0,
      external_link_count: 0,
      links: [],
      images: [],
      issues_count: 1,
      issues: [{ severity: "Critical", message: "HTTP 404 response" }],
    },
  ],
} as SiteCrawlResult;

const run = {
  id: "run-1",
  completedAt: "2026-09-22T10:00:00.000Z",
  startUrl: result.start_url,
  config: {
    includePatterns: [],
    excludePatterns: [],
    allowSubdomains: false,
    keepQueryStrings: false,
    respectRobots: true,
    respectCrawlDelay: true,
    discoverSitemaps: true,
    followNofollow: false,
  },
  result,
} as CrawlRunRecord;

describe("CrawlResultsTabs", () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });
  beforeEach(async () => {
    await i18n.changeLanguage('en');
   localStorage.clear();
    window.history.replaceState(null, "", "/");
    useProjectStore.setState({ activeProjectId: null });
  });

  it("exposes all result sections as keyboard-accessible tabs", () => {
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("tab")).toHaveLength(18);
    expect(
      screen
.getByRole("tab", { name: /Overview/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("HTTP · JavaScript not rendered")).not.toBeNull();
fireEvent.click(screen.getByRole("tab", { name: /Content/ }));
    expect(screen.queryByText("Example home")).not.toBeNull();
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "crawl-tab-content",
    );
  });

  it("mounts every crawl result section without a route or render error", async () => {
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    const tabNames = screen
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.replace(/\s+/g, " ").trim())
      .filter((name): name is string => Boolean(name));

    expect(tabNames).toHaveLength(18);

    for (const tabName of tabNames) {
      const tab = screen
        .getAllByRole("tab")
        .find((candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === tabName);
      expect(tab, `missing crawl result tab: ${tabName}`).toBeTruthy();

      await act(async () => {
        fireEvent.click(tab as HTMLElement);
      });

      await waitFor(() => {
        expect(
          (tab as HTMLElement).getAttribute("aria-selected"),
          `tab ${tabName} was not selected`,
        ).toBe("true");
        expect(screen.getAllByRole("tabpanel").length).toBeGreaterThan(0);
        expect(screen.queryByRole("alert")).toBeNull();
      });
    }
  });

  it("renders crawler findings in the active locale while retaining the raw evidence", async () => {
    await i18n.changeLanguage("pl");
    const localizedResult = {
      ...result,
      pages: [{ ...result.pages[0], issues: [{ severity: "Critical", message: "Missing <title> tag" }] }],
    } as SiteCrawlResult;
    const localizedRun = { ...run, result: localizedResult };

    render(
      <CrawlResultsTabs
        result={localizedResult}
        runs={[localizedRun]}
        selectedRun={localizedRun}
        onSelectRun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Problemy|Issues/ }));
    await waitFor(() => expect(screen.getByText("Brak tagu <title> strony")).toBeTruthy());
    expect(screen.queryByText("Missing <title> tag")).toBeNull();
  });

  it("shows faceted metadata findings and remembers the selected facet per project and run", () => {
    useProjectStore.setState({ activeProjectId: "project-a" });
    const metadataResult = {
      ...result,
      pages: [
        {
          ...result.pages[0],
          title: "Short title",
          title_length: 11,
          meta_description: "A short description",
          meta_description_length: 19,
          issues: [
            { severity: "Info", message: "Title length is 11 characters; reference range is 30–60" },
            { severity: "Info", message: "Meta description length is 19 characters; reference range is 70–160" },
            { severity: "Warning", message: "Duplicate title found in this crawl" },
          ],
        },
        {
          ...result.pages[1],
          title: "",
          title_length: 0,
          meta_description: undefined,
          meta_description_length: undefined,
          issues: [
            { severity: "Critical", message: "Missing <title> tag" },
            { severity: "Warning", message: "Meta description is empty" },
            { severity: "Warning", message: "Duplicate meta description found in this crawl" },
          ],
        },
        {
          ...result.pages[1],
          url: "https://example.com/manual.pdf",
          final_url: "https://example.com/manual.pdf",
          content_type: "application/pdf",
          title: undefined,
          meta_description: undefined,
          issues: [],
        },
      ],
    } as SiteCrawlResult;
    const metadataRun = { ...run, result: metadataResult };
    const view = render(
      <CrawlResultsTabs
        result={metadataResult}
        runs={[metadataRun]}
        selectedRun={metadataRun}
        onSelectRun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Metadata/ }));
    expect(screen.getByRole("tab", { name: /Metadata 2/ })).not.toBeNull();
    expect(screen.getByText(/Faceted metadata report/)).not.toBeNull();
    expect(screen.getByRole("button", { name: /Title out of range · 1/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Empty title · 1/ })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Empty title · 1/ }));
    expect(screen.getByText(i18n.t("crawl.ui.emptyValue"))).not.toBeNull();
    expect(screen.queryByText("Short title")).toBeNull();

    view.unmount();
    render(
      <CrawlResultsTabs
        result={metadataResult}
        runs={[metadataRun]}
        selectedRun={metadataRun}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Metadata/ }));
    expect(screen.getByRole("button", { name: /Empty title · 1/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("https://example.com/manual.pdf")).toBeNull();
  });

  it("renders native snapshots that encode optional metadata as null", () => {
    const nativeResult = {
      ...result,
      pages: [
        {
          ...result.pages[0],
          title: null,
          title_length: null,
          meta_description: null,
          meta_description_length: null,
        },
      ],
    } as unknown as SiteCrawlResult;
    const nativeRun = { ...run, result: nativeResult };

    render(
      <CrawlResultsTabs
        result={nativeResult}
        runs={[nativeRun]}
        selectedRun={nativeRun}
        onSelectRun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Metadata/ }));
    expect(screen.getByText(i18n.t("crawl.ui.missingTag"))).not.toBeNull();
    expect(screen.getByText(i18n.t("crawl.ui.missingTagOrData"))).not.toBeNull();
  });

  it("supports Home/End navigation for the long result tab strip", () => {
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

const tabList = screen.getByRole("tablist", { name: "Crawl results" });
    fireEvent.keyDown(tabList, { key: "End" });
expect(screen.getByRole("tab", { name: /Exports/ }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(tabList, { key: "Home" });
expect(screen.getByRole("tab", { name: /Overview/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Scroll tabs to the beginning" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Scroll tabs to the end" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Scroll results to the beginning" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Scroll results to the end" })).not.toBeNull();
  });

  it("keeps the map at the front of the tab strip and offers a direct section picker", () => {
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    const firstTabs = screen.getAllByRole("tab").slice(0, 2);
expect(firstTabs[0].textContent).toContain("Overview");
expect(firstTabs[1].textContent).toContain("Map & clusters");
    fireEvent.change(screen.getByLabelText("Jump to crawl section"), {
      target: { value: "customSearch" },
    });
    expect(
      screen
        .getByRole("tab", { name: /Custom search/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("remembers the selected result section per project and crawl-run", () => {
    useProjectStore.setState({ activeProjectId: "project-navigation" });
    const view = render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

fireEvent.click(screen.getByRole("tab", { name: /Content/ }));
    const key = "seomi_project_project-navigation_crawl_navigation_run-1_v1";
    expect(localStorage.getItem(key)).toContain('"activeTab":"content"');

    view.unmount();
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    expect(
screen.getByRole("tab", { name: /Content/ }).getAttribute("aria-selected"),
    ).toBe("true");
expect(screen.getByText(/Content & resources · Content · 1 items/)).not.toBeNull();
  });

  it("persists link filters per project and crawl-run", () => {
    useProjectStore.setState({ activeProjectId: "project-links" });
    const view = render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Links/ }));
    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.searchLink")), { target: { value: "missing" } });
    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.linkType")), { target: { value: "internal" } });
    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.linkStatus")), { target: { value: "error" } });
    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.linkSort")), { target: { value: "target" } });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("crawl.ui.ascending") }));
    expect(localStorage.getItem("seomi_project_project-links_crawl_links_run-1_v1")).toContain('"status":"error"');

    view.unmount();
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Links/ }));
    expect(screen.getByLabelText(i18n.t("crawl.ui.searchLink"))).toHaveProperty("value", "missing");
    expect(screen.getByLabelText(i18n.t("crawl.ui.linkType"))).toHaveProperty("value", "internal");
    expect(screen.getByLabelText(i18n.t("crawl.ui.linkStatus"))).toHaveProperty("value", "error");
    expect(screen.getByLabelText(i18n.t("crawl.ui.linkSort"))).toHaveProperty("value", "target");
    expect(screen.getByRole("button", { name: i18n.t("crawl.ui.descending") }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens a link deep-link on the Links tab and highlights the exact source/target row", async () => {
    const projectId = "project-link-evidence";
    const source = "https://example.com/";
    const target = "https://example.com/missing";
    useProjectStore.setState({ activeProjectId: projectId });
    window.location.hash = `#crawl-evidence?project=${encodeURIComponent(projectId)}&run=${encodeURIComponent(run.id)}&url=${encodeURIComponent(source)}&tab=links&source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`;

    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Links/ }).getAttribute("aria-selected")).toBe("true");
    });
    const sourceLink = screen.getByRole("link", { name: source });
    expect(sourceLink.getAttribute("href")).toContain("tab=links");
    expect(sourceLink.getAttribute("href")).toContain(encodeURIComponent(target));
    expect(sourceLink.closest("tr")?.getAttribute("data-target-url")).toBe(target);
    expect(sourceLink.closest("tr")?.className).toContain("bg-emerald-500/10");
  });

  it("opens and scrolls to the map from the page-level navigation request", async () => {
    await i18n.changeLanguage('pl');
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
        mapNavigationRequest={1}
      />,
    );

    expect(
    screen
.getByRole("tab", { name: /Mapa i klastry/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("img", {
        name: "Interaktywna mapa semantycznych klastrów i linków w treści",
      }),
    ).not.toBeNull();
  });

  it("exposes the local crawler and AI readiness panel from the grouped results tabs", () => {
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Crawler \/ AI/ }));
    expect(screen.getByRole("heading", { name: i18n.t("crawlerReadiness.title") })).not.toBeNull();
    expect(screen.getByText(new RegExp(i18n.t("crawlerReadiness.scoreLabel")))).not.toBeNull();
    expect(screen.getByText(new RegExp(i18n.t("crawlerReadiness.checks.renderedDom.httpEvidence")))).not.toBeNull();
  });

  it("shows rendered Web Vitals separately from navigation timing", () => {
    const renderedResult = {
      ...result,
      crawl_mode: "browser-rendered",
      pages: result.pages.map((page, index) =>
        index === 0
          ? {
              ...page,
              rendered_lcp_ms: 1830,
              rendered_inp_ms: 92,
              rendered_cls: 0.042,
            }
          : page,
      ),
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={renderedResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Performance/ }));

    expect(
      screen.getByText(i18n.t("crawlDeepUi.renderedVitals")),
    ).not.toBeNull();
    expect(screen.getByText("1830 ms")).not.toBeNull();
    expect(screen.getByText("92 ms")).not.toBeNull();
    expect(screen.getByText("0.042")).not.toBeNull();
    expect(screen.getByText(i18n.t("crawlDeepUi.renderedVitalsDescription"))).not.toBeNull();
  });

  it("captures and downloads a selected rendered URL artifact", async () => {
    const renderedResult = {
      ...result,
      crawl_mode: "browser-rendered",
      pages: [
        ...result.pages,
        {
          ...result.pages[0],
          url: "https://example.com/rendered",
          final_url: "https://example.com/rendered",
          title: "Rendered page",
        },
      ],
    } as SiteCrawlResult;
    const renderedRun = {
      ...run,
      id: "rendered-run",
      result: renderedResult,
      config: { ...run.config, crawlMode: "browser-rendered" },
    } as CrawlRunRecord;
    const capture = vi
      .spyOn(tauriService, "captureRenderedArtifact")
      .mockResolvedValue({
        requestedUrl: "https://example.com/rendered",
        finalUrl: "https://example.com/rendered",
        runId: "rendered-run",
        capturedAt: "2026-09-23T12:34:56Z",
        artifactType: "screenshot",
        contentType: "image/png",
        fileName: "rendered-page-20260923T123456Z-screenshot.png",
        bytes: 4,
        dataBase64: "cG5n",
        rendererPlatform: "macos-wkwebview",
      });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:rendered-artifact"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(
      <CrawlResultsTabs
        result={renderedResult}
        runs={[renderedRun]}
        selectedRun={renderedRun}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Performance/ }));
    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.renderedUrlForArtifact")), {
      target: { value: "https://example.com/rendered" },
    });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("crawlDeepUi.screenshot") }));

    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com/rendered",
          kind: "screenshot",
          runId: "rendered-run",
        }),
      ),
    );
    expect(screen.getByText(i18n.t("crawl.ui.createdAndDownloaded"))).not.toBeNull();
    expect(screen.getByText("macos-wkwebview")).not.toBeNull();
  });

  it("resets rendered artifact selection when switching crawl runs", () => {
    const firstRenderedResult = {
      ...result,
      crawl_mode: "browser-rendered",
    } as SiteCrawlResult;
    const firstRenderedRun = {
      ...run,
      id: "rendered-first",
      result: firstRenderedResult,
    } as CrawlRunRecord;
    const secondRenderedResult = {
      ...result,
      start_url: "https://second.example/",
      crawl_mode: "browser-rendered",
      pages: result.pages.map((page, index) => ({
        ...page,
        url: index === 0 ? "https://second.example/" : "https://second.example/missing",
        final_url: index === 0 ? "https://second.example/" : "https://second.example/missing",
      })),
    } as SiteCrawlResult;
    const secondRenderedRun = {
      ...run,
      id: "rendered-second",
      startUrl: secondRenderedResult.start_url,
      result: secondRenderedResult,
    } as CrawlRunRecord;

    const view = render(
      <CrawlResultsTabs
        result={firstRenderedResult}
        runs={[firstRenderedRun]}
        selectedRun={firstRenderedRun}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Performance/ }));
    const artifactSelect = screen.getByLabelText(
      i18n.t("crawl.ui.renderedUrlForArtifact"),
    ) as HTMLSelectElement;
    fireEvent.change(artifactSelect, {
      target: { value: "https://example.com/missing" },
    });
    expect(artifactSelect.value).toBe("https://example.com/missing");

    view.rerender(
      <CrawlResultsTabs
        result={secondRenderedResult}
        runs={[secondRenderedRun]}
        selectedRun={secondRenderedRun}
        onSelectRun={vi.fn()}
      />,
    );

    expect(
      (screen.getByLabelText(
        i18n.t("crawl.ui.renderedUrlForArtifact"),
      ) as HTMLSelectElement).value,
    ).toBe("https://second.example/");
  });

  it("opens the semantic map from the results header quick action", async () => {
    await i18n.changeLanguage('pl');
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

fireEvent.click(screen.getByRole("button", { name: "Mapa i klastry" }));

    expect(
    screen
.getByRole("tab", { name: /Mapa i klastry/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("img", {
        name: "Interaktywna mapa semantycznych klastrów i linków w treści",
      }),
    ).not.toBeNull();
    expect(
        screen
        .getByRole("tablist", { name: i18n.t("crawl.navigation.resultsTitle") })
        .closest(".sticky")?.className,
    ).toContain("sticky");
  });

  it("keeps long result navigation grouped and exposes explicit tab-strip controls", () => {
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Crawl result section groups")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Scroll tabs left" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Scroll tabs right" }),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Technical/ }));
    expect(
      screen.getByRole("tab", { name: /Directives/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText(/Technical · Directives ·/)).not.toBeNull();
  });

  it("separates transport failures by deterministic kind in the URL filters", () => {
    const transportResult = {
      ...result,
      pages: [
        ...result.pages,
        {
          ...result.pages[1],
          url: "https://example.com/unreachable",
          final_url: "https://example.com/unreachable",
          http_status: 0,
          request_error_kind: "dns",
          title: undefined,
          issues: [{ severity: "Critical", message: "DNS request failed" }],
        },
      ],
    } as SiteCrawlResult;

    render(
      <CrawlResultsTabs
        result={transportResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /URL/ }));
    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.errorTypeAria")), {
      target: { value: "dns" },
    });

    expect(screen.getAllByText("DNS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("(dns)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("https://example.com/unreachable").length).toBeGreaterThan(0);
    expect(screen.queryByText("https://example.com/missing")).toBeNull();
  });

  it("shows recorded URL discovery provenance in the URL table", () => {
    const provenanceResult = {
      ...result,
      pages: result.pages.map((page, index) =>
        index === 1
          ? {
              ...page,
              discovery_sources: [
                {
                  kind: "link",
                  source_url: "https://example.com/",
                  anchor_text: "Missing page",
                },
                {
                  kind: "sitemap",
                  source_url: "https://example.com/sitemap.xml",
                },
              ],
            }
          : page,
      ),
    } as SiteCrawlResult;

    render(
      <CrawlResultsTabs
        result={provenanceResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /URL/ }));

    expect(screen.getAllByText(i18n.t("mapUi.discovery.link")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(i18n.t("mapUi.discovery.sitemap"), "i")).length).toBeGreaterThan(0);
    expect(screen.getByText("„Missing page”")).not.toBeNull();
  });

  it("shows per-hop redirect timing when the selected run recorded it", () => {
    const redirectResult = {
      ...result,
      pages: result.pages.map((page, index) =>
        index === 0
          ? {
              ...page,
              redirect_chain: [
                {
                  from_url: "https://example.com/old",
                  http_status: 301,
                  to_url: "https://example.com/",
                  response_time_ms: 42,
                },
              ],
              redirect_stop_reason: "Redirect limit of 10 exceeded",
              indexability_verdict: {
                status: "uncertain",
                reasons: ["redirect_response"],
              },
            }
          : page,
      ),
    } as SiteCrawlResult;

    render(
      <CrawlResultsTabs
        result={redirectResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /URL/ }));
    fireEvent.click(screen.getAllByText(i18n.t("crawl.ui.showEvidence"))[0]);

    expect(screen.getByText(/42 ms/)).not.toBeNull();
    expect(screen.getByText(/Redirect limit of 10 exceeded/)).not.toBeNull();
    expect(screen.getByText(/uncertain · redirect_response/)).not.toBeNull();
  });

  it("shows duplicate heading text with heading levels and occurrence count in Content", () => {
    const resultWithDuplicateHeadings = {
      ...result,
      pages: result.pages.map((page, index) =>
        index === 0
          ? {
              ...page,
              duplicate_headings: [
                { text: "Quick start", levels: [2, 3], occurrences: 2 },
              ],
            }
          : page,
      ),
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={resultWithDuplicateHeadings}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
fireEvent.click(screen.getByRole("tab", { name: /Content/ }));

    expect(screen.getByText("H2/H3 × 2: Quick start")).not.toBeNull();
  });

  it("shows content-only readability and top-term evidence per crawled URL", () => {
    const resultWithContentMetrics = {
      ...result,
      pages: result.pages.map((page, index) =>
        index === 0
          ? {
              ...page,
              sentence_count: 3,
              complexity_score: 81,
              complexity_label: "simple",
              readability_ease_score: 74.2,
              readability_grade: 6.1,
              readability_label: "standard",
              content_terms: [{ term: "espresso", count: 4, density_percent: 12.5 }],
              focus_phrase: { phrase: "espresso guide", body_occurrences: 2, body_density_percent: 8.3, title_occurrences: 1, meta_description_occurrences: 1, h1_occurrences: 1 },
            }
          : page,
      ),
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={resultWithContentMetrics}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
fireEvent.click(screen.getByRole("tab", { name: /Content/ }));

    expect(screen.getByText("74/100")).not.toBeNull();
    expect(screen.getByText("espresso 12.5%")).not.toBeNull();
    expect(screen.getByText(/espresso guide: body 2/)).not.toBeNull();
    expect(screen.getByText(/Flesch-like/)).not.toBeNull();
  });

  it("shows measured HTTP response-header timing for checked resources", () => {
    const resultWithResources = {
      ...result,
      resources: [
        {
          source_urls: ["https://example.com/"],
          url: "https://example.com/site.css",
          resource_type: "stylesheet",
          http_status: 200,
          content_type: "text/css",
          content_length: 42,
          response_time_ms: 17,
        },
      ],
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={resultWithResources}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Media/ }));

    expect(screen.getByText("17 ms")).not.toBeNull();
    expect(
      screen.getByText(i18n.t("crawlDeepUi.resourceTimingNote")),
    ).not.toBeNull();
  });

  it("classifies resource provenance and filters orphaned records", () => {
    const resultWithResourceProvenance = {
      ...result,
      resources: [
        {
          source_urls: ["https://example.com/"],
          url: "https://example.com/referenced.css",
          resource_type: "stylesheet",
        },
        {
          source_urls: ["https://example.com/removed"],
          url: "https://example.com/orphan.css",
          resource_type: "stylesheet",
        },
        {
          source_urls: [],
          url: "https://example.com/legacy.css",
          resource_type: "stylesheet",
        },
      ],
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={resultWithResourceProvenance}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Media/ }));

    expect(screen.getByText(i18n.t("crawl.resources.provenance.referenced"))).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("crawl.ui.orphaned") }));
    expect(screen.getByText("https://example.com/orphan.css")).not.toBeNull();
    expect(screen.queryByText("https://example.com/referenced.css")).toBeNull();
  });

  it("shows iframe declarations separately from unverified rendered browser frames", () => {
    const resultWithFrames = {
      ...result,
      pages: result.pages.map((page, index) =>
        index === 0
          ? {
              ...page,
              frames: [
                {
                  src: "../embed",
                  resolved_url: "https://example.com/embed",
                  title: "Player",
                  loading: "lazy",
                  sandbox: "allow-scripts",
                  checked_in_run: false,
                },
              ],
            }
          : page,
      ),
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={resultWithFrames}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Frames/ }));

    expect(screen.getByText("https://example.com/embed")).not.toBeNull();
    expect(screen.getByText(i18n.t("crawl.ui.notChecked"))).not.toBeNull();
    expect(
      screen.getByText(i18n.t("crawl.ui.framesDescription")),
    ).not.toBeNull();
  });

  it("shows schema findings with their source URL, declaration format, and property path", () => {
    const schemaResult = {
      ...result,
      pages: result.pages.map((page, index) =>
        index === 0
          ? {
              ...page,
              schema_validation_findings: [
                {
                  format: "JSON-LD",
                  declaration_index: 1,
                  finding: {
                    code: "product-name-empty-or-invalid",
                    severity: "warning" as const,
                    message:
                      "Product name is present but is not a non-empty string.",
                    path: "$.@graph[0].name",
                    recommendation: "Use the visible product name.",
                  },
                },
              ],
            }
          : page,
      ),
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={schemaResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Structured/ }));

    expect(screen.getAllByText("https://example.com/").length).toBeGreaterThan(
      0,
    );
    fireEvent.click(screen.getByText("1 finding(s)"));
    expect(screen.getByText("Warning · JSON-LD #1")).not.toBeNull();
    expect(screen.getByText("$.@graph[0].name")).not.toBeNull();
  });

  it("shows local HTML validation and charset evidence for the affected URL", () => {
    useProjectStore.setState({ activeProjectId: "project-validation" });
    const validationResult = {
      ...result,
      pages: result.pages.map((page, index) =>
        index === 0
          ? {
              ...page,
              charset: "windows-1252",
              detected_charset: "windows-1252",
              html_validation_findings: [
                {
                  code: "html-uri-invalid",
                  severity: "Warning",
                  message: "Malformed URI evidence",
                  element: "a",
                  attribute: "href",
                  value: "/bad%ZZ",
                  line: 4,
                  column: 18,
                  source_excerpt: '<a href="/bad%ZZ">bad</a>',
                },
              ],
              html_validation_truncated: false,
            }
          : page,
      ),
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={validationResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /HTML validation/ }));

    expect(screen.getAllByText("windows-1252")).toHaveLength(2);
    expect(screen.getByText(/html-uri-invalid/)).not.toBeNull();
    expect(
      screen.getByText(new RegExp(`${i18n.t("crawlDeepUi.line")} 4:18`)),
    ).not.toBeNull();
    expect(screen.getByText("/bad%ZZ")).not.toBeNull();
    expect(screen.getByText('<a href="/bad%ZZ">bad</a>')).not.toBeNull();
    expect(screen.getAllByText("https://example.com/").length).toBeGreaterThan(
      1,
    );

    const validationSearch = screen.getByRole("textbox", {
      name: i18n.t("crawl.ui.searchHtmlValidation"),
    });
    fireEvent.change(validationSearch, { target: { value: "does-not-exist" } });
    expect(
      screen.getByText(i18n.t("crawl.ui.noHtmlFindings")),
    ).not.toBeNull();
    fireEvent.change(validationSearch, { target: { value: "html-uri-invalid" } });
    expect(screen.getByText(/html-uri-invalid/)).not.toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: i18n.t("crawl.ui.validationSeverity") }), {
      target: { value: "Error" },
    });
    expect(
      screen.getByText(i18n.t("crawl.ui.noHtmlFindings")),
    ).not.toBeNull();
    const navigationKey = "seomi_project_project-validation_crawl_navigation_run-1_v1";
    expect(localStorage.getItem(navigationKey)).toContain('"validationQuery":"html-uri-invalid"');
    expect(localStorage.getItem(navigationKey)).toContain('"validationSeverity":"Error"');
  });

  it("shows image HTTP and byte data only for images checked in the selected run", () => {
    const imageResult = {
      ...result,
      pages: result.pages.map((page, index) =>
        index === 0
          ? {
              ...page,
              images: [
                {
                  src: "https://example.com/checked.webp",
                  alt: "Checked",
                  format: "webp",
                  width: 2,
                  height: 3,
                  dimensions_source: "intrinsic-data-uri",
                  lazy_loaded: false,
                  checked_in_run: true,
                  http_status: 404,
                  content_length: 4096,
                  srcset: "responsive.webp 2x",
                  srcset_resource_checks: [
                    {
                      url: "https://example.com/responsive.webp",
                      checked_in_run: true,
                      http_status: 200,
                      content_length: 2048,
                    },
                  ],
                },
                {
                  src: "https://example.com/unknown.webp",
                  alt: "Unknown",
                  format: "webp",
                  lazy_loaded: false,
                  checked_in_run: false,
                },
              ],
            }
          : page,
      ),
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={imageResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Media/ }));

    expect(screen.getByText("HTTP 404")).not.toBeNull();
    expect(screen.getByText(i18n.t("crawl.ui.notChecked"))).not.toBeNull();
    expect(screen.getByText(/4.?096 B/)).not.toBeNull();
    fireEvent.click(screen.getByText(i18n.t("uiUnits.srcsetVariants", { count: 1 })));
    expect(screen.getByText("HTTP 200")).not.toBeNull();
    expect(screen.getByText(/responsive\.webp/)).not.toBeNull();
    expect(
      screen.getByText(new RegExp(i18n.t("crawl.ui.dimensionSources.attributes"))),
    ).not.toBeNull();
    expect(screen.getByText(/intrinsic data URI/)).not.toBeNull();
  });

  it("previews stored CSS/XPath custom-search values from the selected run", () => {
    const customSearch = {
      id: "sku",
      name: "SKU",
      selectorType: "css" as const,
      query: "[data-sku]",
      resultType: "attribute" as const,
      attribute: "data-sku",
    };
    const customResult = {
      ...result,
      pages: result.pages.map((page, index) =>
        index === 0
          ? {
              ...page,
              custom_search_results: [
                {
                  id: "sku",
                  values: ["SKU-123"],
                  error: null,
                  truncated: false,
                },
              ],
            }
          : page,
      ),
    } as SiteCrawlResult;
    const customRun = {
      ...run,
      config: { ...run.config, customSearches: [customSearch] },
      result: customResult,
    } as CrawlRunRecord;
    render(
      <CrawlResultsTabs
        result={customResult}
        runs={[customRun]}
        selectedRun={customRun}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Custom search/ }));

    expect(screen.getByText("CSS: [data-sku]")).not.toBeNull();
    expect(screen.getByText("SKU-123")).not.toBeNull();
    expect(
      screen.getByText("Result unavailable in an older run"),
    ).not.toBeNull();
  });

  it("shows the effective robots user-agent, rules, sitemap directives, and blocked URL evidence", () => {
    const robotsResult = {
      ...result,
      robots_txt_status: "Loaded 1 applicable robots.txt rules",
      robots_user_agent: "SEOmiDesktopBot/1.0",
      robots_applicable_rules: [{ directive: "disallow", path: "/private" }],
      robots_agent_matrix: [
        {
          user_agent: "GPTBot",
          specific_group: true,
          applicable_rules: [{ directive: "allow", path: "/ai" }],
          crawl_delay_ms: 2000,
        },
      ],
      robots_sitemap_directives: ["https://example.com/sitemap.xml"],
      rejected_urls: [
        {
          url: "https://example.com/private/page",
          reason: "Blocked by robots.txt Disallow rule: /private",
        },
      ],
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={robotsResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    expect(screen.getByText("SEOmiDesktopBot/1.0")).not.toBeNull();
    expect(screen.getByText("DISALLOW: /private")).not.toBeNull();
    expect(screen.getByText("GPTBot")).not.toBeNull();
    expect(screen.getByText("ALLOW: /ai")).not.toBeNull();
    expect(screen.getByText("https://example.com/sitemap.xml")).not.toBeNull();
    fireEvent.click(screen.getByText(new RegExp(i18n.t("crawl.ui.rejectedUrls").replace("{{count}}", ""))));
    expect(
      screen.getByText(/Blocked by robots\.txt Disallow rule: \/private/),
    ).not.toBeNull();
  });

  it("shows HTTP and meta refresh declarations as explicit client-side redirect evidence", () => {
    const redirectResult = {
      ...result,
      pages: [
        {
          ...result.pages[0],
          client_redirects: [
            {
              source: "meta-refresh",
              declaration: "0; URL='/next'",
              delay_seconds: 0,
              target_url: "https://example.com/next",
            },
            {
              source: "http-refresh",
              declaration: '5; url="/later"',
              delay_seconds: 5,
              target_url: "https://example.com/later",
            },
          ],
        },
      ],
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={redirectResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Directives/ }));

    expect(
      screen.getByText(i18n.t("crawlDeepUi.clientRedirects", { count: 2 })),
    ).not.toBeNull();
    expect(screen.getByText(i18n.t("crawlDeepUi.mechanismMetaRefresh"))).not.toBeNull();
    expect(screen.getByText(i18n.t("crawlDeepUi.mechanismHttpRefresh"))).not.toBeNull();
    expect(screen.getByText("https://example.com/next")).not.toBeNull();
    expect(screen.getByText("https://example.com/later")).not.toBeNull();
  });

  it("shows the effective per-URL robots decision and its evidence sources", () => {
    const robotsDecisionResult = {
      ...result,
      pages: [
        {
          ...result.pages[0],
          meta_robots: "index, nofollow",
          x_robots_tag: "googlebot: noindex",
          robots_decision: {
            indexability: "noindex",
            link_following: "nofollow",
            directives: ["index", "nofollow", "noindex"],
            sources: ["meta robots", "X-Robots-Tag"],
            response_headers_available: true,
          },
        },
      ],
    } as SiteCrawlResult;

    render(
      <CrawlResultsTabs
        result={robotsDecisionResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Directives/ }));

    expect(screen.getByText(/noindex · nofollow/)).not.toBeNull();
    expect(screen.getByText(/index, nofollow, noindex/)).not.toBeNull();
    expect(screen.getByText(/meta robots, X-Robots-Tag/)).not.toBeNull();
    expect(screen.getByText(new RegExp(i18n.t("crawlDeepUi.headersAvailable")))).not.toBeNull();
  });

  it("shows pagination parameters, canonical alignment, and in-run target status", () => {
    const paginationResult = {
      ...result,
      pages: [
        {
          ...result.pages[0],
          canonical_relation: "self",
          pagination_declaration_count: 1,
          pagination_invalid_declaration_count: 0,
          pagination_canonical_alignment: "self-canonical",
          pagination_links: [
            {
              relation: "next",
              target_url: "https://example.com/articles?page=2",
              query_parameter_changes: ["page: 1 → 2"],
              http_status: 404,
              checked_in_run: true,
            },
          ],
        },
        {
          ...result.pages[1],
          pagination_declaration_count: 1,
          pagination_invalid_declaration_count: 1,
          pagination_canonical_alignment: "invalid-canonical",
          pagination_links: [],
        },
      ],
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={paginationResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /International/ }));

    expect(
      screen.getByText(i18n.t("crawlDeepUi.pagination")),
    ).not.toBeNull();
    expect(screen.getByText("self-canonical")).not.toBeNull();
    expect(screen.getByText("HTTP 404")).not.toBeNull();
    expect(screen.getByText("page: 1 → 2")).not.toBeNull();
    expect(
      screen.getByText(
        i18n.t("crawlDeepUi.invalidPaginationTarget"),
      ),
    ).not.toBeNull();
  });

  it("shows hreflang status, reciprocal result, and canonical alignment only when verified", () => {
    const hreflangResult = {
      ...result,
      pages: [
        {
          ...result.pages[0],
          document_language: "pl",
          amp_url: "https://example.com/en/amp/",
          amp_target_http_status: 404,
          amp_target_checked_in_run: true,
          hreflangs: [
            {
              language: "en",
              target_url: "https://example.com/en/",
              target_http_status: 200,
              target_checked_in_run: true,
              reciprocal_in_run: true,
              target_canonical_alignment: "self-canonical",
            },
            {
              language: "de",
              target_url: "https://outside.example/de/",
              target_http_status: null,
              target_checked_in_run: false,
              reciprocal_in_run: null,
              target_canonical_alignment: null,
            },
          ],
        },
      ],
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={hreflangResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /International/ }));

    expect(
      screen.getByText(`HTTP 200 · ${i18n.t("crawlDeepUi.yes")} · self-canonical`),
    ).not.toBeNull();
    expect(
      screen.getByText(
        `${i18n.t("crawlDeepUi.statusOutsideRun")} · ${i18n.t("crawlDeepUi.reciprocityUnchecked")} · ${i18n.t("crawlDeepUi.canonicalOutsideRun")}`,
      ),
    ).not.toBeNull();
    expect(screen.getByText(i18n.t("crawlDeepUi.ampStatus"))).not.toBeNull();
    expect(screen.getByText("HTTP 404")).not.toBeNull();
  });

  it("shows only declared favicon and social metadata without inventing or downloading preview images", () => {
    const socialResult = {
      ...result,
      pages: [
        {
          ...result.pages[0],
          favicons: ["https://example.com/favicon.svg"],
          social_meta_tags: [
            { key: "og:title", content: "Declared share title" },
            { key: "og:image", content: "https://example.com/social.png" },
            { key: "twitter:card", content: "summary_large_image" },
          ],
        },
      ],
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={socialResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Social cards/ }));

    expect(screen.getByText("Declared share title")).not.toBeNull();
    expect(screen.getByText("https://example.com/social.png")).not.toBeNull();
    expect(screen.getByText("https://example.com/favicon.svg")).not.toBeNull();
    expect(screen.getByText("summary_large_image")).not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows fetched status and byte metadata for optional social-image and favicon resource checks", () => {
    const socialResult = {
      ...result,
      pages: [
        {
          ...result.pages[0],
          favicons: ["https://example.com/favicon.svg"],
          favicon_resource_checks: [
            {
              url: "https://example.com/favicon.svg",
              checked_in_run: true,
              http_status: 200,
              content_type: "image/svg+xml",
              content_length: 512,
            },
          ],
          social_meta_tags: [
            {
              key: "og:image",
              content: "https://example.com/social.png",
              resource_check: {
                url: "https://example.com/social.png",
                checked_in_run: true,
                http_status: 404,
                content_type: "text/html",
                content_length: 91,
              },
            },
            {
              key: "twitter:image",
              content: "https://cdn.example.net/card.png",
              resource_check: {
                url: "https://cdn.example.net/card.png",
                checked_in_run: false,
              },
            },
          ],
        },
      ],
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={socialResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Social cards/ }));

    expect(screen.getByText(/HTTP 200/)).not.toBeNull();
    expect(screen.getByText(/512 B/)).not.toBeNull();
    expect(screen.getByText(/HTTP 404/)).not.toBeNull();
    expect(screen.getByText(/Not checked in this run/)).not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows favicon declaration metadata when the crawler provides it", () => {
    const socialResult = {
      ...result,
      pages: [{
        ...result.pages[0],
        favicons: ["https://example.com/favicon.svg"],
        favicon_metadata: [{
          href: "https://example.com/favicon.svg",
          rel: "icon",
          declared_type: "image/svg+xml",
          declared_sizes: "any",
          inferred_format: "svg",
        }],
      }],
    } as SiteCrawlResult;
    render(
      <CrawlResultsTabs
        result={socialResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Social cards/ }));

    expect(screen.getByText("rel=icon · type=image/svg+xml · sizes=any · format=svg")).not.toBeNull();
  });

  it("shows HTTP error filters and a genuine empty-history state", () => {
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /URL/ }));
    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.errorType")), {
      target: { value: "http" },
    });
    const pageUrlCells = screen
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
    expect(pageUrlCells).toContain("https://example.com/missing");
    expect(pageUrlCells).not.toContain("https://example.com/");

fireEvent.click(screen.getByRole("tab", { name: /Map & clusters/ }));
    expect(screen.getByRole("img", { name: i18n.t("mapUi.svgAria") })).not.toBeNull();
  });

  it("segments and searches URLs, and persists named filter presets per project", () => {
    useProjectStore.setState({ activeProjectId: "project-a" });
    const view = render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /URL/ }));

    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.httpSegment")), {
      target: { value: "4xx" },
    });
    expect(
      screen.getAllByRole("cell").map((cell) => cell.textContent),
    ).toContain("https://example.com/missing");
    expect(
      screen.getAllByRole("cell").map((cell) => cell.textContent),
    ).not.toContain("https://example.com/");

    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.httpSegment")), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.searchUrlTitle")), {
      target: { value: "Example home" },
    });
    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.savedFilterName")), {
      target: { value: "Strona główna" },
    });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("crawl.ui.saveFilter") }));
    expect(
      localStorage.getItem("seomi_project_project-a_crawl_filter_presets_v1"),
    ).toContain("Strona główna");

    view.unmount();
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /URL/ }));
    expect(
      screen.getByRole("option", { name: "Strona główna" }),
    ).not.toBeNull();
    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.searchUrlTitle")), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.savedProjectFilters")), {
      target: {
        value: screen
          .getByRole("option", { name: "Strona główna" })
          .getAttribute("value"),
      },
    });
    expect(
      screen.getAllByRole("cell").map((cell) => cell.textContent),
    ).toContain("https://example.com/");
    expect(
      screen.getAllByRole("cell").map((cell) => cell.textContent),
    ).not.toContain("https://example.com/missing");
  });

  it("filters to pages with recorded issues and opens a stable URL evidence link", () => {
    useProjectStore.setState({ activeProjectId: "project-a" });
    const healthyPage = {
      ...result.pages[0],
      url: "https://example.com/healthy",
      final_url: "https://example.com/healthy",
      title: "Healthy page",
      issues: [],
      issues_count: 0,
    };
    const testResult = {
      ...result,
      pages_crawled: 3,
      pages: [...result.pages, healthyPage],
    } as SiteCrawlResult;
    const onSelectRun = vi.fn();
    render(
      <CrawlResultsTabs
        result={testResult}
        runs={[run]}
        selectedRun={run}
        onSelectRun={onSelectRun}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /URL/ }));
    fireEvent.click(screen.getByLabelText(i18n.t("crawl.ui.onlyProblems")));
    let cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).not.toContain("https://example.com/healthy");
    expect(cells).toContain("https://example.com/missing");

    fireEvent.click(screen.getByLabelText(i18n.t("crawl.ui.onlyProblems")));
    const evidenceLink = screen.getByRole("link", {
      name: i18n.t("crawl.ui.openEvidence", { url: "https://example.com/missing" }),
    });
    expect(evidenceLink.getAttribute("href")).toContain(
      "crawl-evidence?project=project-a&run=run-1",
    );
    expect(evidenceLink.getAttribute("href")).toContain(
      "url=https%3A%2F%2Fexample.com%2Fmissing",
    );
    window.location.hash = evidenceLink.getAttribute("href")!.slice(1);
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(
      screen.getByRole("tab", { name: /URL/ }).getAttribute("aria-selected"),
    ).toBe("true");
    cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toContain("https://example.com/missing");
    expect(cells).not.toContain("https://example.com/");
    expect(onSelectRun).toHaveBeenCalledWith("run-1");
    expect(screen.getByText("Technical detail: HTTP 404 response")).not.toBeNull();
  });

  it("sorts URL rows from clickable column headers in either direction", () => {
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /URL/ }));
    const statusHeader = screen.getByRole("button", { name: "Status" });
    fireEvent.click(statusHeader);
    expect(statusHeader.closest("th")?.getAttribute("aria-sort")).toBe(
      "ascending",
    );
    fireEvent.click(statusHeader);
    expect(statusHeader.closest("th")?.getAttribute("aria-sort")).toBe(
      "descending",
    );
    const urls = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => (row as HTMLTableRowElement).cells[1].textContent);
    expect(urls[0]).toBe("https://example.com/missing");
    expect(urls[1]).toBe("https://example.com/");
  });

  it("offers a bounded external-link check and invokes it for the selected saved run", () => {
    const externalResult = {
      ...result,
      pages: [
        {
          ...result.pages[0],
          external_link_count: 1,
          links: [
            {
              target_url: "https://outside.example/path",
              anchor_text: "External",
              is_internal: false,
            },
          ],
        },
      ],
    } as SiteCrawlResult;
    const externalRun = { ...run, result: externalResult };
    const checkExternalLinks = vi.fn().mockResolvedValue(undefined);
    const originalAction = useToolsStore.getState().checkCrawlExternalLinks;
    useToolsStore.setState({ checkCrawlExternalLinks: checkExternalLinks });

    render(
      <CrawlResultsTabs
        result={externalResult}
        runs={[externalRun]}
        selectedRun={externalRun}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Links/ }));
    expect(
      screen.getByText(i18n.t("crawl.ui.externalTargetSummary", { checked: 0, blocked: 0, invalid: 0, unchecked: 1 })),
    ).not.toBeNull();
    fireEvent.change(screen.getByLabelText(i18n.t("crawl.ui.externalLinkLimit")), {
      target: { value: "500" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t("crawl.ui.checkExternalLinks"),
      }),
    );
    expect(checkExternalLinks).toHaveBeenCalledWith("run-1", 500);

    act(() =>
      useToolsStore.setState({ checkCrawlExternalLinks: originalAction }),
    );
  });

  it("distinguishes checked, broken, and unverified internal targets", () => {
    const internalResult = {
      ...result,
      pages: [
        {
          ...result.pages[0],
          links: [
            { target_url: "https://example.com/missing", anchor_text: "Broken", is_internal: true, target_http_status: 404 },
            { target_url: "https://example.com/not-crawled", anchor_text: "Unknown", is_internal: true },
          ],
        },
      ],
    } as SiteCrawlResult;
    const internalRun = { ...run, result: internalResult };

    render(
      <CrawlResultsTabs
        result={internalResult}
        runs={[internalRun]}
        selectedRun={internalRun}
        onSelectRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Links/ }));

    expect(screen.getByText(i18n.t("crawl.ui.internalTargetSummary", { unique: 2, checked: 1, broken: 1, unchecked: 1 }))).not.toBeNull();
    expect(screen.getByText(i18n.t("crawl.ui.uncheckedTargetNote"))).not.toBeNull();
  });

  it("offers a confirmed action to free storage by deleting the selected crawl run", async () => {
    const onDeleteRun = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm");
    confirm.mockReturnValue(false);
    render(
      <CrawlResultsTabs
        result={result}
        runs={[run]}
        selectedRun={run}
        onSelectRun={vi.fn()}
        onDeleteRun={onDeleteRun}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete run" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(onDeleteRun).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete run" }));
    await waitFor(() => expect(onDeleteRun).toHaveBeenCalledWith("run-1"));
    confirm.mockRestore();
  });

  it("explains which page count was retained after page-index quota recovery", () => {
    const limitedResult = {
      ...result,
      pages: result.pages.slice(0, 1),
      storage_pages_truncated: true,
      storage_pages_total: 4,
    } as SiteCrawlResult;
    const limitedRun = { ...run, result: limitedResult };
    render(
      <CrawlResultsTabs
        result={limitedResult}
        runs={[limitedRun]}
        selectedRun={limitedRun}
        onSelectRun={vi.fn()}
      />,
    );

    expect(screen.getByText(i18n.t("crawl.persistence.pageIndexNote", { retained: 1, total: 4 }))).not.toBeNull();
  });
});
