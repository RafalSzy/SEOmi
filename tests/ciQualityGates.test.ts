import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps strict static analysis, full coverage reporting and both macOS architectures in CI', () => {
  const tests = readFileSync('.github/workflows/test.yml', 'utf8');
  const release = readFileSync('.github/workflows/release.yml', 'utf8');
  expect(tests).toContain('cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings');
  expect(tests).toContain('npm run lint');
  expect(tests).toContain('cargo +nightly llvm-cov --manifest-path src-tauri/Cargo.toml --branch --lcov');
  expect(tests).toContain('node scripts/native-coverage-threshold.mjs coverage-rust-production.lcov.summary.json');
  const frontend = tests.split('  test-frontend:')[1].split('  desktop-platform-smoke:')[0];
  expect(frontend).toMatch(/^\s+run: npm run test:coverage:target\s*$/m);
  expect(frontend).toMatch(/^\s+run: npm run test:coverage:mcp\s*$/m);
  expect(frontend).toMatch(/^\s+run: npm run test:inventory\s*$/m);
  expect(frontend).not.toMatch(/continue-on-error|\|\|\s*true/);
  expect(frontend.indexOf('npm run test:coverage:target')).toBeLessThan(frontend.indexOf('npm run test:coverage:mcp'));
  expect(frontend.indexOf('npm run test:coverage:mcp')).toBeLessThan(frontend.indexOf('npm run test:inventory'));
  expect(frontend).toContain('if: always()');
  expect(frontend).toContain('if-no-files-found: error');
  expect(release).not.toContain('macos-13');
  expect(release).toContain("platform: 'macos-15-intel'");
  expect(release).toContain("args: '--target x86_64-apple-darwin'");
  expect(release).toContain("args: '--target aarch64-apple-darwin'");
});
