import { describe, expect, it } from 'vitest';
import { getSecureValue, invokeTauriCommand, isTauriEnvironment, setSecureValue } from '@/services/tauri';

describe('browser desktop-command fallback', () => {
  it('validates crawl filters locally without pretending to run a crawl', async () => {
    expect(isTauriEnvironment()).toBe(false);

    const result = await invokeTauriCommand<{
      valid: boolean;
      errors: Array<{ filter: string; pattern: string }>;
      previews: Array<{ url: string; included: boolean }>;
    }>('validate_crawl_filters', {
      includePatterns: ['docs'],
      excludePatterns: ['private'],
      previewUrls: ['https://example.com/docs', 'https://example.com/private'],
    });

    expect(result.valid).toBe(true);
    expect(result.previews).toEqual([
      { url: 'https://example.com/docs', included: true, reason: 'Accepted by the configured filters' },
      { url: 'https://example.com/private', included: false, reason: 'Does not match any include pattern' },
    ]);
  });

  it('returns deterministic local regex errors', async () => {
    const result = await invokeTauriCommand<{ valid: boolean; errors: Array<{ filter: string; pattern: string }> }>('validate_crawl_filters', {
      includePatterns: ['('],
      excludePatterns: [],
      previewUrls: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ filter: 'include', pattern: '(' });
  });

  it('reports local CLI detection as unavailable without surfacing an unknown-command error', async () => {
    const result = await invokeTauriCommand<Array<{ provider: string; available: boolean; detail: string }>>('detect_ai_clis');

    expect(result).toHaveLength(3);
    expect(result.every((status) => status.available)).toBe(false);
    expect(result.map((status) => status.provider)).toEqual(['openai', 'claude', 'gemini']);
    expect(result.every((status) => status.detail.length > 0)).toBe(true);
  });

  it('keeps browser credential hydration usable without storing secrets outside the desktop keychain', async () => {
    await expect(getSecureValue('openai_api_key')).resolves.toBe('');
    await expect(setSecureValue('openai_api_key', 'not-persisted')).resolves.toBeUndefined();
  });

  it('reports known native-only commands without leaking an unknown IPC error', async () => {
    await expect(invokeTauriCommand('crawl_site')).rejects.toThrow(
      'This action requires the installed macOS or Windows desktop application.',
    );
    await expect(invokeTauriCommand('query_crux_record')).rejects.toThrow(
      'This action requires the installed macOS or Windows desktop application.',
    );
    await expect(invokeTauriCommand('load_project_crawl_checkpoint')).rejects.toThrow(
      'This action requires the installed macOS or Windows desktop application.',
    );
    await expect(invokeTauriCommand('save_project_crawl_checkpoint')).rejects.toThrow(
      'This action requires the installed macOS or Windows desktop application.',
    );
  });

  it('reports link checks and PDF exports as native-only commands', async () => {
    await expect(invokeTauriCommand('check_link', { url: 'https://example.com' })).rejects.toThrow(
      'This action requires the installed macOS or Windows desktop application.',
    );
    await expect(invokeTauriCommand('generate_audit_pdf', { audit: {} })).rejects.toThrow(
      'This action requires the installed macOS or Windows desktop application.',
    );
    await expect(invokeTauriCommand('generate_crawl_pdf', { run: {} })).rejects.toThrow(
      'This action requires the installed macOS or Windows desktop application.',
    );
  });
});
