import { describe, expect, it } from 'vitest';
import { normalizeSemanticText } from '@/services/semanticText';

describe('normalizeSemanticText', () => {
  it('normalizes composed and non-decomposing Latin characters consistently', () => {
    expect(normalizeSemanticText('ŻÓŁĆ  ŚWIAT')).toBe('zolc  swiat');
    expect(normalizeSemanticText('Zolc  świat')).toBe('zolc  swiat');
    expect(normalizeSemanticText('straße øvelse encyclopædia œuf')).toBe('strasse ovelse encyclopaedia oeuf');
  });
});
