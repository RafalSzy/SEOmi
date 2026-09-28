import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  isPublicAddress,
  MAX_AUDIT_URL_LENGTH,
  readResponseTextLimited,
  requestPinnedPublicTarget,
  validatePublicTarget,
  validatePublicUrl,
} from '../dist/httpSafety.js';

test('classifies public IPv4 and IPv6 while blocking private and special ranges', () => {
  for (const address of ['1.1.1.1', '8.8.8.8', '2001:4860:4860::8888', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPublicAddress(address), true, address);
  }
  for (const address of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.1.1',
    '172.16.0.1', '192.168.1.1', '192.0.2.1', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '::', '::1', 'fc00::1', 'fe80::1', '2001:db8::1',
    '::ffff:192.168.1.1',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test('rejects unsafe URL syntax and local hostnames before DNS resolution', async () => {
  for (const value of [
    'file:///etc/passwd',
    'http://user:pass@example.com/',
    'http://localhost/',
    'http://printer.local/',
    'http://service.internal/',
    'http://192.168.1.2/',
    `https://example.com/${'a'.repeat(MAX_AUDIT_URL_LENGTH)}`,
  ]) {
    await assert.rejects(() => validatePublicUrl(value, async () => {
      throw new Error('DNS should not be called for a rejected URL');
    }));
  }
});

test('blocks DNS answers containing any private or special-purpose address', async () => {
  await assert.rejects(
    () => validatePublicUrl('https://mixed.example/', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ]),
    /private, loopback, and special-purpose/i,
  );
  await assert.rejects(
    () => validatePublicUrl('https://empty.example/', async () => []),
    /private, loopback, and special-purpose/i,
  );
  const safe = await validatePublicUrl('https://public.example/path', async () => [
    { address: '8.8.8.8', family: 4 },
  ]);
  assert.equal(safe.hostname, 'public.example');
  const target = await validatePublicTarget('https://public.example/', async () => [
    { address: '2606:4700:4700::1111', family: 6 },
    { address: '8.8.8.8', family: 4 },
  ]);
  assert.equal(target.address, '2606:4700:4700::1111');
  assert.equal(target.family, 6);
});

test('connects to the validated IP while preserving the original Host header', async (t) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(`${request.headers.host}|${request.url}`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const target = {
    url: new URL(`http://pinning-fixture.invalid:${address.port}/audit?source=test`),
    address: '127.0.0.1',
    family: 4,
  };
  const response = await requestPinnedPublicTarget(target, 2_000);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), `pinning-fixture.invalid:${address.port}|/audit?source=test`);
});

test('reads exactly the configured byte limit without reporting truncation', async () => {
  const response = new Response('12345678');
  assert.deepEqual(await readResponseTextLimited(response, 8), {
    text: '12345678',
    truncated: false,
    bytesRead: 8,
  });
});

test('truncates and cancels a body that exceeds the configured byte limit', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('12345678'));
      controller.enqueue(new TextEncoder().encode('90'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await readResponseTextLimited(new Response(body), 8);
  assert.deepEqual(result, { text: '12345678', truncated: true, bytesRead: 8 });
  assert.equal(cancelled, true);
});

test('cancels the response stream when the byte limit is zero', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const result = await readResponseTextLimited(new Response(body), 0);
  assert.deepEqual(result, { text: '', truncated: true, bytesRead: 0 });
  assert.equal(cancelled, true);
});

test('rejects invalid response byte limits', async () => {
  await assert.rejects(() => readResponseTextLimited(new Response('body'), -1));
  await assert.rejects(() => readResponseTextLimited(new Response('body'), 1.5));
});
