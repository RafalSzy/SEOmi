import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { auditPublicUrl, crawlPublicSite, DEFAULT_AUDIT_TIMEOUT_MS, validatePublicScopeOptions, type PublicAuditOptions, type PublicAuditResult, type PublicCrawlResult } from './auditWorkflow.js';

export const LOCAL_API_HOST = '127.0.0.1';
export const LOCAL_API_MAX_BODY_BYTES = 64 * 1024;
const MIN_TOKEN_LENGTH = 16;

type AuditRunner = (url: string, timeoutMs: number, options: PublicAuditOptions) => Promise<PublicAuditResult>;
type CrawlRunner = (url: string, timeoutMs: number, maxPages: number, maxDepth: number, options: PublicAuditOptions) => Promise<PublicCrawlResult>;

export interface LocalApiOptions {
  token: string;
  port?: number;
  audit?: AuditRunner;
  crawl?: CrawlRunner;
}

export interface LocalApiHandle {
  host: typeof LOCAL_API_HOST;
  port: number;
  server: Server;
  close: () => Promise<void>;
}

const json = (response: ServerResponse, status: number, payload: Record<string, unknown>): void => {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-length', Buffer.byteLength(body));
  response.end(body);
};

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > LOCAL_API_MAX_BODY_BYTES) {
    throw Object.assign(new Error('Request body exceeds the local API limit.'), { statusCode: 413 });
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > LOCAL_API_MAX_BODY_BYTES) {
      throw Object.assign(new Error('Request body exceeds the local API limit.'), { statusCode: 413 });
    }
    chunks.push(buffer);
  }
  if (bytes === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 });
  }
};

const authorized = (request: IncomingMessage, token: string): boolean => {
  const header = request.headers.authorization || '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
};

const validateOptions = (options: LocalApiOptions): void => {
  if (options.token.trim().length < MIN_TOKEN_LENGTH) throw new Error(`Local API token must contain at least ${MIN_TOKEN_LENGTH} characters.`);
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('Local API port must be an integer between 0 and 65535.');
};

const handleRequest = async (request: IncomingMessage, response: ServerResponse, token: string, audit: AuditRunner, crawl: CrawlRunner): Promise<void> => {
  if (!authorized(request, token)) {
    json(response, 401, { error: 'Bearer authentication required.' });
    return;
  }
  if (request.method === 'GET' && request.url === '/health') {
    json(response, 200, { ok: true, service: 'seomi-local-api', host: LOCAL_API_HOST });
    return;
  }
  if (request.method !== 'POST' || !['/v1/audit', '/v1/crawl'].includes(request.url || '')) {
    response.setHeader('allow', 'GET, POST');
    json(response, 404, { error: 'Route not found.' });
    return;
  }
  try {
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Request body must be a JSON object.'), { statusCode: 400 });
    const payload = body as Record<string, unknown>;
    const isCrawl = request.url === '/v1/crawl';
    const urlField = isCrawl ? 'start_url' : 'url';
    if (typeof payload[urlField] !== 'string' || (payload[urlField] as string).trim().length === 0) throw Object.assign(new Error(`Request body requires a non-empty ${urlField}.`), { statusCode: 400 });
    const timeoutMs = payload.timeout_ms === undefined ? DEFAULT_AUDIT_TIMEOUT_MS : Number(payload.timeout_ms);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) throw Object.assign(new Error('timeout_ms must be an integer between 1000 and 30000.'), { statusCode: 400 });
    if (payload.scope_host !== undefined && typeof payload.scope_host !== 'string') throw Object.assign(new Error('scope_host must be a string.'), { statusCode: 400 });
    if (payload.allow_subdomains !== undefined && typeof payload.allow_subdomains !== 'boolean') throw Object.assign(new Error('allow_subdomains must be a boolean.'), { statusCode: 400 });
    if (payload.scope_path !== undefined && typeof payload.scope_path !== 'string') throw Object.assign(new Error('scope_path must be a string.'), { statusCode: 400 });
    for (const field of ['include_patterns', 'exclude_patterns']) {
      if (payload[field] !== undefined && (!Array.isArray(payload[field]) || (payload[field] as unknown[]).some((value) => typeof value !== 'string'))) {
        throw Object.assign(new Error(`${field} must be an array of strings.`), { statusCode: 400 });
      }
    }
    const scope: PublicAuditOptions = {
      scopeHost: payload.scope_host as string | undefined,
      allowSubdomains: payload.allow_subdomains as boolean | undefined,
    };
    if (payload.scope_path !== undefined) scope.scopePath = payload.scope_path as string;
    if (payload.include_patterns !== undefined) scope.includePatterns = payload.include_patterns as string[];
    if (payload.exclude_patterns !== undefined) scope.excludePatterns = payload.exclude_patterns as string[];
    try { validatePublicScopeOptions(scope); } catch (error) { throw Object.assign(error instanceof Error ? error : new Error(String(error)), { statusCode: 400 }); }
    let result: PublicAuditResult | PublicCrawlResult;
    if (isCrawl) {
      const maxPages = payload.max_pages === undefined ? 25 : Number(payload.max_pages);
      const maxDepth = payload.max_depth === undefined ? 3 : Number(payload.max_depth);
      if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw Object.assign(new Error('max_pages must be an integer between 1 and 100.'), { statusCode: 400 });
      if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 10) throw Object.assign(new Error('max_depth must be an integer between 0 and 10.'), { statusCode: 400 });
      result = await crawl(payload[urlField] as string, timeoutMs, maxPages, maxDepth, scope);
    } else {
      result = await audit(payload[urlField] as string, timeoutMs, scope);
    }
    json(response, 200, { ok: true, result });
  } catch (error) {
    const statusCode = typeof error === 'object' && error && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 422;
    json(response, statusCode, { error: error instanceof Error ? error.message : String(error) });
  }
};

export const startLocalApi = async (options: LocalApiOptions): Promise<LocalApiHandle> => {
  validateOptions(options);
  const audit = options.audit || auditPublicUrl;
  const crawl = options.crawl || crawlPublicSite;
  const server = createServer((request, response) => {
    void handleRequest(request, response, options.token, audit, crawl).catch(() => {
      if (!response.headersSent) json(response, 500, { error: 'Local API request failed.' });
      else response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port ?? 0, LOCAL_API_HOST);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Local API did not expose a TCP port.');
  }
  return {
    host: LOCAL_API_HOST,
    port: address.port,
    server,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};
