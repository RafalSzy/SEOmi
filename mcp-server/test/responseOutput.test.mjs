import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_RESPONSE_CHARS, textResult } from '../dist/responseOutput.js';

test('keeps compact text and structured results unchanged', () => {
  const result = textResult({ ok: true, count: 3 });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
  assert.match(result.content[0].text, /"count": 3/);
});

test('caps both text and structured MCP output for large payloads', () => {
  const result = textResult({ data: 'x'.repeat(MAX_RESPONSE_CHARS * 2) });
  assert.equal(result.structuredContent.truncated, true);
  assert.equal(result.structuredContent.preview_json.length, MAX_RESPONSE_CHARS);
  assert.ok(result.content[0].text.length <= MAX_RESPONSE_CHARS + '\n[Output truncated.]'.length);
  assert.match(result.content[0].text, /\[Output truncated\.\]$/);
});
