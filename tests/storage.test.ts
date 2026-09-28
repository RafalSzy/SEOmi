import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStorageAvailable, readJsonStorage, readStorage, readStorageEntries, removeStorage, writeJsonStorage, writeStorage } from '@/services/storage';

describe('locked WebView storage adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the caller alive when localStorage operations throw', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage blocked'); },
      setItem: () => { throw new Error('storage blocked'); },
      removeItem: () => { throw new Error('storage blocked'); },
    });

    expect(readStorage('key')).toBeNull();
    expect(writeStorage('key', 'value')).toBe(false);
    expect(removeStorage('key')).toBe(false);
    expect(isStorageAvailable()).toBe(false);
  });

  it('uses normal storage when the WebView permits it', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    expect(writeStorage('key', 'value')).toBe(true);
    expect(readStorage('key')).toBe('value');
    expect(removeStorage('key')).toBe(true);
    expect(readStorage('key')).toBeNull();
    expect(isStorageAvailable()).toBe(true);
  });

  it('keeps JSON preferences and bounded project backup enumeration safe', () => {
    const values = new Map<string, string>([
      ['seomi_project_demo_sidebar_v1', JSON.stringify({ collapsed: true })],
      ['seomi_project_demo_empty', ''],
      ['unrelated', 'ignore'],
    ]);
    vi.stubGlobal('localStorage', {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] || null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    expect(writeJsonStorage('preference', { enabled: true })).toBe(true);
    expect(readJsonStorage('preference', { enabled: false })).toEqual({ enabled: true });
    expect(readJsonStorage('malformed', { fallback: true })).toEqual({ fallback: true });
    expect(readStorageEntries('seomi_project_demo_')).toEqual({
      sidebar_v1: JSON.stringify({ collapsed: true }),
      empty: '',
    });
  });
});
