import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMcpCoverage } from '../../scripts/run-mcp-coverage.mjs';

const fixture = (total, covered) => {
  const ids = Array.from({ length: total }, (_, id) => `${id}`);
  const counts = Object.fromEntries(ids.map(id => [id, Number(Number(id) < covered)]));
  return {
    '/fixture.ts': {
      s: { ...counts }, f: { ...counts },
      b: Object.fromEntries(ids.map(id => [id, [counts[id]]])),
      statementMap: Object.fromEntries(ids.map(id => [id, { start: { line: Number(id) + 1 } }])),
    },
  };
};

test('accepts exactly 98% for all four metrics using actual covered/total counts', () => {
  const summary = assertMcpCoverage(fixture(100, 98));
  for (const metric of ['statements', 'functions', 'branches', 'lines']) {
    assert.deepEqual(summary[metric], { total: 100, covered: 98 });
  }
});

test('rejects an unrounded result below 98% even when it displays as 98.00%', () => {
  assert.equal((1077 / 1099 * 100).toFixed(2), '98.00');
  assert.throws(() => assertMcpCoverage(fixture(1099, 1077)), /statements coverage below 98%: 1077\/1099/);
});

test('rejects uncovered functions or branches even with complete statement coverage', () => {
  for (const metric of ['f', 'b']) {
    const mapped = fixture(1, 1);
    mapped['/fixture.ts'][metric]['0'] = metric === 'b' ? [0] : 0;
    assert.throws(() => assertMcpCoverage(mapped), /coverage below 98%: 0\/1/);
  }
});

test('counts statements sharing a line once and rejects uncovered lines independently', () => {
  const mapped = fixture(100, 98);
  mapped['/fixture.ts'].statementMap['1'].start.line = 1;
  assert.throws(() => assertMcpCoverage(mapped), /lines coverage below 98%: 97\/99/);
  mapped['/fixture.ts'].s['98'] = 1;
  const summary = assertMcpCoverage(mapped);
  assert.deepEqual(summary.statements, { total: 100, covered: 99 });
  assert.deepEqual(summary.lines, { total: 99, covered: 98 });
});

test('rejects empty evidence and invalid execution counters', () => {
  assert.throws(() => assertMcpCoverage({}), /Missing mapped MCP coverage/);
  assert.throws(() => assertMcpCoverage(fixture(0, 0)), /coverage below 98%: 0\/0/);
  for (const count of [-1, NaN, Infinity, '1']) {
    const mapped = fixture(1, 1);
    mapped['/fixture.ts'].s['0'] = count;
    assert.throws(() => assertMcpCoverage(mapped), /Invalid MCP execution count/);
  }
});
