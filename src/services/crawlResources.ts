import type { CrawledResource, SiteCrawlResult } from '@/types';

export type CrawlResourceProvenanceStatus = 'referenced' | 'partial' | 'orphaned' | 'unknown';

export interface CrawlResourceInventoryRow {
  resource: CrawledResource;
  status: CrawlResourceProvenanceStatus;
  sourceUrls: string[];
  knownSourceUrls: string[];
}

/**
 * Normalize only the identity parts that are safe for provenance matching.
 * Fragments never identify a different HTTP resource; query strings remain
 * intact because they can change the response body.
 */
export const normalizeCrawlResourceUrl = (value: string): string => {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.hash = '';
    return url.href;
  } catch {
    return value.trim();
  }
};

/**
 * Classify resource provenance against the pages retained in the same run.
 * `unknown` is intentionally different from `orphaned`: an empty/legacy
 * source list is not proof that a resource has no page source.
 */
export const buildCrawlResourceInventory = (
  result: Pick<SiteCrawlResult, 'pages' | 'resources'>,
): CrawlResourceInventoryRow[] => {
  const pageAliases = new Set(
    result.pages
      .flatMap((page) => [page.url, page.final_url])
      .map(normalizeCrawlResourceUrl)
      .filter(Boolean),
  );

  return (result.resources || []).map((resource) => {
    const sourceUrls = [...new Set((resource.source_urls || []).map(normalizeCrawlResourceUrl).filter(Boolean))];
    const knownSourceUrls = sourceUrls.filter((sourceUrl) => pageAliases.has(sourceUrl));
    const status: CrawlResourceProvenanceStatus = sourceUrls.length === 0
      ? 'unknown'
      : knownSourceUrls.length === sourceUrls.length
        ? 'referenced'
        : knownSourceUrls.length > 0
          ? 'partial'
          : 'orphaned';
    return { resource, status, sourceUrls, knownSourceUrls };
  });
};

