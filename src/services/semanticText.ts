/**
 * Normalize user-visible semantic terms without requiring users to reproduce
 * the exact diacritics used by a page. This is a lexical comparison helper,
 * not stemming, translation, or a language-model interpretation.
 */
export const normalizeSemanticText = (value: string): string => value
  .normalize('NFKC')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[łŁ]/g, 'l')
  .replace(/[đĐ]/g, 'd')
  .replace(/ß/g, 'ss')
  .replace(/[øØ]/g, 'o')
  .replace(/[æÆ]/g, 'ae')
  .replace(/[œŒ]/g, 'oe')
  .toLocaleLowerCase()
  .trim();
