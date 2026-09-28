import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId } from '@/services/ids';

describe('desktop-safe ID generation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses randomUUID when the WebView exposes it', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-from-webview' });
    expect(createId('crawl')).toBe('uuid-from-webview');
  });

  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.fill(7); return bytes; } });
    expect(createId('crawl')).toMatch(/^crawl-07070707-0707-4707-8707-070707070707$/);
  });

  it('still returns a prefixed ID when cryptography is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
    expect(createId('profile')).toMatch(/^profile-[a-z0-9]+-[a-z0-9]+$/);
  });
});
