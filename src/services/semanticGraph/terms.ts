import type { CrawledPageSummary } from '@/types';
import { isSemanticNoiseTerm, isSemanticTopicalStatus, semanticPageLanguage, semanticTermKey } from '@/services/semanticText';

const MAX_TERMS_PER_PAGE = 40;

/**
 * Bounded per-page term inventory. Terms are compared by an inflection key,
 * so "szkolenia" and "szkolenie" on Polish pages are one term; evidence keeps
 * a form that was actually observed on the crawled pages.
 */
export const buildTermInventory = (selectedPages: CrawledPageSummary[]) => {
  const surfaceForms = new Map<string, Map<string, number>>();
  const termsByPage = selectedPages.map((page) => {
    // Redirects and error pages describe the response, not a topic of the site.
    if (!isSemanticTopicalStatus(page.http_status)) return [];
    const language = semanticPageLanguage(page);
    const keys: string[] = [];
    for (const term of page.semantic_terms ?? []) {
      if (keys.length >= MAX_TERMS_PER_PAGE) break;
      // Keep diacritics for display; comparison happens on the folded key.
      const surface = term.normalize('NFKC').trim().toLocaleLowerCase();
      if (!surface || isSemanticNoiseTerm(surface)) continue;
      const key = semanticTermKey(surface, language);
      if (keys.includes(key)) continue;
      keys.push(key);
      const forms = surfaceForms.get(key) ?? new Map<string, number>();
      forms.set(surface, (forms.get(surface) ?? 0) + 1);
      surfaceForms.set(key, forms);
    }
    return keys;
  });
  // The form used by most pages; ties prefer the shorter, then the lexically first form.
  const displayForms = new Map([...surfaceForms].map(([key, forms]) => [key, [...forms]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1))[0][0]]));
  // Every key passed to displayTerm came from the inventory built above.
  return { termsByPage, displayTerm: (key: string): string => displayForms.get(key)! };
};
