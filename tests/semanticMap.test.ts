import { describe, expect, it } from 'vitest';
import type { CrawledPageSummary } from '@/types';
import { buildSemanticMap } from '@/services/semanticMap';
import i18n from '@/i18n';

const page = (url: string, terms: string[], semanticLinks: Array<{ target_url: string; anchor_text: string }> = [], navTargets: string[] = []) => ({
  url,
  final_url: url,
  semantic_terms: terms,
  semantic_links: semanticLinks.map((link) => ({ ...link, is_internal: true })),
  // Ordinary crawler links include shared header/footer links and are deliberately
  // not consulted by the semantic graph.
  links: navTargets.map((target) => ({ target_url: target, anchor_text: 'Global navigation', is_internal: true })),
} as unknown as CrawledPageSummary);

describe('buildSemanticMap', () => {
  it('clusters on content terms and builds edges only from content links', () => {
    const pages = [
      page('https://site.test/', ['espresso', 'coffee', 'grinding'], [
        { target_url: 'https://site.test/grind', anchor_text: 'grinding guide' },
      ], ['https://site.test/grind', 'https://site.test/beans']),
      page('https://site.test/grind', ['espresso', 'coffee', 'grinding', 'burr'], [], ['https://site.test/']),
      page('https://site.test/beans', ['arabica', 'harvest', 'origin']),
    ];

    const map = buildSemanticMap(pages, pages[0].url);
    expect(map.nodes[0].clusterId).toBe(map.nodes[1].clusterId);
    expect(map.nodes[2].clusterId).not.toBe(map.nodes[0].clusterId);
    expect(map.edges).toHaveLength(1);
    expect(map.edges[0]).toMatchObject({ source: 'page-0', target: 'page-1', anchors: ['grinding guide'] });
    expect(map.topicEdges).toHaveLength(1);
    expect(map.topicEdges[0].sharedTerms).toEqual(['coffee', 'espresso', 'grinding']);
    expect(map.topicEdges[0].weightedJaccard).toBeGreaterThanOrEqual(0.16);
    expect(map.nodes[2].orphan).toBe(true);
  });

  it('returns an honest empty-signal map when the crawl has no extracted content terms', () => {
    const map = buildSemanticMap([page('https://site.test/', [])], 'https://site.test/');
    expect(map.hasSemanticTerms).toBe(false);
    expect(map.clusters[0].label).toBe(i18n.t('runtimeErrors.semanticMap.noSignals'));
  });

  it('folds diacritics so equivalent terms cluster across localized content', () => {
    const pages = [
      page('https://site.test/pl', ['żółć', 'świat', 'seo']),
      page('https://site.test/en', ['zolc', 'swiat', 'seo']),
    ];

    const map = buildSemanticMap(pages, pages[0].url);

    expect(map.topicEdges).toHaveLength(1);
    expect(map.topicEdges[0].sharedTerms).toEqual(['seo', 'swiat', 'zolc']);
    expect(map.nodes[0].clusterId).toBe(map.nodes[1].clusterId);
  });

  it('can expose the complete internal link graph without changing content clusters', () => {
    const pages = [
      page('https://site.test/', ['espresso', 'coffee'], [
        { target_url: 'https://site.test/grind', anchor_text: 'guide' },
      ], ['https://site.test/grind', 'https://site.test/beans']),
      page('https://site.test/grind', ['espresso', 'coffee'], [], ['https://site.test/']),
      page('https://site.test/beans', ['arabica'], [], ['https://site.test/grind']),
    ];

    const map = buildSemanticMap(pages, pages[0].url, { includeAllInternalLinks: true });
    expect(map.edges).toHaveLength(4);
    expect(map.edges.some((edge) => edge.target === 'page-2')).toBe(true);
    expect(map.nodes[2].orphan).toBe(false);
    expect(map.nodes[0].clusterId).toBe(buildSemanticMap(pages, pages[0].url).nodes[0].clusterId);
  });

  it('matches links to redirected, slash-variant and anchored page URLs', () => {
    const pages = [
      {
        ...page('https://site.test/', ['home']),
        links: [{ target_url: 'https://site.test/article/#section', anchor_text: 'Article', is_internal: true }],
      },
      {
        ...page('https://site.test/article/', ['article']),
        final_url: 'https://site.test/article?source=redirect',
        links: [],
      },
    ] as unknown as CrawledPageSummary[];

    const map = buildSemanticMap(pages, pages[0].url, { includeAllInternalLinks: true });

    expect(map.edges).toHaveLength(1);
    expect(map.edges[0]).toMatchObject({ source: 'page-0', target: 'page-1' });
    expect(map.nodes[1].orphan).toBe(false);
  });

  it('resolves relative links from the source page and tolerates legacy missing final URLs', () => {
    const pages = [
      {
        ...page('https://site.test/guides/start', ['guide']),
        final_url: undefined,
        links: [{ target_url: '../article/#intro', anchor_text: 'Article', is_internal: true }],
      },
      {
        ...page('https://site.test/article', ['article']),
        final_url: undefined,
        links: [],
      },
    ] as unknown as CrawledPageSummary[];

    const map = buildSemanticMap(pages, pages[0].url, { includeAllInternalLinks: true });

    expect(map.edges).toHaveLength(1);
    expect(map.nodes[1].orphan).toBe(false);
  });

  it('keeps every page within the crawler limit available to the map', () => {
    const pages = Array.from({ length: 500 }, (_, index) => page(
      `https://site.test/page-${index}`,
      [`topic-${index % 4}`, `term-${index % 3}`],
    )) as unknown as CrawledPageSummary[];

    const map = buildSemanticMap(pages, pages[0].url);

    expect(map.nodes).toHaveLength(500);
    expect(map.truncated).toBe(true);
    expect(map.totalTopicEdges).toBeGreaterThan(map.topicEdges.length);
  });

  it('keeps full edge totals and incoming counts when the SVG edge cap is reached', () => {
    const pages = Array.from({ length: 500 }, (_, index) => page(
      `https://site.test/page-${index}`,
      ['shared', 'topic'],
      [],
      Array.from({ length: 12 }, (_, offset) => `https://site.test/page-${(index + offset + 1) % 500}`),
    )) as unknown as CrawledPageSummary[];

    const map = buildSemanticMap(pages, pages[0].url, { includeAllInternalLinks: true });

    expect(map.truncated).toBe(true);
    expect(map.totalEdges).toBeGreaterThan(map.edges.length);
    expect(map.totalInternalLinks).toBe(6_000);
    expect(map.nodes.reduce((sum, node) => sum + node.incomingContentLinks, 0)).toBe(map.totalInternalLinks);
  });
});
