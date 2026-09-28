export type CrawlErrorFilter = 'all' | 'http' | string;

export interface CrawlErrorRecord {
  http_status?: number;
  request_error_kind?: string | null;
}

const ERROR_ORDER = ['http', 'dns', 'tls', 'connect', 'timeout', 'network'];

export const crawlErrorKinds = (records: CrawlErrorRecord[]): string[] => {
  const kinds = new Set<string>();
  records.forEach((record) => {
    if (record.http_status !== undefined && record.http_status >= 400) kinds.add('http');
    if (record.request_error_kind) kinds.add(record.request_error_kind.toLowerCase());
  });
  return [...kinds].sort((left, right) => {
    const leftOrder = ERROR_ORDER.indexOf(left);
    const rightOrder = ERROR_ORDER.indexOf(right);
    if (leftOrder === -1 && rightOrder === -1) return left.localeCompare(right);
    if (leftOrder === -1) return 1;
    if (rightOrder === -1) return -1;
    return leftOrder - rightOrder;
  });
};

export const filterCrawlErrors = <T extends CrawlErrorRecord>(records: T[], filter: CrawlErrorFilter): T[] => {
  if (filter === 'all') return records;
  if (filter === 'http') return records.filter((record) => record.http_status !== undefined && record.http_status >= 400);
  return records.filter((record) => record.request_error_kind?.toLowerCase() === filter);
};

export const crawlErrorLabel = (kind: string): string => {
  const key = `crawl.ui.errorKinds.${kind}`;
  return i18n.exists(key) ? i18n.t(key) : kind.toUpperCase();
};
import i18n from '@/i18n';
