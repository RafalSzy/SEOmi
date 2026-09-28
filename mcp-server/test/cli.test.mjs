import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = new URL('../dist/cli.js', import.meta.url);

test('local CLI exposes a bounded audit command without requiring credentials', () => {
  const result = spawnSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /seomi audit --url/);
  assert.match(result.stdout, /seomi crawl --url/);
  assert.match(result.stdout, /scope-host/);
});

test('local CLI rejects unknown commands with a non-zero exit status', () => {
  const result = spawnSync(process.execPath, [cli.pathname, 'unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command/);
});

test('local CLI validates timeout before any network request', () => {
  const result = spawnSync(process.execPath, [cli.pathname, 'audit', '--url', 'https://example.com', '--timeout-ms', '50'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /between 1000 and 30000/);
});

test('local CLI validates crawl page limits before any network request', () => {
  const result = spawnSync(process.execPath, [cli.pathname, 'crawl', '--url', 'https://example.com', '--max-pages', '101'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /between 1 and 100/);
});
