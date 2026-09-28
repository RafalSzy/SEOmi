import { MAX_AUDIT_URL_LENGTH, readResponseTextLimited, requestPinnedPublicTarget, validatePublicTarget } from './httpSafety.js';

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_SEMANTIC_TERMS = 40;
const MAX_SEMANTIC_LINKS = 1_000;
const SEMANTIC_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'have', 'has', 'into', 'your', 'you', 'but',
  'oraz', 'jest', 'są', 'dla', 'z', 'ze', 'do', 'na', 'w', 'we', 'i', 'a', 'to', 'ten', 'ta', 'te', 'jak', 'lub', 'nie',
]);

const extract = (html: string, expression: RegExp): string[] => Array.from(html.matchAll(expression), (match) => match[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '').filter(Boolean);

export interface PublicAuditResult {
  requested_url: string;
  final_url: string;
  status: number;
  response_body_truncated: boolean;
  response_time_ms: number;
  redirects: string[];
  title: string | null;
  meta_description: string | null;
  canonical: string | null;
  robots: string | null;
  open_graph: Record<string, string | null>;
  headings: Record<string, string[]>;
  security_headers: Record<string, string | null>;
  discovered_links: string[];
  discovered_links_truncated: boolean;
  semantic_terms: string[];
  semantic_links: string[];
  semantic_content_source: 'primary-root' | 'body-fallback' | 'unavailable';
}

export interface PublicAuditOptions {
  scopeHost?: string;
  allowSubdomains?: boolean;
  /** Optional path prefix that limits the crawl/audit scope. */
  scopePath?: string;
  /** Bounded glob-like pathname filters shared by CLI, API and MCP. */
  includePatterns?: string[];
  excludePatterns?: string[];
}

export interface PublicCrawlPage {
  depth: number;
  audit: PublicAuditResult;
}

export interface PublicCrawlError {
  url: string;
  depth: number;
  error: string;
}

export interface PublicCrawlResult {
  requested_url: string;
  scope_host: string;
  allow_subdomains: boolean;
  max_pages: number;
  max_depth: number;
  scope_path: string | null;
  include_patterns: string[];
  exclude_patterns: string[];
  pages: PublicCrawlPage[];
  errors: PublicCrawlError[];
  discovered_urls: number;
  truncated: boolean;
}

const MAX_DISCOVERED_LINKS = 2_000;
const MAX_CRAWL_ERRORS = 50;

const normalizeCrawlUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  return url.toString();
};

const MAX_SCOPE_PATTERNS = 20;
const MAX_SCOPE_PATTERN_LENGTH = 200;

const normalizeScopePath = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim() || '';
  if (!trimmed) return undefined;
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return path.length > 1 ? path.replace(/\/+$/u, '') : '/';
};

const normalizePatterns = (values: string[] | undefined): string[] => [...new Set((values || [])
  .map((value) => value.trim())
  .filter(Boolean))].slice(0, MAX_SCOPE_PATTERNS);

export const validatePublicScopeOptions = (options: PublicAuditOptions): void => {
  if (options.scopePath !== undefined && (typeof options.scopePath !== 'string' || options.scopePath.length > 2048 || /[\u0000-\u001f]/u.test(options.scopePath))) {
    throw new Error('scope_path must be a safe path up to 2048 characters.');
  }
  for (const [name, values] of [['includePatterns', options.includePatterns], ['excludePatterns', options.excludePatterns] as const]) {
    if (values !== undefined && (!Array.isArray(values) || values.length > MAX_SCOPE_PATTERNS || values.some((value) => typeof value !== 'string' || value.length > MAX_SCOPE_PATTERN_LENGTH || /[\u0000-\u001f]/u.test(value)))) {
      throw new Error(`${name} must contain at most ${MAX_SCOPE_PATTERNS} safe patterns of ${MAX_SCOPE_PATTERN_LENGTH} characters.`);
    }
  }
};

const globMatchesPath = (pathname: string, pattern: string): boolean => {
  const normalized = pattern.startsWith('/') ? pattern : `/${pattern}`;
  const expression = normalized.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')).join('.*');
  try { return new RegExp(`^${expression}$`, 'u').test(pathname); } catch { return false; }
};

