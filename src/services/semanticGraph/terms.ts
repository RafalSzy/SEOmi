import type { CrawledPageSummary } from '@/types';
import { semanticPageTermEntries } from '@/services/semanticText';

const MAX_TERMS_PER_PAGE = 40;

/**
 * Bounded per-page term inventory. Terms are compared by an inflection key,
 * so "szkolenia" and "szkolenie" on Polish pages are one term; evidence keeps
 * a form that was actually observed on the crawled pages.
 */
export const buildTermInventory = (selectedPages: CrawledPageSummary[]) => {
  const surfaceForms = new Map<string, Map<string, number>>();
  const termsByPage = selectedPages.map((page) => {
    const keys = semanticPageTermEntries(page, MAX_TERMS_PER_PAGE).map(({ key, surface }) => {
      const forms = surfaceForms.get(key) ?? new Map<string, number>();
      forms.set(surface, (forms.get(surface) ?? 0) + 1);
      surfaceForms.set(key, forms);
      return key;
    });
    return keys;
  });
  // The form used by most pages; ties prefer the shorter, then the lexically first form.
  const displayForms = new Map([...surfaceForms].map(([key, forms]) => [key, [...forms]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1))[0][0]]));
  // Every key passed to displayTerm came from the inventory built above.
  return { termsByPage, displayTerm: (key: string): string => displayForms.get(key)! };
};
