import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('discovers the server tool names and JSON Schemas over MCP stdio without calling a tool', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'] });
  const client = new Client({ name: 'seomi-mcp-smoke-test', version: '1.0.0' });
  await client.connect(transport);
  const result = await client.listTools();
  assert.deepEqual(result.tools.map((tool) => tool.name).sort(), [
    'seomi_audit_url',
    'seomi_crawl_site',
    'seomi_crux',
    'seomi_gsc_search_analytics',
    'seomi_gsc_url_inspection',
    'seomi_pagespeed_insights',
    'seomi_research_backlink_anchors',
    'seomi_research_backlink_gap',
    'seomi_research_backlink_pages',
    'seomi_research_backlinks',
    'seomi_research_domain_competitors',
    'seomi_research_domain_overview',
    'seomi_research_keyword_suggestions',
    'seomi_research_keywords',
    'seomi_research_ranked_keywords',
    'seomi_research_serp',
    'seomi_research_top_pages',
    'seomi_track_rank',
  ]);
  for (const tool of result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.description.length > 0);
  }
  const audit = result.tools.find((tool) => tool.name === 'seomi_audit_url');
  assert.equal(audit.inputSchema.properties.url.type, 'string');

  // DataForSEO supports ISO-639 codes and locale-qualified BCP-47 values;
  // Search Console URL Inspection defaults to the same locale shape. Verify
  // every exposed language picker publishes one consistent schema.
  const languageTools = result.tools.filter((tool) => tool.inputSchema.properties?.language_code);
  assert.ok(languageTools.length >= 8);
  for (const tool of languageTools) {
    const schema = tool.inputSchema.properties.language_code;
    assert.equal(schema.type, 'string');
    assert.equal(schema.maxLength, 35);
    const pattern = new RegExp(schema.pattern);
    for (const value of ['pl', 'zh-CN', 'zh-TW', 'en-US', 'sr-Latn-RS']) {
      assert.equal(pattern.test(value), true, `${tool.name} should accept ${value}`);
    }
    for (const value of ['e', 'en_US', 'zh--CN', 'en-US!']) {
      assert.equal(pattern.test(value), false, `${tool.name} should reject ${value}`);
    }
  }
  await client.close();
  await transport.close();
});
