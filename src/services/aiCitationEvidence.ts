import type { CrawlRunRecord, CrawledPageSummary } from '@/types';

export type CrawlCitationMatchKind = 'request_url' | 'final_url' | 'redirect_from' | 'redirect_to';

export interface AiCitationTextSpan {
  /** Character offsets are bounded to the text held by this local comparison. */
  text: string;
  start: number;
  end: number;
  source: 'response' | 'semantic-excerpt' | 'title';
}

export interface AiCitationTermEvidence {
  term: string;
  response?: { start: number; end: number };
  source?: { start: number; end: number };
}

export interface AiCitationContextMatch {
  /** Scope of the local evidence used for the lexical comparison. */
  scope: 'sentence-match' | 'excerpt' | 'semantic-terms' | 'title' | 'no-content-signal';
  matchedTerms: string[];
  responseTermCount: number;
  sourceTermCount: number;
  coveragePercent: number | null;
  meetsMinimum: boolean;
  /** Exact normalized match against one of the bounded semantic excerpts. */
  excerptMatch: boolean;
  matchedExcerpt?: string;
  /** Bounded token-overlap match between one response sentence and one excerpt. */
  sentenceMatch: boolean;
  matchedResponseSentence?: string;
  sentenceOverlapPercent: number | null;
  /** Exact bounded spans used for the match; these are not claim entailment. */
  responseSpan?: AiCitationTextSpan;
  sourceSpan?: AiCitationTextSpan;
  matchedTermEvidence: AiCitationTermEvidence[];
}

export interface AiCitationEvidence {
  citation: string;
  normalizedUrl: string | null;
  matched: boolean;
  matchKind?: CrawlCitationMatchKind;
  page?: Pick<CrawledPageSummary, 'url' | 'final_url' | 'title' | 'http_status' | 'indexability_status' | 'semantic_terms' | 'semantic_excerpts'>;
  /** Optional local comparison against the full response text. */
  context?: AiCitationContextMatch;
}

const normalizeHttpUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
};

const citationCandidates = (citation: string): string[] => {
  const candidates = [citation.trim()];
  // Answer text often places sentence punctuation directly after a URL. Only
  // accept a trimmed form if it actually matches the selected crawl snapshot.
  let candidate = candidates[0];
  while (candidate && /[.,;:!?)}\]>]$/.test(candidate)) {
    candidate = candidate.slice(0, -1);
    candidates.push(candidate);
  }
  return candidates;
};

const CONTEXT_STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by',
  'i', 'oraz', 'ale', 'dla', 'do', 'na', 'w', 'we', 'z', 'ze', 'że', 'jest',
]);

const contextTokens = (value: string): string[] => [...new Set(
  value.normalize('NFKC').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !CONTEXT_STOP_WORDS.has(token)),
)];

const normalizeContextPhrase = (value: string): string => value
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

const responseSentences = (value: string): SentenceSpan[] => {
  const sentences: SentenceSpan[] = [];
  const matcher = /[^.!?\n]+/gu;
  for (const match of value.matchAll(matcher)) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (!trimmed || contextTokens(trimmed).length < 3) continue;
    const rawStart = match.index ?? 0;
    const start = rawStart + raw.indexOf(trimmed);
    sentences.push({ text: trimmed, start, end: start + trimmed.length });
    if (sentences.length >= 30) break;
  }
  return sentences;
};

interface SentenceMatch extends SentenceSpan {
  excerpt: string;
  overlap: number;
  matchedTerms: string[];
  sourceStart: number;
  sourceEnd: number;
}

const bestSentenceMatch = (responseText: string, excerpts: string[]): SentenceMatch | null => {
  let best: SentenceMatch | null = null;
  for (const sentence of responseSentences(responseText)) {
    const sentenceTerms = new Set(contextTokens(sentence.text));
    for (const excerpt of excerpts) {
      const excerptTerms = new Set(contextTokens(excerpt));
      if (!sentenceTerms.size || !excerptTerms.size) continue;
      const shared = [...sentenceTerms].filter((term) => excerptTerms.has(term));
      const union = new Set([...sentenceTerms, ...excerptTerms]);
      const overlap = union.size ? shared.length / union.size : 0;
      // This is an intentionally conservative lexical threshold. It is not
      // a semantic entailment or plagiarism detector.
      if (shared.length < 3 || overlap < 0.35 || (best && overlap <= best.overlap)) continue;
      best = {
        ...sentence,
        excerpt,
        overlap,
        matchedTerms: shared.slice(0, 12),
        sourceStart: 0,
        sourceEnd: excerpt.length,
      };
    }
  }
  return best;
};

const locateText = (haystack: string, needle: string): { start: number; end: number } | undefined => {
  const trimmed = needle.trim();
  if (!trimmed) return undefined;
  const start = haystack.toLocaleLowerCase().indexOf(trimmed.toLocaleLowerCase());
  return start < 0 ? undefined : { start, end: start + trimmed.length };
};

const termEvidence = (
  terms: string[],
  responseText: string,
  sourceText: string | undefined,
): AiCitationTermEvidence[] => terms.slice(0, 12).map((term) => {
  const response = locateText(responseText, term);
  const source = sourceText ? locateText(sourceText, term) : undefined;
  return {
    term,
    ...(response ? { response } : {}),
    ...(source ? { source } : {}),
  };
});

