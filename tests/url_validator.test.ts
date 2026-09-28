import { describe, it, expect } from 'vitest';

describe('Frontend URL validation heuristics', () => {
  const normalizeUrl = (input: string): string => {
    const trimmed = input.trim();
    if (!trimmed) return '';
    if (!trimmed.includes('://')) {
      return `https://${trimmed}`;
    }
    return trimmed;
  };

  it('should prepend https to bare domain', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
  });

  it('should preserve existing https scheme', () => {
    expect(normalizeUrl('https://example.com/audit')).toBe('https://example.com/audit');
  });

  it('should preserve existing http scheme', () => {
    expect(normalizeUrl('http://example.org')).toBe('http://example.org');
  });

  it('should handle whitespace trimming properly', () => {
    expect(normalizeUrl('   github.com/rust-lang/rust   ')).toBe(
      'https://github.com/rust-lang/rust'
    );
  });

  it('should return empty string for empty or blank input', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('    ')).toBe('');
  });
});
