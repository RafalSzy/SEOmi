import { describe, expect, it } from 'vitest';
import { importUrlsFromCsv } from '@/services/csvUrls';

describe('importUrlsFromCsv', () => {
  it('uses a URL header, supports quoted cells, deduplicates, and removes fragments', () => {
    const imported = importUrlsFromCsv('Name,URL\n"Pierwsza, strona",https://example.com/a#section\nDruga,https://example.com/a\nTrzecia,https://example.com/b');

    expect(imported.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(imported.rejected).toEqual([]);
  });

  it('keeps unsupported or malformed rows visible as rejected instead of inventing a URL', () => {
    const imported = importUrlsFromCsv('https://example.com\nftp://example.com\nnie jest adresem');

    expect(imported.urls).toEqual(['https://example.com/']);
    expect(imported.rejected).toEqual(['ftp://example.com', 'nie jest adresem']);
  });
});
