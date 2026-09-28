import { describe, expect, it } from 'vitest';
import { buildCrawlResourceInventory } from '@/services/crawlResources';

describe('crawl resource provenance inventory', () => {
  const result = {
    pages: [
      { url: 'https://example.com/', final_url: 'https://example.com/home' },
      { url: 'https://example.com/contact#top', final_url: 'https://example.com/contact' },
    ],
    resources: [
      { url: 'https://example.com/app.css', resource_type: 'stylesheet', source_urls: ['https://example.com/'] },
      { url: 'https://example.com/mixed.js', resource_type: 'script', source_urls: ['https://example.com/', 'https://example.com/missing'] },
      { url: 'https://example.com/orphan.png', resource_type: 'image', source_urls: ['https://example.com/removed'] },
      { url: 'https://example.com/legacy.bin', resource_type: 'other', source_urls: [] },
    ],
  } as never;

  it('matches requested and final page aliases without treating fragments as different pages', () => {
    const rows = buildCrawlResourceInventory(result);
    expect(rows.map((row) => row.status)).toEqual(['referenced', 'partial', 'orphaned', 'unknown']);
    expect(rows[1].knownSourceUrls).toEqual(['https://example.com/']);
  });

  it('does not discard query strings when matching resource provenance', () => {
    const rows = buildCrawlResourceInventory({
      pages: [{ url: 'https://example.com/page?variant=a', final_url: 'https://example.com/page?variant=a' }],
      resources: [{ url: 'https://example.com/image.png', resource_type: 'image', source_urls: ['https://example.com/page?variant=b'] }],
    } as never);
    expect(rows[0].status).toBe('orphaned');
  });
});

