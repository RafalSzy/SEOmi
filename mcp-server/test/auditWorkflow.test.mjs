import assert from 'node:assert/strict';
import test from 'node:test';
import { isUrlWithinScope } from '../dist/auditWorkflow.js';

test('scope policy permits the exact host and optional subdomains only', () => {
  const exact = new URL('https://example.com/audit');
  const subdomain = new URL('https://www.example.com/audit');
  const lookalike = new URL('https://example.com.attacker.invalid/audit');
  assert.equal(isUrlWithinScope(exact, { scopeHost: 'example.com' }), true);
  assert.equal(isUrlWithinScope(subdomain, { scopeHost: 'example.com' }), false);
  assert.equal(isUrlWithinScope(subdomain, { scopeHost: 'example.com', allowSubdomains: true }), true);
  assert.equal(isUrlWithinScope(lookalike, { scopeHost: 'example.com', allowSubdomains: true }), false);
});
