import type { LinkData, StructuredData } from '@/types';
import i18n from '@/i18n';

export type SerpDevice = 'desktop' | 'mobile';

export interface SerpSitelinkCandidate {
  url: string;
  label: string;
  displayUrl: string;
}

export interface SerpRichResultField {
  label: string;
  value: string;
}

export interface SerpRichResultPreview {
  type: string;
  title: string;
  fields: SerpRichResultField[];
}

export const SERP_VIEWPORTS: Record<SerpDevice, { title: number; snippet: number }> = {
  desktop: { title: 600, snippet: 600 },
  mobile: { title: 340, snippet: 340 },
};

const fallbackGlyphWidth = (character: string): number => {
  if (/\s/u.test(character)) return 0.28;
  if (/[ilI|!.,:;'`]/u.test(character)) return 0.28;
  if (/[MW@%&]/u.test(character)) return 0.88;
  if (/[A-Z0-9]/u.test(character)) return 0.62;
  if (/[^\u0000-\u024f]/u.test(character)) return 0.95;
  return 0.52;
};

export const measureSerpText = (text: string, fontSize: number): number => {
  if (typeof document !== 'undefined' && typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent)) {
    try {
      const context = document.createElement('canvas').getContext('2d');
      if (context) {
        context.font = `${fontSize}px Arial, sans-serif`;
        return context.measureText(text).width;
      }
    } catch {
      // Fall through to the deterministic estimate for restricted WebViews.
    }
  }
  return Array.from(text).reduce((width, character) => width + fallbackGlyphWidth(character) * fontSize, 0);
};

export const truncateSerpText = (
  text: string,
  maxWidth: number,
  fontSize: number,
  measure: (value: string, size: number) => number = measureSerpText,
): string => {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized || measure(normalized, fontSize) <= maxWidth) return normalized;
  const ellipsis = '…';
  const ellipsisWidth = measure(ellipsis, fontSize);
  const characters = Array.from(normalized);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join('').trimEnd()}${ellipsis}`;
    if (measure(candidate, fontSize) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  if (low === 0 && ellipsisWidth > maxWidth) return '';
  return `${characters.slice(0, low).join('').trimEnd()}${ellipsis}`;
};

export const truncateSerpSnippet = (
  text: string,
  lineWidth: number,
  fontSize: number,
  maxLines = 2,
  measure: (value: string, size: number) => number = measureSerpText,
): string => {
  const words = text.replace(/\s+/gu, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '';
  const lines: string[] = [];
  let wordIndex = 0;
  while (wordIndex < words.length && lines.length < maxLines) {
    let current = '';
    while (wordIndex < words.length) {
      const candidate = current ? `${current} ${words[wordIndex]}` : words[wordIndex];
      if (measure(candidate, fontSize) <= lineWidth) {
        current = candidate;
        wordIndex += 1;
        continue;
      }
      if (!current) {
        current = truncateSerpText(words[wordIndex], lineWidth, fontSize, measure);
        wordIndex += 1;
      }
      break;
    }
    if (current) lines.push(current);
  }
  if (wordIndex < words.length && lines.length > 0) {
    const lastIndex = lines.length - 1;
    lines[lastIndex] = truncateSerpText(`${lines[lastIndex]}…`, lineWidth, fontSize, measure);
  }
  return lines.join(' ');
};

export const formatSerpDisplayUrl = (input: string): string => {
  try {
    const url = new URL(input);
    const path = url.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => {
        try { return decodeURIComponent(part); } catch { return part; }
      })
      .join(' › ');
    return path ? `${url.hostname} › ${path}` : url.hostname;
  } catch {
    return input;
  }
};

const scalarText = (value: unknown): string | null => {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).replace(/\s+/gu, ' ').trim();
    return text || null;
  }
  return null;
};

const schemaTypes = (content: Record<string, unknown>): string[] => {
  const value = content['@type'];
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const typedSchemaObjects = (structuredData: StructuredData[]): Array<{ content: Record<string, unknown>; types: string[] }> => structuredData
  .flatMap((entry) => {
    const content = entry.content && typeof entry.content === 'object' ? entry.content : null;
    if (!content) return [];
    const graph = Array.isArray(content['@graph']) ? content['@graph'].filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : [];
    return [{ content, types: schemaTypes(content) }, ...graph.map((item) => ({ content: item, types: schemaTypes(item) }))];
  });

/**
 * Builds a bounded list of local sitelink candidates from links present in the
 * audited document. Google may ignore or rewrite these; the candidates are
 * evidence from this response, never a predicted live SERP result.
 */
export const deriveSerpSitelinks = (links: LinkData[], pageUrl: string, limit = 6): SerpSitelinkCandidate[] => {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  return links.flatMap((link) => {
    if (!link.is_internal || !link.text.trim()) return [];
    try {
      const target = new URL(link.href, page);
      target.hash = '';
      if (target.origin !== page.origin || target.href === page.href || seen.has(target.href)) return [];
      seen.add(target.href);
      return [{ url: target.href, label: link.text.replace(/\s+/gu, ' ').trim().slice(0, 80), displayUrl: formatSerpDisplayUrl(target.href) }];
    } catch {
      return [];
    }
  }).slice(0, Math.max(0, Math.min(limit, 12)));
};

/**
 * Extracts only the most useful bounded rich-result evidence from structured
 * data already present in the audit. Missing properties remain missing rather
 * than being filled with assumptions.
 */
export const deriveSerpRichResult = (structuredData: StructuredData[]): SerpRichResultPreview | null => {
  for (const { content, types } of typedSchemaObjects(structuredData)) {
    const type = types.find((item) => ['BreadcrumbList', 'Product', 'Article', 'NewsArticle', 'BlogPosting', 'FAQPage'].includes(item));
    if (!type) continue;
    if (type === 'BreadcrumbList') {
      const items = Array.isArray(content.itemListElement) ? content.itemListElement.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const value = item as Record<string, unknown>;
        const name = scalarText(value.name);
        const position = scalarText(value.position);
        return name ? [{ label: position ? `${position}.` : '•', value: name }] : [];
      }).slice(0, 8) : [];
      if (items.length) return { type, title: i18n.t('serpPreview.breadcrumbTitle'), fields: items };
    }
    if (type === 'Product') {
      const fields: SerpRichResultField[] = [];
      const name = scalarText(content.name);
      const offers = content.offers && typeof content.offers === 'object' ? content.offers as Record<string, unknown> : null;
      const rating = content.aggregateRating && typeof content.aggregateRating === 'object' ? content.aggregateRating as Record<string, unknown> : null;
      if (name) fields.push({ label: i18n.t('serpPreview.name'), value: name });
      const price = scalarText(offers?.price);
      const currency = scalarText(offers?.priceCurrency);
      if (price) fields.push({ label: i18n.t('serpPreview.price'), value: currency ? `${price} ${currency}` : price });
      const ratingValue = scalarText(rating?.ratingValue);
      const reviewCount = scalarText(rating?.reviewCount || rating?.ratingCount);
      if (ratingValue) fields.push({ label: i18n.t('serpPreview.rating'), value: reviewCount ? `${ratingValue} (${reviewCount})` : ratingValue });
      if (fields.length) return { type, title: i18n.t('serpPreview.productTitle'), fields };
    }
    if (['Article', 'NewsArticle', 'BlogPosting'].includes(type)) {
      const fields: SerpRichResultField[] = [];
      const headline = scalarText(content.headline);
      const published = scalarText(content.datePublished);
      const author = scalarText(typeof content.author === 'object' && content.author ? (content.author as Record<string, unknown>).name : content.author);
      if (headline) fields.push({ label: i18n.t('serpPreview.headline'), value: headline });
      if (published) fields.push({ label: i18n.t('serpPreview.published'), value: published });
      if (author) fields.push({ label: i18n.t('serpPreview.author'), value: author });
      if (fields.length) return { type, title: i18n.t('serpPreview.articleTitle'), fields };
    }
    if (type === 'FAQPage') {
      const fields = Array.isArray(content.mainEntity) ? content.mainEntity.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const question = item as Record<string, unknown>;
        const name = scalarText(question.name);
        return name ? [{ label: i18n.t('serpPreview.question'), value: name }] : [];
      }).slice(0, 5) : [];
      if (fields.length) return { type, title: i18n.t('serpPreview.faqTitle'), fields };
    }
  }
  return null;
};