const buildContextMatch = (page: CrawledPageSummary, responseText: string | undefined): AiCitationContextMatch | undefined => {
  if (!responseText?.trim()) return undefined;
  const responseTerms = new Set(contextTokens(responseText));
  if (!responseTerms.size) return { scope: 'no-content-signal', matchedTerms: [], responseTermCount: 0, sourceTermCount: 0, coveragePercent: null, meetsMinimum: false, excerptMatch: false, sentenceMatch: false, sentenceOverlapPercent: null, matchedTermEvidence: [] };
  const contentTerms = [...new Set((page.semantic_terms ?? []).flatMap(contextTokens))];
  const titleTerms = contextTokens(page.title ?? '');
  const sourceTerms = contentTerms.length ? contentTerms : titleTerms;
  const matchedTerms = sourceTerms.filter((term) => responseTerms.has(term)).slice(0, 12);
  const normalizedResponse = normalizeContextPhrase(responseText);
  const matchedExcerpt = (page.semantic_excerpts ?? []).find((excerpt) => {
    const normalizedExcerpt = normalizeContextPhrase(excerpt);
    return normalizedExcerpt.length >= 40 && normalizedResponse.includes(normalizedExcerpt);
  });
  const sentenceMatch = bestSentenceMatch(responseText, page.semantic_excerpts ?? []);
  const scope = sentenceMatch ? 'sentence-match' : matchedExcerpt ? 'excerpt' : contentTerms.length ? 'semantic-terms' : titleTerms.length ? 'title' : 'no-content-signal';
  const sourceEvidenceText = sentenceMatch?.excerpt || matchedExcerpt || (contentTerms.length ? page.semantic_excerpts?.[0] : page.title ?? undefined);
  const matchedTermEvidence = termEvidence(
    sentenceMatch?.matchedTerms || matchedTerms,
    responseText,
    sourceEvidenceText,
  );
  const responseSpan = sentenceMatch
    ? { text: sentenceMatch.text, start: sentenceMatch.start, end: sentenceMatch.end, source: 'response' as const }
    : matchedExcerpt
      ? (() => {
        const range = locateText(responseText, matchedExcerpt);
        return range ? { text: responseText.slice(range.start, range.end), ...range, source: 'response' as const } : undefined;
      })()
      : undefined;
  const sourceSpan = sentenceMatch
    ? { text: sentenceMatch.excerpt, start: sentenceMatch.sourceStart, end: sentenceMatch.sourceEnd, source: 'semantic-excerpt' as const }
    : matchedExcerpt
      ? { text: matchedExcerpt, start: 0, end: matchedExcerpt.length, source: 'semantic-excerpt' as const }
      : !contentTerms.length && titleTerms.length
        ? { text: page.title || '', start: 0, end: (page.title || '').length, source: 'title' as const }
        : undefined;
  return {
    scope,
    matchedTerms,
    responseTermCount: responseTerms.size,
    sourceTermCount: sourceTerms.length,
    coveragePercent: sourceTerms.length ? Math.round(matchedTerms.length / sourceTerms.length * 100) : null,
    // Two matching source terms is a deliberately weak observability signal,
    // not evidence that the answer cited or faithfully represented the page.
    meetsMinimum: matchedTerms.length >= 2 || Boolean(sentenceMatch),
    excerptMatch: Boolean(matchedExcerpt),
    ...(matchedExcerpt ? { matchedExcerpt } : {}),
    sentenceMatch: Boolean(sentenceMatch),
    ...(sentenceMatch ? { matchedResponseSentence: sentenceMatch.text, matchedExcerpt: sentenceMatch.excerpt } : {}),
    sentenceOverlapPercent: sentenceMatch ? Math.round(sentenceMatch.overlap * 100) : null,
    ...(responseSpan ? { responseSpan } : {}),
    ...(sourceSpan ? { sourceSpan } : {}),
    matchedTermEvidence,
  };
};

/** Match a model-mentioned URL only against records already in the chosen crawl. */
export const matchAiCitationToCrawl = (citation: string, run: CrawlRunRecord | null, responseText?: string): AiCitationEvidence => {
  const normalizedUrl = normalizeHttpUrl(citation.trim());
  const base = { citation, normalizedUrl, matched: false };
  if (!normalizedUrl || !run || !Array.isArray(run.result?.pages)) return base;

  const aliases = new Map<string, { page: CrawledPageSummary; matchKind: CrawlCitationMatchKind }>();
  const addAlias = (rawUrl: string | undefined, page: CrawledPageSummary, matchKind: CrawlCitationMatchKind) => {
    const normalized = rawUrl ? normalizeHttpUrl(rawUrl) : null;
    if (normalized && !aliases.has(normalized)) aliases.set(normalized, { page, matchKind });
  };
  run.result.pages.forEach((page) => {
    addAlias(page.url, page, 'request_url');
    addAlias(page.final_url, page, 'final_url');
    (page.redirect_chain || []).forEach((redirect) => {
      addAlias(redirect.from_url, page, 'redirect_from');
      addAlias(redirect.to_url, page, 'redirect_to');
    });
  });

  for (const candidate of citationCandidates(citation)) {
    const normalized = normalizeHttpUrl(candidate);
    if (!normalized) continue;
    const match = aliases.get(normalized);
    if (!match) continue;
    return { ...base, matched: true, matchKind: match.matchKind, page: {
      url: match.page.url,
      final_url: match.page.final_url,
      title: match.page.title,
      http_status: match.page.http_status,
      indexability_status: match.page.indexability_status,
      semantic_terms: match.page.semantic_terms,
      semantic_excerpts: match.page.semantic_excerpts,
    }, context: buildContextMatch(match.page, responseText) };
  }
  return base;
};