export const extractPublicLinks = (html: string, baseUrl: URL): { links: string[]; truncated: boolean } => {
  const links = new Set<string>();
  let truncated = false;
  const expression = /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1/gi;
  for (const match of html.matchAll(expression)) {
    const raw = match[2]?.trim();
    if (!raw || links.size >= MAX_DISCOVERED_LINKS) {
      if (raw) truncated = true;
      continue;
    }
    try {
      const target = new URL(raw, baseUrl);
      if (!['http:', 'https:'].includes(target.protocol)) continue;
      target.hash = '';
      links.add(normalizeCrawlUrl(target.toString()));
    } catch {
      // Ignore malformed href values; the audit must never invent a URL.
    }
  }
  return { links: [...links], truncated };
};

const isHiddenOrChrome = (attributes: string): boolean => {
  const normalized = attributes.toLocaleLowerCase();
  return /\bhidden\b|\binert\b|aria-hidden\s*=\s*["']?(?:true|1)|role\s*=\s*["']?(?:banner|navigation|contentinfo|complementary|form|search)\b|(?:display|visibility|content-visibility)\s*:\s*hidden|(?:class|id)\s*=\s*(?:["'][^"']*(?:header|nav|footer|sidebar|breadcrumb|cookie|consent|banner)[^"']*["']|[^\s>]*(?:header|nav|footer|sidebar|breadcrumb|cookie|consent|banner)[^\s>]*)/.test(normalized);
};

const removeElementBlocks = (html: string, tags: string): string => html.replace(new RegExp(`<(${tags})\\b([^>]*)>[\\s\\S]*?<\\/\\1>`, 'gi'), ' ');

/**
 * Remove complete hidden/chrome element blocks before extracting semantic
 * content.  A simple opening-tag replacement leaves navigation text and
 * links in the document, which is particularly misleading for semantic
 * clusters.  A few bounded passes handle common nested wrappers without
 * turning this local, deterministic extractor into an unbounded parser.
 */
const removeHiddenBlocks = (html: string): string => {
  let result = html;
  // Restrict the block expression itself to hidden/chrome opening tags. If
  // it matched every element and merely decided in a callback, an outer
  // <html>/<body> match would consume the whole document and skip nested
  // hidden blocks.
  const hiddenBlock = /<([a-z][a-z0-9-]*)\b(?=[^>]*(?:\bhidden\b|\binert\b|aria-hidden\s*=\s*["']?(?:true|1)|role\s*=\s*["']?(?:banner|navigation|contentinfo|complementary|form|search)\b|(?:display|visibility|content-visibility)\s*:\s*hidden|(?:class|id)\s*=\s*(?:["'][^"']*(?:header|nav|footer|sidebar|breadcrumb|cookie|consent|banner)[^"']*["']|[^\s>]*(?:header|nav|footer|sidebar|breadcrumb|cookie|consent|banner)[^\s>]*)))[^>]*>[\s\S]*?<\/\1\s*>/gi;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = result.replace(hiddenBlock, ' ');
    if (next === result) break;
    result = next;
  }
  // Void elements and malformed/unclosed blocks still need their hidden
  // opening tags stripped; they do not contain a block to consume.
  return result.replace(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi, (full, _tag, attributes) => (
    isHiddenOrChrome(attributes || '') ? ' ' : full
  ));
};

const decodeText = (value: string): string => value
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;|&#34;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'");

