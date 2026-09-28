import { describe, expect, it } from 'vitest';
import { clusterKeywordsBySerpOverlap, normalizeSerpUrl } from '../src/services/keywordClustering';

describe('keyword SERP clustering', () => {
  it('normalizes host, trailing slash and tracking parameters without changing meaningful paths', () => {
    expect(normalizeSerpUrl('https://www.example.com/seo/?utm_source=test&b=2&a=1#section'))
      .toBe('example.com/seo?a=1&b=2');
    expect(normalizeSerpUrl('https://one.example/page')).toBe('one.example/page');
    expect(normalizeSerpUrl('https://example.com/SEO/')).toBe('example.com/SEO');
    expect(normalizeSerpUrl('javascript:alert(1)')).toBeNull();
  });

  it('forms clusters only when the configured number of actual URLs overlap', () => {
    const result = clusterKeywordsBySerpOverlap([
      { keyword: 'audyt seo', urls: ['https://a.example/', 'https://b.example/', 'https://c.example/'] },
      { keyword: 'audyt strony', urls: ['https://www.a.example', 'https://b.example/', 'https://c.example/?utm_campaign=x'] },
      { keyword: 'pozycjonowanie', urls: ['https://b.example/', 'https://c.example/'] },
      { keyword: 'lokalne seo', urls: ['https://elsewhere.example/'] },
    ], 3, '2026-09-22T10:00:00.000Z');

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].keywords).toEqual(['audyt seo', 'audyt strony']);
    expect(result.clusters[0].pairOverlaps[0].sharedUrls).toEqual([
      'a.example/', 'b.example/', 'c.example/',
    ]);
    expect(result.unclusteredKeywords).toEqual(['pozycjonowanie', 'lokalne seo']);
    expect(result.analyzedAt).toBe('2026-09-22T10:00:00.000Z');
  });

  it('allows transitive clusters but preserves only evidence-backed pair links', () => {
    const result = clusterKeywordsBySerpOverlap([
      { keyword: 'a', urls: ['https://one.example/', 'https://two.example/'] },
      { keyword: 'b', urls: ['https://one.example/', 'https://two.example/', 'https://three.example/'] },
      { keyword: 'c', urls: ['https://two.example/', 'https://three.example/'] },
    ], 2);

    expect(result.clusters[0].keywords).toEqual(['a', 'b', 'c']);
    expect(result.clusters[0].pairOverlaps).toHaveLength(2);
    expect(result.clusters[0].pairOverlaps.map((pair) => [pair.keywordA, pair.keywordB])).toEqual([['a', 'b'], ['b', 'c']]);
  });

  it('removes duplicate keywords case-insensitively and rejects invalid overlap thresholds', () => {
    const result = clusterKeywordsBySerpOverlap([
      { keyword: 'SEO', urls: ['https://one.example/'] },
      { keyword: 'seo', urls: ['https://other.example/'] },
    ], 1);
    expect(result.snapshots).toHaveLength(1);
    expect(() => clusterKeywordsBySerpOverlap([], 0)).toThrow('positive integer');
  });
});
