# SEOmi MCP server

Local stdio MCP server for macOS and Windows. It exposes eighteen read-only tools:

- `seomi_audit_url` — public URL audit with private-network blocking.
- `seomi_crawl_site` — bounded multi-page public crawl with host/subdomain scope, per-URL errors, explicit truncation, and deterministic content-only semantic signals (top terms and links from `<main>`/`<article>` or a cautious body fallback).
- `seomi_gsc_search_analytics` — first-party Search Console analytics by date/dimension.
- `seomi_gsc_url_inspection` — first-party Search Console URL inspection.
- `seomi_research_keywords` — live DataForSEO keyword metrics.
- `seomi_research_keyword_suggestions` — live DataForSEO keyword ideas and monthly history.
- `seomi_research_serp` — live Google SERP via DataForSEO.
- `seomi_track_rank` — live point-in-time domain rank match from Google SERP.
- `seomi_pagespeed_insights` — bounded Lighthouse/PageSpeed analysis for a public URL (requires a Google API key).
- `seomi_crux` — field Core Web Vitals from Chrome UX Report (requires a Google API key).
- `seomi_research_backlinks` — live backlink summary via DataForSEO.
- `seomi_research_backlink_anchors` — bounded live anchor-text distribution via DataForSEO.
- `seomi_research_backlink_pages` — bounded live backlink rows with source and target URLs via DataForSEO.
- `seomi_research_backlink_gap` — bounded competitor backlink intersection via DataForSEO.
- `seomi_research_domain_overview` — live domain visibility metrics via DataForSEO Labs.
- `seomi_research_top_pages` — live top organic pages via DataForSEO Labs.
- `seomi_research_ranked_keywords` — live ranked keywords and SERP positions via DataForSEO Labs.
- `seomi_research_domain_competitors` — live organic competitors via DataForSEO Labs.

Build it once with `npm install && npm run build` in this directory. Configure a client with `node` as the command and the absolute path to `dist/index.js` as its sole argument. Set `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` only in the client process environment; neither value belongs in a client config committed to source control.

The same public-URL audit is available as a read-only local CLI. After building, run `node dist/cli.js audit --url https://example.com`. Use `--scope-host example.com` to constrain the request to one host, optionally with `--allow-subdomains`, `--scope-path /docs`, repeated `--include '/docs*'`, or repeated `--exclude '/docs/private/*'`. The CLI shares MCP DNS/SSRF validation, redirect and body limits, and writes JSON only to stdout; failures are written to stderr with a non-zero exit code.

For desktop integrations that cannot use stdio, start the loopback-only JSON API with `SEOMI_LOCAL_API_TOKEN` (at least 16 characters):

```sh
SEOMI_LOCAL_API_TOKEN="use-a-random-local-token" npm run local-api
```

The process prints a JSON line containing its randomly selected port. `GET /health`, `POST /v1/audit`, and `POST /v1/crawl` require `Authorization: Bearer <token>`. The audit body accepts `url`; the crawl body accepts `start_url`, `max_pages` (1–100), and `max_depth` (0–10). Both accept optional `timeout_ms` (1000–30000), `scope_host`, `allow_subdomains`, `scope_path`, `include_patterns`, and `exclude_patterns` (at most 20 bounded patterns); requests are limited to 64 KiB and the server binds only to `127.0.0.1`. Set `SEOMI_LOCAL_API_PORT` when a fixed local port is required. Semantic output is marked `primary-root`, `body-fallback`, or `unavailable`; truncated/non-HTML responses never produce synthetic semantic data.

DataForSEO language inputs accept ISO-639 codes and locale-qualified BCP-47 values (for example `pl`, `zh-CN`, and `zh-TW`). Search Console URL Inspection uses the same format and defaults to `en-US`.

`seomi_audit_url` and `seomi_crawl_site` do not require provider credentials. The research tools return an actionable error if the DataForSEO variables are absent. Search Console tools require `GOOGLE_ACCESS_TOKEN`; PageSpeed and CrUX require `GOOGLE_API_KEY` (or the compatibility alias `GOOGLE_PAGESPEED_API_KEY`) in the MCP process environment. Credentials are never written to generated client configuration or returned in tool output.
