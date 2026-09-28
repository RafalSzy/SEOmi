import { PageAuditData } from '@/types';
import i18n from '@/i18n';

export type AuditCheckStatus = 'pass' | 'warning' | 'error' | 'not_applicable';

export type AuditCheckCategory = string;

export interface LocalAuditCheck {
  id: string;
  label: string;
  category: AuditCheckCategory;
  status: AuditCheckStatus;
  evidence: string;
}

const check = (id: string, category: AuditCheckCategory, label: string, status: AuditCheckStatus, evidence: string): LocalAuditCheck => ({
  id,
  category: i18n.t(`auditChecks.categories.${category}`),
  label: i18n.t(`auditChecks.labels.${label}`),
  status,
  evidence,
});
const evidence = (key: string, variables?: Record<string, unknown>): string => i18n.t(`auditChecks.evidence.${key}`, variables);
const present = (value: unknown): boolean => typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null;
const absoluteHttp = (value?: string): boolean => /^https?:\/\/[^\s]+$/i.test(value || '');
const uniqueCount = (items: string[]): number => new Set(items.map((item) => item.trim().toLowerCase())).size;

/**
 * Evidence-backed local checks. Every item is independently inspectable and
 * comes from the stored audit; no provider/API values are invented here.
 */
export const buildLocalAuditChecks = (audit: PageAuditData): LocalAuditCheck[] => {
  const meta = audit.meta_tags;
  const og = audit.open_graph;
  const twitter = audit.twitter_card;
  const headings = audit.headings;
  const images = audit.images || [];
  const links = audit.links || { total_links: 0, internal_links: 0, external_links: 0, nofollow_links: 0, links: [] };
  const security = audit.security_headers;
  const technical = audit.technical || { hreflang_tags: [] };
  const content = audit.content_stats;
  const accessibility = audit.accessibility;
  const indexability = audit.indexability;
  const amp = audit.amp;
  const transport = audit.transport_security;
  const performance = audit.http_performance;
  const finalUrl = audit.final_url || audit.url;
  const finalUrlIsHttps = /^https:\/\//i.test(finalUrl);
  const viewport = meta.viewport?.trim() || '';
  const hasResponsiveViewport = /(?:^|[,;])\s*width\s*=\s*device-width(?:\s*[,;]|$)/i.test(viewport);
  const noindex = /(?:^|[\s,;])(noindex|none)(?:$|[\s,;])|noarchive|nosnippet/i.test(meta.robots || '');
  const imageSources = images.map((image) => image.src);
  const linkHrefs = links.links.map((link) => link.href);
  const title = meta.title?.trim() || '';
  const description = meta.description?.trim() || '';
  const ogTags = og.all_tags || [];
  const twitterTags = twitter.all_tags || [];
  const hreflangs = technical.hreflang_tags || [];
  const structured = audit.structured_data || [];
  const structuredFindings = structured.flatMap((item) => item.validation_issues || []);
  const structuredErrors = structuredFindings.filter((issue) => issue.severity === 'error').length;
  const structuredWarnings = structuredFindings.filter((issue) => issue.severity === 'warning').length;
  const mainLandmark = accessibility?.landmarks.find((landmark) => landmark.name.toLowerCase() === 'main');
  const totalLandmarks = accessibility?.landmarks.reduce((sum, landmark) => sum + landmark.count, 0) || 0;
  const allCookiesSecure = transport ? transport.cookies.every((cookie) => cookie.secure) : false;
  const allCookiesHttpOnly = transport ? transport.cookies.every((cookie) => cookie.http_only) : false;
  const allCookiesSameSite = transport ? transport.cookies.every((cookie) => present(cookie.same_site)) : false;
  const checks: LocalAuditCheck[] = [];

  // HTTP and URL (14)
  checks.push(
    check('http', 'httpIUrl', 'http', audit.http_status >= 200 && audit.http_status < 300 ? 'pass' : audit.http_status >= 300 && audit.http_status < 400 ? 'warning' : 'error', evidence('httpStatus', { status: audit.http_status })),
    check('https', 'httpIUrl', 'https', finalUrlIsHttps ? 'pass' : 'warning', finalUrlIsHttps ? evidence('httpsSecure') : evidence('httpsInsecure')),
    check('url-absolute', 'httpIUrl', 'url-absolute', absoluteHttp(audit.url) ? 'pass' : 'error', audit.url || evidence('missingRequestUrl')),
    check('final-url-absolute', 'httpIUrl', 'final-url-absolute', absoluteHttp(finalUrl) ? 'pass' : 'error', finalUrl || evidence('missingFinalUrl')),
    check('url-fragment', 'httpIUrl', 'url-fragment', audit.url.includes('#') ? 'warning' : 'pass', audit.url.includes('#') ? evidence('urlFragment') : evidence('noFragment')),
    check('redirect-chain', 'httpIUrl', 'redirect-chain', audit.redirect_chain.length === 0 ? 'pass' : audit.redirect_chain.length <= 2 ? 'warning' : 'error', audit.redirect_chain.length ? evidence('count', { count: audit.redirect_chain.length, unit: i18n.t('auditChecks.evidence.redirectUnit') }) : evidence('noRedirects')),
    check('redirect-statuses', 'httpIUrl', 'redirect-statuses', audit.redirect_chain.length === 0 || audit.redirect_chain.every((hop) => hop.status_code >= 300 && hop.status_code < 400) ? 'pass' : 'error', audit.redirect_chain.length ? audit.redirect_chain.map((hop) => `${hop.status_code}`).join(' → ') : evidence('notApplicable')),
    check('redirect-locations', 'httpIUrl', 'redirect-locations', audit.redirect_chain.length === 0 || audit.redirect_chain.every((hop) => present(hop.location)) ? 'pass' : 'warning', audit.redirect_chain.length ? evidence('redirectLocations', { withLocation: audit.redirect_chain.filter((hop) => present(hop.location)).length, total: audit.redirect_chain.length }) : evidence('notApplicable')),
    check('response-time', 'httpIUrl', 'response-time', audit.response_time_ms < 800 ? 'pass' : audit.response_time_ms < 2000 ? 'warning' : 'error', evidence('responseTime', { value: audit.response_time_ms })),
    check('response-time-fast', 'httpIUrl', 'response-time-fast', audit.response_time_ms < 300 ? 'pass' : 'warning', evidence('responseTime', { value: audit.response_time_ms })),
    check('response-time-known', 'httpIUrl', 'response-time-known', Number.isFinite(audit.response_time_ms) && audit.response_time_ms >= 0 ? 'pass' : 'error', String(audit.response_time_ms)),
    check('http-performance', 'httpIUrl', 'http-performance', performance ? 'pass' : 'not_applicable', performance ? `${performance.method} · ${performance.scope}` : evidence('legacyMeasurement')),
    check('http-body-size', 'httpIUrl', 'http-body-size', performance ? performance.decoded_body_bytes >= 0 ? 'pass' : 'error' : 'not_applicable', performance ? evidence('bodySize', { value: performance.decoded_body_bytes }) : evidence('missingData')),
    check('http-redirect-count', 'httpIUrl', 'http-redirect-count', performance ? performance.redirect_hops === audit.redirect_chain.length ? 'pass' : 'warning' : 'not_applicable', performance ? `${performance.redirect_hops}` : evidence('missingData')),
  );

  // Meta and indexability (22)
  checks.push(
    check('title', 'metaIIndeksacja', 'title', title ? 'pass' : 'error', title || evidence('missingTitle')),
    check('title-length-min', 'metaIIndeksacja', 'title-length-min', !title ? 'not_applicable' : meta.title_length >= 20 ? 'pass' : 'warning', title ? evidence('countCharacters', { count: meta.title_length }) : evidence('missingTitle')),
    check('title-length-max', 'metaIIndeksacja', 'title-length-max', !title ? 'not_applicable' : meta.title_length <= 60 ? 'pass' : 'warning', title ? evidence('countCharacters', { count: meta.title_length }) : evidence('missingTitle')),
    check('title-trimmed', 'metaIIndeksacja', 'title-trimmed', !meta.title || meta.title === title ? 'pass' : 'warning', meta.title ? evidence('savedCharacters', { count: meta.title.length }) : evidence('missingTitle')),
    check('title-description-distinct', 'metaIIndeksacja', 'title-description-distinct', !title || !description ? 'not_applicable' : title.toLowerCase() !== description.toLowerCase() ? 'pass' : 'warning', title && description && title.toLowerCase() === description.toLowerCase() ? evidence('identicalValues') : evidence('differentValues')),
    check('description', 'metaIIndeksacja', 'description', description ? 'pass' : 'error', description || evidence('missingDescription')),
    check('description-length-min', 'metaIIndeksacja', 'description-length-min', !description ? 'not_applicable' : meta.description_length >= 70 ? 'pass' : 'warning', description ? evidence('countCharacters', { count: meta.description_length }) : evidence('missingDescription')),
    check('description-length-max', 'metaIIndeksacja', 'description-length-max', !description ? 'not_applicable' : meta.description_length <= 160 ? 'pass' : 'warning', description ? evidence('countCharacters', { count: meta.description_length }) : evidence('missingDescription')),
    check('viewport', 'metaIIndeksacja', 'viewport', !viewport ? 'error' : hasResponsiveViewport ? 'pass' : 'warning', !viewport ? evidence('missingViewport') : hasResponsiveViewport ? viewport : evidence('viewportInvalid', { value: viewport })),
    check('viewport-responsive', 'metaIIndeksacja', 'viewport-responsive', !viewport ? 'not_applicable' : hasResponsiveViewport ? 'pass' : 'warning', viewport || evidence('missingData')),
    check('viewport-no-scale-lock', 'metaIIndeksacja', 'viewport-no-scale-lock', !viewport ? 'not_applicable' : /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?/i.test(viewport) ? 'warning' : 'pass', viewport || evidence('missingData')),
    check('canonical', 'metaIIndeksacja', 'canonical', present(meta.canonical) ? 'pass' : 'warning', meta.canonical || evidence('missingCanonical')),
    check('canonical-absolute', 'metaIIndeksacja', 'canonical-absolute', !meta.canonical ? 'not_applicable' : absoluteHttp(meta.canonical) ? 'pass' : 'warning', meta.canonical || evidence('missingCanonical')),
    check('canonical-https', 'metaIIndeksacja', 'canonical-https', !meta.canonical ? 'not_applicable' : /^https:\/\//i.test(meta.canonical) ? 'pass' : 'warning', meta.canonical || evidence('missingCanonical')),
    check('robots-present', 'metaIIndeksacja', 'robots-present', present(meta.robots) ? 'pass' : 'not_applicable', meta.robots || evidence('missingRobots')),
    check('robots-indexable', 'metaIIndeksacja', 'robots-indexable', !meta.robots ? 'not_applicable' : noindex ? 'error' : 'pass', meta.robots || evidence('missingDirective')),
    check('charset', 'metaIIndeksacja', 'charset', !meta.charset ? 'not_applicable' : /utf-?8/i.test(meta.charset) ? 'pass' : 'warning', meta.charset || evidence('missingCharset')),
    check('author', 'metaIIndeksacja', 'author', present(meta.author) ? 'pass' : 'not_applicable', meta.author || evidence('notDeclared')),
    check('generator', 'metaIIndeksacja', 'generator', present(meta.generator) ? 'warning' : 'pass', meta.generator || evidence('noGenerator')),
    check('indexability', 'metaIIndeksacja', 'indexability', indexability ? indexability.status === 'indexable' ? 'pass' : indexability.status === 'blocked' ? 'error' : 'warning' : 'not_applicable', indexability ? `${indexability.status}${indexability.reasons.length ? ` · ${indexability.reasons.join(' ')}` : ''}` : evidence('missingVerdict')),
    check('indexability-canonical-match', 'metaIIndeksacja', 'indexability-canonical-match', !indexability ? 'not_applicable' : indexability.canonical_matches_final_url === true ? 'pass' : indexability.canonical_matches_final_url === false ? 'warning' : 'not_applicable', indexability?.canonical_matches_final_url === true ? evidence('canonicalFinal') : indexability?.canonical_matches_final_url === false ? evidence('canonicalOther') : evidence('missingEvidence')),
    check('canonical-target-status', 'metaIIndeksacja', 'canonical-target-status', !indexability?.canonical_target_checked ? 'not_applicable' : (indexability.canonical_target_status || 0) >= 200 && (indexability.canonical_target_status || 0) < 400 ? 'pass' : 'error', indexability?.canonical_target_checked ? evidence('httpStatus', { status: indexability.canonical_target_status || i18n.t('auditProblems.unknown') }) : evidence('targetNotChecked')),
  );

  // Open Graph (12)
  checks.push(
    check('og-title', 'openGraph', 'og-title', present(og.og_title) ? 'pass' : 'warning', og.og_title || evidence('missingOgTitle')),
    check('og-description', 'openGraph', 'og-description', present(og.og_description) ? 'pass' : 'warning', og.og_description || evidence('missingOgDescription')),
    check('og-image', 'openGraph', 'og-image', present(og.og_image) ? 'pass' : 'warning', og.og_image || evidence('missingOgImage')),
    check('og-image-absolute', 'openGraph', 'og-image-absolute', !og.og_image ? 'not_applicable' : absoluteHttp(og.og_image) ? 'pass' : 'warning', og.og_image || evidence('missingOgImage')),
    check('og-image-dimensions', 'openGraph', 'og-image-dimensions', !og.og_image ? 'not_applicable' : present(og.og_image_width) && present(og.og_image_height) ? 'pass' : 'warning', og.og_image ? evidence('dimensions', { width: og.og_image_width || i18n.t('auditProblems.unknown'), height: og.og_image_height || i18n.t('auditProblems.unknown') }) : evidence('missingImage')),
    check('og-url', 'openGraph', 'og-url', present(og.og_url) ? 'pass' : 'warning', og.og_url || evidence('missingOgUrl')),
    check('og-url-match', 'openGraph', 'og-url-match', !og.og_url ? 'not_applicable' : og.og_url === finalUrl ? 'pass' : 'warning', og.og_url || evidence('missingOgUrl')),
    check('og-type', 'openGraph', 'og-type', present(og.og_type) ? 'pass' : 'warning', og.og_type || evidence('missingOgType')),
    check('og-site-name', 'openGraph', 'og-site-name', present(og.og_site_name) ? 'pass' : 'not_applicable', og.og_site_name || evidence('notDeclared')),
    check('og-locale', 'openGraph', 'og-locale', present(og.og_locale) ? 'pass' : 'not_applicable', og.og_locale || evidence('notDeclared')),
    check('og-tag-duplicates', 'openGraph', 'og-tag-duplicates', uniqueCount(ogTags.map((tag) => tag.property || tag.name || '')) === ogTags.length ? 'pass' : 'warning', evidence('countTags', { count: ogTags.length, unique: uniqueCount(ogTags.map((tag) => tag.property || tag.name || '')) })),
    check('og-title-alignment', 'openGraph', 'og-title-alignment', !og.og_title || !title ? 'not_applicable' : og.og_title.trim() === title ? 'pass' : 'warning', og.og_title || evidence('missingOgTitle')),
  );

  // Twitter Card (10)
  checks.push(
    check('twitter-card', 'twitterCard', 'twitter-card', present(twitter.twitter_card) ? 'pass' : 'warning', twitter.twitter_card || evidence('missingTwitterCard')),
    check('twitter-title', 'twitterCard', 'twitter-title', present(twitter.twitter_title) ? 'pass' : 'warning', twitter.twitter_title || evidence('missingTwitterTitle')),
    check('twitter-description', 'twitterCard', 'twitter-description', present(twitter.twitter_description) ? 'pass' : 'warning', twitter.twitter_description || evidence('missingTwitterDescription')),
    check('twitter-image', 'twitterCard', 'twitter-image', present(twitter.twitter_image) ? 'pass' : 'warning', twitter.twitter_image || evidence('missingTwitterImage')),
    check('twitter-image-absolute', 'twitterCard', 'twitter-image-absolute', !twitter.twitter_image ? 'not_applicable' : absoluteHttp(twitter.twitter_image) ? 'pass' : 'warning', twitter.twitter_image || evidence('missingImage')),
    check('twitter-site', 'twitterCard', 'twitter-site', present(twitter.twitter_site) ? 'pass' : 'not_applicable', twitter.twitter_site || evidence('notDeclared')),
    check('twitter-creator', 'twitterCard', 'twitter-creator', present(twitter.twitter_creator) ? 'pass' : 'not_applicable', twitter.twitter_creator || evidence('notDeclared')),
    check('twitter-tags-duplicates', 'twitterCard', 'twitter-tags-duplicates', uniqueCount(twitterTags.map((tag) => tag.property || tag.name || '')) === twitterTags.length ? 'pass' : 'warning', evidence('countTags', { count: twitterTags.length, unique: uniqueCount(twitterTags.map((tag) => tag.property || tag.name || '')) })),
    check('twitter-card-supported', 'twitterCard', 'twitter-card-supported', !twitter.twitter_card ? 'not_applicable' : /^(summary|summary_large_image|app|player)$/i.test(twitter.twitter_card.trim()) ? 'pass' : 'warning', twitter.twitter_card || evidence('missingType')),
    check('twitter-title-alignment', 'twitterCard', 'twitter-title-alignment', !twitter.twitter_title || !title ? 'not_applicable' : twitter.twitter_title.trim() === title ? 'pass' : 'warning', twitter.twitter_title || evidence('missingTwitterTitle')),
  );

  // Headings (10)
  const allHeadingTexts = (headings.hierarchy || []).map((node) => node.text.trim()).filter(Boolean);
  const firstHeadingLevel = headings.hierarchy?.[0]?.level;
  checks.push(
    check('h1', 'nagOwki', 'h1', headings.h1_count === 1 ? 'pass' : headings.h1_count === 0 ? 'error' : 'warning', evidence('detectedH1', { count: headings.h1_count })),
    check('h1-nonempty', 'nagOwki', 'h1-nonempty', headings.h1_texts.length > 0 && headings.h1_texts.every((text) => text.trim()) ? 'pass' : 'error', headings.h1_texts.join(' · ') || evidence('missingH1Text')),
    check('heading-hierarchy', 'nagOwki', 'heading-hierarchy', headings.has_valid_hierarchy ? 'pass' : 'warning', headings.issues.join(' ') || evidence('noHeadingJumps')),
    check('heading-first-level', 'nagOwki', 'heading-first-level', firstHeadingLevel === undefined ? 'not_applicable' : firstHeadingLevel === 1 ? 'pass' : 'warning', firstHeadingLevel === undefined ? evidence('noHeadings') : evidence('firstHeading', { level: firstHeadingLevel })),
    check('heading-unique-h1', 'nagOwki', 'heading-unique-h1', uniqueCount(headings.h1_texts) === headings.h1_texts.length ? 'pass' : 'warning', evidence('countTexts', { count: headings.h1_texts.length, unique: uniqueCount(headings.h1_texts) })),
    check('heading-nonempty-all', 'nagOwki', 'heading-nonempty-all', allHeadingTexts.length === headings.hierarchy.length ? 'pass' : 'warning', evidence('headingTextCoverage', { withText: allHeadingTexts.length, total: headings.hierarchy.length })),
    check('heading-depth', 'nagOwki', 'heading-depth', headings.hierarchy.every((node) => node.level >= 1 && node.level <= 6) ? 'pass' : 'error', evidence('countNodes', { count: headings.hierarchy.length })),
    check('heading-issues', 'nagOwki', 'heading-issues', headings.issues.length === 0 ? 'pass' : 'warning', headings.issues.join(' ') || evidence('noProblems')),
    check('heading-count', 'nagOwki', 'heading-count', Number.isFinite(headings.hierarchy.length) ? 'pass' : 'error', `${headings.hierarchy.length}`),
    check('heading-text-coverage', 'nagOwki', 'heading-text-coverage', headings.hierarchy.length === 0 ? 'not_applicable' : allHeadingTexts.length === headings.hierarchy.length ? 'pass' : 'warning', `${allHeadingTexts.length}/${headings.hierarchy.length}`),
  );

  // Images (12)
  const missingAlt = images.filter((image) => !image.has_alt).length;
  const emptyAlt = images.filter((image) => image.has_alt && !image.alt?.trim()).length;
  const missingDimensions = images.filter((image) => !present(image.width) || !present(image.height)).length;
  const onlyOneDimension = images.filter((image) => present(image.width) !== present(image.height)).length;
  const lazyImages = images.filter((image) => image.loading?.toLowerCase() === 'lazy').length;
  const srcsetImages = images.filter((image) => present(image.srcset)).length;
  checks.push(
    check('images-alt', 'obrazy', 'images-alt', images.length === 0 ? 'not_applicable' : missingAlt === 0 ? 'pass' : 'warning', images.length === 0 ? evidence('noImages') : evidence('imageAltMissing', { missing: missingAlt, total: images.length })),
    check('images-alt-nonempty', 'obrazy', 'images-alt-nonempty', images.length === 0 ? 'not_applicable' : emptyAlt === 0 ? 'pass' : 'warning', images.length === 0 ? evidence('noImages') : evidence('count', { count: emptyAlt, unit: 'emptyAlt' })),
    check('images-dimensions', 'obrazy', 'images-dimensions', images.length === 0 ? 'not_applicable' : missingDimensions === 0 ? 'pass' : 'warning', images.length === 0 ? evidence('noImages') : evidence('dimensionsMissing', { count: missingDimensions })),
    check('images-dimensions-pair', 'obrazy', 'images-dimensions-pair', images.length === 0 ? 'not_applicable' : onlyOneDimension === 0 ? 'pass' : 'warning', images.length === 0 ? evidence('noImages') : evidence('oneDimension', { count: onlyOneDimension })),
    check('images-loading', 'obrazy', 'images-loading', images.length === 0 ? 'not_applicable' : lazyImages > 0 ? 'pass' : 'warning', images.length === 0 ? evidence('noImages') : evidence('lazy', { lazy: lazyImages, total: images.length })),
    check('images-srcset', 'obrazy', 'images-srcset', images.length === 0 ? 'not_applicable' : srcsetImages > 0 ? 'pass' : 'warning', images.length === 0 ? evidence('noImages') : evidence('srcset', { count: srcsetImages, total: images.length })),
    check('images-modern-format', 'obrazy', 'images-modern-format', images.length === 0 ? 'not_applicable' : images.every((image) => /(?:webp|avif)$/i.test(image.format || image.src)) ? 'pass' : 'warning', images.length === 0 ? evidence('noImages') : images.map((image) => image.format || i18n.t('auditChecks.evidence.formatUnknown')).join(', ')),
    check('images-duplicate-src', 'obrazy', 'images-duplicate-src', uniqueCount(imageSources) === imageSources.length ? 'pass' : 'warning', evidence('countImages', { count: imageSources.length, unique: uniqueCount(imageSources) })),
    check('images-absolute', 'obrazy', 'images-absolute', images.length === 0 ? 'not_applicable' : images.every((image) => absoluteHttp(image.src) || image.src.startsWith('data:') || image.src.startsWith('/')) ? 'pass' : 'warning', evidence('countSources', { count: images.length })),
    check('images-insecure', 'obrazy', 'images-insecure', !finalUrlIsHttps || images.length === 0 ? 'not_applicable' : images.some((image) => /^http:\/\//i.test(image.src)) ? 'error' : 'pass', evidence('countMixedSources', { count: images.filter((image) => /^http:\/\//i.test(image.src)).length })),
    check('images-format-known', 'obrazy', 'images-format-known', images.length === 0 ? 'not_applicable' : images.filter((image) => present(image.format)).length === images.length ? 'pass' : 'warning', `${images.filter((image) => present(image.format)).length}/${images.length}`),
    check('images-data-uri', 'obrazy', 'images-data-uri', images.filter((image) => image.src.startsWith('data:')).length <= 10 ? 'pass' : 'warning', evidence('dataUriCount', { count: images.filter((image) => image.src.startsWith('data:')).length })),
  );

  // Links (13)
  const emptyLinks = links.links.filter((link) => !link.text.trim()).length;
  const insecureLinks = links.links.filter((link) => link.is_insecure || /^http:\/\//i.test(link.href)).length;
  const blankWithoutNoopener = links.links.filter((link) => link.target === '_blank' && !/noopener/i.test(link.rel || '')).length;
  const duplicateLinks = linkHrefs.length - uniqueCount(linkHrefs);
  checks.push(
    check('links-total-consistent', 'linki', 'links-total-consistent', links.total_links === links.links.length ? 'pass' : 'warning', evidence('countDeclaredRecords', { declared: links.total_links, records: links.links.length })),
    check('links-internal-external', 'linki', 'links-internal-external', links.internal_links + links.external_links === links.total_links ? 'pass' : 'warning', evidence('linkSplit', { internal: links.internal_links, external: links.external_links })),
    check('links-nofollow-bounded', 'linki', 'links-nofollow-bounded', links.nofollow_links <= links.total_links ? 'pass' : 'error', `${links.nofollow_links}/${links.total_links}`),
    check('links-empty-anchor', 'linki', 'links-empty-anchor', links.links.length === 0 ? 'not_applicable' : emptyLinks === 0 ? 'pass' : 'warning', links.links.length === 0 ? evidence('noLinks') : evidence('countEmpty', { count: emptyLinks, kind: i18n.t('auditChecks.evidence.anchorText') })),
    check('links-insecure', 'linki', 'links-insecure', !finalUrlIsHttps || links.links.length === 0 ? 'not_applicable' : insecureLinks === 0 ? 'pass' : 'warning', evidence('countHttpLinks', { count: insecureLinks })),
    check('links-duplicate', 'linki', 'links-duplicate', duplicateLinks === 0 ? 'pass' : 'warning', evidence('countDuplicates', { count: duplicateLinks })),
    check('links-target-blank', 'linki', 'links-target-blank', blankWithoutNoopener === 0 ? 'pass' : 'warning', evidence('withoutNoopener', { count: blankWithoutNoopener })),
    check('links-href-present', 'linki', 'links-href-present', links.links.every((link) => present(link.href)) ? 'pass' : 'error', `${links.links.filter((link) => present(link.href)).length}/${links.links.length}`),
    check('links-internal-count', 'linki', 'links-internal-count', links.total_links === 0 ? 'not_applicable' : links.internal_links > 0 ? 'pass' : 'warning', `${links.internal_links}`),
    check('links-external-count', 'linki', 'links-external-count', links.total_links === 0 ? 'not_applicable' : links.external_links > 0 ? 'pass' : 'not_applicable', `${links.external_links}`),
    check('links-rel-readable', 'linki', 'links-rel-readable', links.links.every((link) => link.rel === undefined || typeof link.rel === 'string') ? 'pass' : 'error', evidence('relCount', { count: links.links.filter((link) => present(link.rel)).length })),
    check('links-fragments', 'linki', 'links-fragments', links.links.filter((link) => link.href.startsWith('#')).length <= links.links.length ? 'pass' : 'error', evidence('countFragments', { count: links.links.filter((link) => link.href.startsWith('#')).length })),
    check('links-anchor-coverage', 'linki', 'links-anchor-coverage', links.links.length === 0 ? 'not_applicable' : emptyLinks === 0 ? 'pass' : 'warning', `${links.links.length - emptyLinks}/${links.links.length}`),
  );

  // Security headers and cookies (12)
  checks.push(
    check('security', 'bezpieczenstwo', 'security', security.score >= 80 ? 'pass' : security.score >= 50 ? 'warning' : 'error', `${security.score}/100`),
    check('security-hsts', 'bezpieczenstwo', 'security-hsts', !finalUrlIsHttps ? 'not_applicable' : present(security.strict_transport_security) ? 'pass' : 'warning', security.strict_transport_security || evidence('missingHsts')),
    check('security-csp', 'bezpieczenstwo', 'security-csp', present(security.content_security_policy) ? 'pass' : 'warning', security.content_security_policy || evidence('missingCsp')),
    check('security-xfo', 'bezpieczenstwo', 'security-xfo', present(security.x_frame_options) ? 'pass' : 'warning', security.x_frame_options || evidence('missingXfo')),
    check('security-xcto', 'bezpieczenstwo', 'security-xcto', present(security.x_content_type_options) ? 'pass' : 'warning', security.x_content_type_options || evidence('missingXcto')),
    check('security-referrer', 'bezpieczenstwo', 'security-referrer', present(security.referrer_policy) ? 'pass' : 'warning', security.referrer_policy || evidence('missingReferrer')),
    check('security-permissions', 'bezpieczenstwo', 'security-permissions', present(security.permissions_policy) ? 'pass' : 'not_applicable', security.permissions_policy || evidence('notDeclared')),
    check('security-coop', 'bezpieczenstwo', 'security-coop', present(security.cross_origin_opener_policy) ? 'pass' : 'not_applicable', security.cross_origin_opener_policy || evidence('notDeclared')),
    check('security-corp', 'bezpieczenstwo', 'security-corp', present(security.cross_origin_resource_policy) ? 'pass' : 'not_applicable', security.cross_origin_resource_policy || evidence('notDeclared')),
    check('security-server-disclosure', 'bezpieczenstwo', 'security-server-disclosure', present(security.server) ? 'warning' : 'pass', security.server || evidence('missingServer')),
    check('security-powered-by', 'bezpieczenstwo', 'security-powered-by', present(security.x_powered_by) ? 'warning' : 'pass', security.x_powered_by || evidence('missingPoweredBy')),
    check('security-cookies', 'bezpieczenstwo', 'security-cookies', !transport || transport.cookies.length === 0 ? 'not_applicable' : allCookiesSecure && allCookiesHttpOnly && allCookiesSameSite ? 'pass' : 'warning', !transport || transport.cookies.length === 0 ? evidence('noCookies') : evidence('cookiesFlags', { count: transport.cookies.length, secure: allCookiesSecure ? i18n.t('auditChecks.evidence.yes') : i18n.t('auditChecks.evidence.no'), httpOnly: allCookiesHttpOnly ? i18n.t('auditChecks.evidence.yes') : i18n.t('auditChecks.evidence.no'), sameSite: allCookiesSameSite ? i18n.t('auditChecks.evidence.yes') : i18n.t('auditChecks.evidence.no') })),
  );

  // Structured data (8)
  checks.push(
    check('structured-present', 'daneStrukturalne', 'structured-present', structured.length > 0 ? 'pass' : 'warning', structured.length ? evidence('countDeclarations', { count: structured.length }) : evidence('noStructured')),
    check('structured-errors', 'daneStrukturalne', 'structured-errors', structured.length === 0 ? 'not_applicable' : structuredErrors === 0 ? 'pass' : 'error', structured.length ? evidence('countErrors', { count: structuredErrors }) : evidence('noDeclarations')),
    check('structured-warnings', 'daneStrukturalne', 'structured-warnings', structured.length === 0 ? 'not_applicable' : structuredWarnings === 0 ? 'pass' : 'warning', structured.length ? evidence('countWarnings', { count: structuredWarnings }) : evidence('noDeclarations')),
    check('structured-format-coverage', 'daneStrukturalne', 'structured-format-coverage', structured.every((item) => ['JSON-LD', 'Microdata', 'RDFa'].includes(item.format)) ? 'pass' : 'warning', evidence('countFormats', { count: uniqueCount(structured.map((item) => item.format)) })),
    check('structured-type-coverage', 'daneStrukturalne', 'structured-type-coverage', structured.length === 0 ? 'not_applicable' : structured.every((item) => present(item.data_type)) ? 'pass' : 'warning', `${structured.filter((item) => present(item.data_type)).length}/${structured.length}`),
    check('structured-jsonld-valid', 'daneStrukturalne', 'structured-jsonld-valid', structured.filter((item) => item.format === 'JSON-LD').every((item) => item.content && typeof item.content === 'object') ? 'pass' : structured.some((item) => item.format === 'JSON-LD') ? 'warning' : 'not_applicable', evidence('localShapeCheck')),
    check('structured-unique-types', 'daneStrukturalne', 'structured-unique-types', structured.length === 0 ? 'not_applicable' : uniqueCount(structured.map((item) => item.data_type)) === structured.length ? 'pass' : 'warning', evidence('countUniqueTypes', { count: uniqueCount(structured.map((item) => item.data_type)) })),
    check('structured-finding-paths', 'daneStrukturalne', 'structured-finding-paths', structuredFindings.every((issue) => issue.path || issue.message) ? 'pass' : 'warning', evidence('countFindings', { count: structuredFindings.length })),
  );

  // Technical discovery (10)
  const faviconCount = technical.favicons?.length || (technical.favicon ? 1 : 0);
  const duplicateHreflang = hreflangs.length - uniqueCount(hreflangs.map((tag) => tag.hreflang));
  checks.push(
    check('technical-content-type', 'techniczne', 'technical-content-type', present(technical.content_type) ? 'pass' : 'warning', technical.content_type || evidence('missingContentType')),
    check('technical-favicon', 'techniczne', 'technical-favicon', faviconCount > 0 ? 'pass' : 'warning', faviconCount ? evidence('countVariants', { count: faviconCount }) : evidence('missingFavicon')),
    check('technical-favicon-absolute', 'techniczne', 'technical-favicon-absolute', technical.favicons?.length ? technical.favicons.every((item) => present(item.href)) ? 'pass' : 'warning' : technical.favicon ? 'pass' : 'not_applicable', technical.favicon || evidence('countVariants', { count: faviconCount })),
    check('technical-robots-url', 'techniczne', 'technical-robots-url', technical.robots_txt_url ? 'pass' : 'not_applicable', technical.robots_txt_url || evidence('robotsUrlMissing')),
    check('technical-sitemap-url', 'techniczne', 'technical-sitemap-url', technical.sitemap_url ? 'pass' : 'not_applicable', technical.sitemap_url || evidence('sitemapUrlMissing')),
    check('technical-hreflang', 'techniczne', 'technical-hreflang', hreflangs.length === 0 ? 'not_applicable' : hreflangs.every((tag) => present(tag.href)) ? 'pass' : 'warning', hreflangs.length ? `${hreflangs.filter((tag) => present(tag.href)).length}/${hreflangs.length}` : evidence('missingHreflang')),
    check('technical-hreflang-unique', 'techniczne', 'technical-hreflang-unique', hreflangs.length === 0 ? 'not_applicable' : duplicateHreflang === 0 ? 'pass' : 'warning', evidence('countDuplicates', { count: duplicateHreflang })),
    check('technical-hreflang-http', 'techniczne', 'technical-hreflang-http', hreflangs.length === 0 ? 'not_applicable' : hreflangs.every((tag) => absoluteHttp(tag.href)) ? 'pass' : 'warning', `${hreflangs.filter((tag) => absoluteHttp(tag.href)).length}/${hreflangs.length}`),
    check('technical-technology-signals', 'techniczne', 'technical-technology-signals', !technical.technology_signals?.length ? 'not_applicable' : technical.technology_signals.every((signal) => present(signal.name) && present(signal.evidence)) ? 'pass' : 'warning', evidence('countSignals', { count: technical.technology_signals?.length || 0 })),
    check('technical-technology-confidence', 'techniczne', 'technical-technology-confidence', !technical.technology_signals?.length ? 'not_applicable' : technical.technology_signals.every((signal) => signal.confidence === 'confirmed' || signal.confidence === 'heuristic') ? 'pass' : 'warning', evidence('confirmedSignals', { count: technical.technology_signals?.filter((signal) => signal.confidence === 'confirmed').length || 0 })),
  );

  // Accessibility (10)
  checks.push(
    check('accessibility-language', 'dostepnosc', 'accessibility-language', !accessibility ? 'not_applicable' : present(accessibility.document_language) ? 'pass' : 'warning', accessibility?.document_language || evidence('missingLanguage')),
    check('accessibility-basics', 'dostepnosc', 'accessibility-basics', !accessibility ? 'not_applicable' : !accessibility.document_language || accessibility.unlabeled_form_control_count > 0 ? 'warning' : 'pass', !accessibility ? evidence('accessibilityPending') : evidence('accessibilitySummary', { language: accessibility.document_language || i18n.t('auditChecks.evidence.noDataWord'), landmarks: accessibility.landmarks.map((landmark) => `${landmark.name} (${landmark.count})`).join(', ') || i18n.t('auditChecks.evidence.noDataWord'), unlabeled: accessibility.unlabeled_form_control_count })),
    check('accessibility-main', 'dostepnosc', 'accessibility-main', !accessibility ? 'not_applicable' : mainLandmark?.count === 1 ? 'pass' : 'warning', accessibility ? evidence('mainLandmark', { count: mainLandmark?.count || 0 }) : evidence('missingReport')),
    check('accessibility-landmarks', 'dostepnosc', 'accessibility-landmarks', !accessibility ? 'not_applicable' : totalLandmarks > 0 ? 'pass' : 'warning', accessibility ? evidence('countLandmarks', { count: totalLandmarks }) : evidence('missingReport')),
    check('accessibility-aria-count', 'dostepnosc', 'accessibility-aria-count', !accessibility ? 'not_applicable' : Number.isFinite(accessibility.aria_attribute_count) ? 'pass' : 'error', accessibility ? String(accessibility.aria_attribute_count) : evidence('missingReport')),
    check('accessibility-form-controls', 'dostepnosc', 'accessibility-form-controls', !accessibility ? 'not_applicable' : Number.isFinite(accessibility.form_control_count) ? 'pass' : 'error', accessibility ? `${accessibility.form_control_count}` : evidence('missingReport')),
    check('accessibility-labels', 'dostepnosc', 'accessibility-labels', !accessibility ? 'not_applicable' : accessibility.unlabeled_form_control_count === 0 ? 'pass' : 'warning', accessibility ? evidence('countUnlabeled', { count: accessibility.unlabeled_form_control_count }) : evidence('missingReport')),
    check('accessibility-hidden-controls', 'dostepnosc', 'accessibility-hidden-controls', !accessibility ? 'not_applicable' : 'pass', accessibility ? evidence('countHidden', { count: accessibility.hidden_form_control_count || 0 }) : evidence('missingReport')),
    check('accessibility-honeypot', 'dostepnosc', 'accessibility-honeypot', !accessibility ? 'not_applicable' : 'pass', accessibility ? evidence('countHoneypots', { count: accessibility.anti_spam_text_control_count || 0 }) : evidence('missingReport')),
    check('accessibility-evidence', 'dostepnosc', 'accessibility-evidence', !accessibility ? 'not_applicable' : (accessibility.findings || []).every((finding) => present(finding.evidence) && present(finding.recommendation)) ? 'pass' : 'warning', accessibility ? evidence('countFindings', { count: accessibility.findings?.length || 0 }) : evidence('missingReport')),
    check('accessibility-manual-review', 'dostepnosc', 'accessibility-manual-review', !accessibility ? 'not_applicable' : 'pass', accessibility ? evidence('countManual', { count: accessibility.manual_review_items.length }) : evidence('missingReport')),
  );

  // Content and readability (11)
  const topKeywordDensity = content.top_keywords.reduce((sum, term) => sum + (term.density_percent || 0), 0);
  checks.push(
    check('content-word-count', 'tresc', 'content-word-count', Number.isFinite(content.word_count) ? content.word_count > 0 ? 'pass' : 'warning' : 'error', evidence('countWords', { count: content.word_count })),
    check('content-reading-time', 'tresc', 'content-reading-time', Number.isFinite(content.reading_time_minutes) ? 'pass' : 'error', evidence('countMinutes', { count: content.reading_time_minutes })),
    check('content-text-ratio', 'tresc', 'content-text-ratio', Number.isFinite(content.text_ratio_percent) ? content.text_ratio_percent > 0 ? 'pass' : 'warning' : 'error', `${content.text_ratio_percent}%`),
    check('content-sentence-count', 'tresc', 'content-sentence-count', content.sentence_count === undefined ? 'not_applicable' : content.sentence_count > 0 ? 'pass' : 'warning', content.sentence_count === undefined ? evidence('legacyMetricMissing') : `${content.sentence_count}`),
    check('content-average-sentence', 'tresc', 'content-average-sentence', content.average_words_per_sentence === undefined ? 'not_applicable' : content.average_words_per_sentence <= 30 ? 'pass' : 'warning', content.average_words_per_sentence === undefined ? evidence('missingData') : evidence('countWords', { count: content.average_words_per_sentence.toFixed(1) })),
    check('content-average-word', 'tresc', 'content-average-word', content.average_characters_per_word === undefined ? 'not_applicable' : content.average_characters_per_word <= 12 ? 'pass' : 'warning', content.average_characters_per_word === undefined ? evidence('missingData') : evidence('countCharacters', { count: content.average_characters_per_word.toFixed(1) })),
    check('content-complexity', 'tresc', 'content-complexity', content.complexity_score === undefined ? 'not_applicable' : content.complexity_score <= 70 ? 'pass' : 'warning', content.complexity_score === undefined ? evidence('missingData') : `${content.complexity_score}/100`),
    check('content-readability', 'tresc', 'content-readability', content.readability_ease_score === undefined ? 'not_applicable' : content.readability_ease_score >= 50 ? 'pass' : 'warning', content.readability_ease_score === undefined ? evidence('missingData') : `${content.readability_ease_score.toFixed(1)}/100`),
    check('content-readability-grade', 'tresc', 'content-readability-grade', content.readability_grade === undefined ? 'not_applicable' : content.readability_grade <= 12 ? 'pass' : 'warning', content.readability_grade === undefined ? evidence('missingData') : `${content.readability_grade.toFixed(1)}`),
    check('content-keyword-density', 'tresc', 'content-keyword-density', topKeywordDensity <= 25 ? 'pass' : 'warning', `${topKeywordDensity.toFixed(2)}%`),
    check('content-truncation', 'tresc', 'content-truncation', content.body_text_truncated === true ? 'warning' : content.body_text !== undefined ? 'pass' : 'not_applicable', content.body_text_truncated ? evidence('contentTruncated') : content.body_text !== undefined ? evidence('countCharacters', { count: content.body_text.length }) : evidence('legacyBodyTextMissing')),
  );

  // AMP and transport (12)
  checks.push(
    check('amp-detected', 'amp', 'amp-detected', !amp ? 'not_applicable' : amp.detected ? 'pass' : 'not_applicable', amp ? (amp.detected ? evidence('ampDetected') : evidence('ampNotDetected')) : evidence('ampReportMissing')),
    check('amp-document-consistency', 'amp', 'amp-document-consistency', !amp ? 'not_applicable' : amp.is_amp_document === amp.detected || !amp.detected ? 'pass' : 'warning', amp ? evidence('ampConsistency', { detected: i18n.t(amp.detected ? 'auditChecks.evidence.ampDetectedState' : 'auditChecks.evidence.ampNotDetectedState'), document: i18n.t(amp.is_amp_document ? 'auditChecks.evidence.ampDocumentState' : 'auditChecks.evidence.ampRegularState') }) : evidence('missingData')),
    check('amp-canonical', 'amp', 'amp-canonical', !amp || !amp.is_amp_document ? 'not_applicable' : present(amp.canonical_url) ? 'pass' : 'warning', amp?.canonical_url || evidence('missingAmpCanonical')),
    check('amp-alternate-urls', 'amp', 'amp-alternate-urls', !amp || amp.amphtml_urls.length === 0 ? 'not_applicable' : amp.amphtml_urls.every((url) => absoluteHttp(url)) ? 'pass' : 'warning', amp ? evidence('countGoals', { count: amp.amphtml_urls.length }) : evidence('missingData')),
    check('amp-findings', 'amp', 'amp-findings', !amp || amp.findings.length === 0 ? 'not_applicable' : amp.findings.every((finding) => present(finding.recommendation)) ? 'pass' : 'warning', amp ? evidence('countFindings', { count: amp.findings.length }) : evidence('missingData')),
    check('amp-unchecked', 'amp', 'amp-unchecked', !amp ? 'not_applicable' : 'pass', amp ? evidence('countUnverified', { count: amp.unchecked.length }) : evidence('missingData')),
    check('transport-scheme', 'transport', 'transport-scheme', !transport ? 'not_applicable' : transport.https === finalUrlIsHttps ? 'pass' : 'warning', transport?.scheme || evidence('transportReportMissing')),
    check('transport-https', 'transport', 'transport-https', !transport ? 'not_applicable' : transport.https ? 'pass' : 'warning', transport ? evidence('transportScheme', { scheme: transport.https ? 'HTTPS' : 'HTTP' }) : evidence('missingData')),
    check('transport-mixed-content', 'transport', 'transport-mixed-content', !transport || transport.mixed_content_urls.length === 0 ? 'pass' : 'error', transport ? evidence('countMixed', { count: transport.mixed_content_urls.length }) : evidence('missingReport')),
    check('transport-cookies', 'transport', 'transport-cookies', !transport || transport.cookies.length === 0 ? 'not_applicable' : transport.cookies.every((cookie) => present(cookie.name)) ? 'pass' : 'warning', transport ? evidence('countCookies', { count: transport.cookies.length }) : evidence('missingData')),
    check('transport-tls-coverage', 'transport', 'transport-tls-coverage', !transport ? 'not_applicable' : present(transport.tls_coverage) ? 'pass' : 'warning', transport?.tls_coverage || evidence('missingData')),
    check('transport-cookie-names-only', 'transport', 'transport-cookie-names-only', !transport ? 'not_applicable' : 'pass', transport ? evidence('countCookieNames', { count: transport.cookies.length }) : evidence('missingData')),
  );

  return checks;
};
