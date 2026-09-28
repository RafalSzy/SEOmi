#!/usr/bin/env node
import { auditPublicUrl, crawlPublicSite, DEFAULT_AUDIT_TIMEOUT_MS, validatePublicScopeOptions } from './auditWorkflow.js';

const usage = `SEOmi local CLI

Usage:
  seomi audit --url https://example.com [--timeout-ms 15000]
              [--scope-host example.com] [--scope-path /docs]
              [--include '/docs/*'] [--exclude '/docs/private/*'] [--allow-subdomains]
  seomi crawl --url https://example.com [--max-pages 25] [--max-depth 3]
              [--timeout-ms 15000] [--scope-host example.com] [--scope-path /docs]
              [--include '/docs/*'] [--exclude '/docs/private/*'] [--allow-subdomains]

The audit and crawl commands are read-only, block private/special network
targets, pin DNS to validated public addresses, limit redirects/body size, and
write JSON to stdout. Crawl limits are 1-100 pages and depth 0-10.
`;

const option = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
};

const options = (args: string[], name: string): string[] => {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    values.push(value);
  }
  return values;
};

const printHelp = (): never => {
  process.stdout.write(usage);
  process.exit(0);
};

const run = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) printHelp();
  const [command] = args;
  if (command !== 'audit' && command !== 'crawl') throw new Error(`Unknown command: ${command}. Use --help.`);
  const url = option(args, '--url');
  if (!url) throw new Error(`${command} requires --url. Use --help.`);
  const rawTimeout = option(args, '--timeout-ms');
  const timeoutMs = rawTimeout === undefined ? DEFAULT_AUDIT_TIMEOUT_MS : Number(rawTimeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error('--timeout-ms must be an integer between 1000 and 30000.');
  }
  const scope = {
    scopeHost: option(args, '--scope-host'),
    allowSubdomains: args.includes('--allow-subdomains'),
    scopePath: option(args, '--scope-path'),
    includePatterns: options(args, '--include'),
    excludePatterns: options(args, '--exclude'),
  };
  validatePublicScopeOptions(scope);
  let result;
  if (command === 'audit') {
    result = await auditPublicUrl(url, timeoutMs, scope);
  } else {
    const maxPages = Number(option(args, '--max-pages') ?? 25);
    const maxDepth = Number(option(args, '--max-depth') ?? 3);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('--max-pages must be an integer between 1 and 100.');
    if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 10) throw new Error('--max-depth must be an integer between 0 and 10.');
    result = await crawlPublicSite(url, timeoutMs, maxPages, maxDepth, scope);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
