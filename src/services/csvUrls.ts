export interface CsvUrlImport {
  urls: string[];
  rejected: string[];
}

const parseRows = (csv: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(value.trim());
      value = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && csv[index + 1] === '\n') index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

const normalizeUrl = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

const URL_HEADERS = new Set(['url', 'adres', 'address', 'page', 'link', 'website', 'website url']);

/**
 * Reads URLs from a local CSV without uploading it. A URL-like header is used
 * when present; otherwise every cell is considered so an exported one-column
 * file and a simple pasted CSV work equally well.
 */
export const importUrlsFromCsv = (csv: string): CsvUrlImport => {
  const rows = parseRows(csv);
  if (!rows.length) return { urls: [], rejected: [] };
  const headerIndex = rows[0].findIndex((value) => URL_HEADERS.has(value.toLocaleLowerCase()));
  const sourceRows = headerIndex >= 0 ? rows.slice(1) : rows;
  const seen = new Set<string>();
  const urls: string[] = [];
  const rejected: string[] = [];

  for (const row of sourceRows) {
    const candidates = headerIndex >= 0 ? [row[headerIndex] || ''] : row;
    let rowAccepted = false;
    for (const candidate of candidates) {
      const normalized = normalizeUrl(candidate);
      if (!normalized) continue;
      rowAccepted = true;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    }
    if (!rowAccepted && row.some((value) => value.trim())) {
      rejected.push(row.join(', '));
    }
  }
  return { urls, rejected };
};
