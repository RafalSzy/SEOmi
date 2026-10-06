import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMcpCoverageThreshold } from '../../scripts/run-mcp-coverage.mjs';

const counts = (total, covered, branch = false) => branch
  ? {0: Array.from({length: total}, (_, index) => index < covered ? 1 : 0)}
  : Object.fromEntries(Array.from({length: total}, (_, index) => [`${index}`, index < covered ? 1 : 0]));

const report = (covered, total = 10000) => ({
  '/tmp/fixture.ts': {s: counts(total, covered), f: counts(total, covered), b: counts(total, covered, true)},
});

test('rejects coverage below 98 percent', () => {
  assert.throws(() => assertMcpCoverageThreshold(report(9799)), /below 98%/);
});

test('accepts exactly 98 percent and returns real totals', () => {
  const summary = assertMcpCoverageThreshold(report(9800));
  assert.equal(summary.threshold, 98);
  for (const metric of Object.values(summary).slice(1)) assert.deepEqual(metric, {total: 10000, covered: 9800, percent: 98});
});

test('rejects missing and empty reports', () => {
  for (const value of [undefined, null, {}, []]) assert.throws(() => assertMcpCoverageThreshold(value), /empty|malformed|report/);
});

test('requires statements, functions, and branches in every record', () => {
  for (const metric of ['s', 'f', 'b']) {
    const value = report(10000);
    delete value['/tmp/fixture.ts'][metric];
    assert.throws(() => assertMcpCoverageThreshold(value), /empty|malformed/);
  }
});

test('rejects a zero denominator for every metric', () => {
  for (const metric of ['s', 'f', 'b']) {
    const value = report(10000);
    value['/tmp/fixture.ts'][metric] = {};
    assert.throws(() => assertMcpCoverageThreshold(value), /zero denominator/);
  }
});

test('rejects malformed, negative, and fractional counters', () => {
  for (const [metric, invalid] of [['s', -1], ['f', 0.5], ['b', [1, -1]]]) {
    const value = report(10000);
    value['/tmp/fixture.ts'][metric] = metric === 'b' ? {0: invalid} : {0: invalid};
    assert.throws(() => assertMcpCoverageThreshold(value), /Invalid/);
  }
});
