import semanticStopwords from '@/constants/semanticStopwords.json';

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

const SEMANTIC_STOPWORDS = new Set(
  [...semanticStopwords.pl, ...semanticStopwords.en].map((word) => normalizeSemanticText(word)),
);

// Light inflection stripping, longest suffix first, on diacritic-folded text.
// Mirrors `semantic_term_key` in src-tauri/src/commands/site_crawler/semantic_inflection.rs so
// crawler grouping and map clustering agree on which forms are the same word.
const POLISH_SUFFIXES = [
  'iami', 'iach', 'ami', 'ach', 'iom', 'iem', 'ego', 'emu', 'ych', 'ich', 'ymi', 'imi', 'owi',
  'om', 'ow', 'em', 'ie', 'ia', 'ii', 'iu', 'ym', 'im', 'ej', 'a', 'e', 'i', 'o', 'u', 'y',
];
const MIN_POLISH_STEM_CHARS = 4;

const primaryLanguage = (language: string | null | undefined): string =>
  (language ?? '').split(/[-_]/)[0].trim().toLocaleLowerCase();

/**
 * Comparison key for a semantic term: diacritics are folded and regular
 * Polish/English inflection is stripped for pages in those languages. The key
 * is an internal identity for clustering, never shown to users.
 */
export const semanticTermKey = (term: string, language: string | null | undefined): string => {
  const folded = normalizeSemanticText(term);
  const lang = primaryLanguage(language);
  if (lang === 'pl') {
    const suffix = POLISH_SUFFIXES.find((candidate) =>
      folded.endsWith(candidate) && folded.length - candidate.length >= MIN_POLISH_STEM_CHARS);
    return suffix ? folded.slice(0, -suffix.length) : folded;
  }
  if (lang === 'en') {
    if (folded.length > 4 && folded.endsWith('ies')) return `${folded.slice(0, -3)}y`;
    if (folded.length >= 5 && /[^aeiousy]s$/.test(folded)) return folded.slice(0, -1);
  }
  return folded;
};

/**
 * True for function words, navigation chrome, date fragments and tokens that
 * are mostly digits ("2026", "100k"). Alphanumeric acronyms such as "b2b" or
 * "2fa" remain topical terms.
 */
export const isSemanticNoiseTerm = (term: string): boolean => {
  const folded = normalizeSemanticText(term);
  if (SEMANTIC_STOPWORDS.has(folded)) return true;
  const letters = folded.match(/\p{L}/gu)?.length ?? 0;
  const digits = folded.match(/\p{N}/gu)?.length ?? 0;
  return letters < 2 || digits >= letters;
};

/**
 * Semantic terms describe successful documents only: redirects and error pages
 * describe the response. Rendered crawls report 0 when the browser did not
 * expose the HTTP status. Mirrors `semantic_status_is_topical` in the crawler.
 */
export const isSemanticTopicalStatus = (status: number | null | undefined): boolean =>
  !status || (status >= 200 && status < 300);

/** Grouping language for a page's terms; legacy runs only have the declared language. */
export const semanticPageLanguage = (page: { semantic_language?: string | null; document_language?: string | null }): string | null | undefined =>
  page.semantic_language ?? page.document_language;

/** Keeps the first form of each word, treating inflections as the same term. */
export const uniqueSemanticTerms = (terms: string[], language: string | null | undefined): string[] => {
  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = semanticTermKey(term, language);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