export const extractSemanticSignals = (html: string, baseUrl: URL): {
  terms: string[];
  links: string[];
  source: PublicAuditResult['semantic_content_source'];
} => {
  const withoutRuntime = removeElementBlocks(html, 'script|style|noscript|template|svg');
  const primaryCandidates = [...withoutRuntime.matchAll(/<(main|article)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)]
    .filter((match) => !isHiddenOrChrome(match[2] || ''));
  const source = primaryCandidates[0]?.[3]
    ? 'primary-root'
    : 'body-fallback';
  const selected = primaryCandidates[0]?.[3] || withoutRuntime;
  const content = removeHiddenBlocks(removeElementBlocks(selected, 'header|nav|footer|aside|form'));
  const text = decodeText(content.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (!text) return { terms: [], links: [], source: 'unavailable' };
  const counts = new Map<string, number>();
  for (const token of text.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) || []) {
    if (SEMANTIC_STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  const terms = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_SEMANTIC_TERMS)
    .map(([term]) => term);
  const links = extractPublicLinks(content, baseUrl).links.slice(0, MAX_SEMANTIC_LINKS);
  return { terms, links, source };
};

export const isUrlWithinScope = (url: URL, options: PublicAuditOptions): boolean => {
  if (options.scopePath) {
    const scopePath = normalizeScopePath(options.scopePath);
    if (scopePath && !(url.pathname === scopePath || url.pathname.startsWith(`${scopePath.replace(/\/$/u, '')}/`))) return false;
  }
  const includePatterns = normalizePatterns(options.includePatterns);
  const excludePatterns = normalizePatterns(options.excludePatterns);
  if (includePatterns.length && !includePatterns.some((pattern) => globMatchesPath(url.pathname, pattern))) return false;
  if (excludePatterns.some((pattern) => globMatchesPath(url.pathname, pattern))) return false;
  if (!options.scopeHost) return true;
  const scopeHost = options.scopeHost.trim().toLocaleLowerCase().replace(/^\.+|\.+$/g, '');
  const hostname = url.hostname.toLocaleLowerCase().replace(/^\.+|\.+$/g, '');
  return Boolean(scopeHost) && (hostname === scopeHost || Boolean(options.allowSubdomains && hostname.endsWith(`.${scopeHost}`)));
};

const assertScope = (url: URL, options: PublicAuditOptions): void => {
  if (!isUrlWithinScope(url, options)) {
    const scopeHost = options.scopeHost?.trim().replace(/^\.+|\.+$/g, '') || 'invalid';
    throw new Error(`URL is outside the requested scope host (${scopeHost}).`);
  }
};

/** Shared public-URL workflow used by both MCP and the local CLI. */
export const auditPublicUrl = async (value: string, timeoutMs: number, options: PublicAuditOptions = {}): Promise<PublicAuditResult> => {
  validatePublicScopeOptions(options);
  let target = await validatePublicTarget(value);
  assertScope(target.url, options);
  const redirects: string[] = [];
  const started = performance.now();
  for (let step = 0; step <= 5; step += 1) {
    const response = await requestPinnedPublicTarget(target, timeoutMs);
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      redirects.push(target.url.toString());
      const nextUrl = new URL(response.headers.get('location')!, target.url).toString();
      await response.body?.cancel();
      target = await validatePublicTarget(nextUrl);
      assertScope(target.url, options);
      continue;
    }
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_BODY_BYTES) throw new Error(`Response body exceeds ${MAX_BODY_BYTES} bytes.`);
    const { text: body, truncated: bodyTruncated } = await readResponseTextLimited(response, MAX_BODY_BYTES);
    const contentType = response.headers.get('content-type')?.toLocaleLowerCase() || '';
    const isHtml = !contentType || contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
    const meta = (name: string) => new RegExp(`<meta[^>]+(?:name|property)=["']${name.replace(':', '\\:')}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name.replace(':', '\\:')}["']`, 'gi');
    const firstMeta = (name: string) => extract(body, meta(name)).at(0) || null;
    const discovered = extractPublicLinks(body, target.url);
    const semantic = bodyTruncated || !isHtml ? { terms: [], links: [], source: 'unavailable' as const } : extractSemanticSignals(body, target.url);
    return {
      requested_url: value,
      final_url: target.url.toString(),
      status: response.status,
      response_body_truncated: bodyTruncated,
      response_time_ms: Math.round(performance.now() - started),
      redirects,
      title: extract(body, /<title[^>]*>([\s\S]*?)<\/title>/gi).at(0) || null,
      meta_description: firstMeta('description'),
      canonical: extract(body, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/gi).at(0) || null,
      robots: firstMeta('robots'),
      open_graph: Object.fromEntries(['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].map((name) => [name, firstMeta(name)])),
      headings: Object.fromEntries([1, 2, 3, 4, 5, 6].map((level) => [`h${level}`, extract(body, new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi'))])),
      security_headers: Object.fromEntries(['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy'].map((header) => [header, response.headers.get(header)])),
      discovered_links: discovered.links,
      discovered_links_truncated: discovered.truncated,
      semantic_terms: semantic.terms,
      semantic_links: semantic.links,
      semantic_content_source: semantic.source,
    };
  }
  throw new Error('Redirect limit exceeded.');
};

export type PublicAuditRunner = (url: string, timeoutMs: number, options: PublicAuditOptions) => Promise<PublicAuditResult>;
export type PublicTargetValidator = (value: string) => ReturnType<typeof validatePublicTarget>;

/**
 * Crawl a bounded public site for MCP/CLI callers. Every discovered URL is
 * revalidated by auditPublicUrl, so redirects and DNS changes cannot bypass
 * the same SSRF and scope policy used by the single-page audit.
 */
export const crawlPublicSite = async (
  value: string,
  timeoutMs: number,
  maxPages: number,
  maxDepth: number,
  options: PublicAuditOptions = {},
  runner: PublicAuditRunner = auditPublicUrl,
  validateStart: PublicTargetValidator = validatePublicTarget,
): Promise<PublicCrawlResult> => {
  validatePublicScopeOptions(options);
  const start = await validateStart(value);
  const scopeHost = (options.scopeHost || start.url.hostname).trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  const allowSubdomains = Boolean(options.allowSubdomains);
  const scopeOptions = {
    ...options,
    scopeHost,
    allowSubdomains,
    scopePath: normalizeScopePath(options.scopePath),
    includePatterns: normalizePatterns(options.includePatterns),
    excludePatterns: normalizePatterns(options.excludePatterns),
  };
  assertScope(start.url, scopeOptions);
  const boundedPages = Math.min(Math.max(Math.trunc(maxPages), 1), 100);
  const boundedDepth = Math.min(Math.max(Math.trunc(maxDepth), 0), 10);
  const queue: Array<{ url: string; depth: number }> = [{ url: normalizeCrawlUrl(start.url.toString()), depth: 0 }];
  const queued = new Set(queue.map((item) => item.url));
  const pages: PublicCrawlPage[] = [];
  const errors: PublicCrawlError[] = [];
  let discoveredUrls = 1;
  let truncated = false;

  while (queue.length && pages.length < boundedPages) {
    const current = queue.shift()!;
    try {
      const audit = await runner(current.url, timeoutMs, scopeOptions);
      pages.push({ depth: current.depth, audit });
      if (current.depth >= boundedDepth) continue;
      for (const candidate of audit.discovered_links) {
        if (queued.has(candidate)) continue;
        let parsed: URL;
        try { parsed = new URL(candidate); } catch { continue; }
        if (!isUrlWithinScope(parsed, scopeOptions)) continue;
        queued.add(candidate);
        discoveredUrls += 1;
        if (queue.length + pages.length >= boundedPages) {
          truncated = true;
          break;
        }
        queue.push({ url: candidate, depth: current.depth + 1 });
      }
      if (audit.discovered_links_truncated) truncated = true;
    } catch (error) {
      errors.push({ url: current.url, depth: current.depth, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (queue.length) truncated = true;
  return {
    requested_url: value,
    scope_host: scopeHost,
    allow_subdomains: allowSubdomains,
    max_pages: boundedPages,
    max_depth: boundedDepth,
    scope_path: scopeOptions.scopePath || null,
    include_patterns: scopeOptions.includePatterns || [],
    exclude_patterns: scopeOptions.excludePatterns || [],
    pages,
    errors: errors.slice(0, MAX_CRAWL_ERRORS),
    discovered_urls: discoveredUrls,
    truncated,
  };
};

export const DEFAULT_AUDIT_TIMEOUT_MS = 15_000;
export { MAX_AUDIT_URL_LENGTH };
