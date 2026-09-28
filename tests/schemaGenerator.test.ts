import { describe, expect, it } from 'vitest';
import { generateSchemaGraph } from '@/services/schemaGenerator';
import { createEmptyTopicalMap } from '@/services/topicalMap';
import i18n from '@/i18n';

describe('generateSchemaGraph', () => {
  it('creates only WebSite and WebPage data when no organization is supplied', () => {
    const result = generateSchemaGraph({
      siteUrl: 'https://example.test/blog/post?utm_source=x',
      page: { url: 'https://example.test/blog/post#section', title: 'Przewodnik', description: 'Opis strony' },
      entity: { name: '', description: '', facts: [] },
      includeOrganization: true,
    });
    expect(result.schema['@context']).toBe('https://schema.org');
    expect(result.schema['@graph']).toEqual([
      { '@type': 'WebSite', '@id': 'https://example.test/#website', url: 'https://example.test' },
      {
        '@type': 'WebPage', '@id': 'https://example.test/blog/post#webpage',
        url: 'https://example.test/blog/post', name: 'Przewodnik', description: 'Opis strony',
        isPartOf: { '@id': 'https://example.test/#website' },
      },
    ]);
    expect(result.omitted).toContain(i18n.t('runtimeErrors.schema.organizationOmitted'));
  });

  it('includes only user-verified facts with valid source URLs and links page to organization', () => {
    const entity = createEmptyTopicalMap().entity;
    entity.name = 'Przykładowa firma';
    entity.description = 'Opis wprowadzony w profilu projektu';
    entity.facts = [
      { id: 'verified', attribute: 'obszar', value: 'Warszawa', sourceUrl: 'https://example.test/o-nas', reuseStatus: 'verified' },
      { id: 'locked', attribute: 'liczba pracowników', value: '200', sourceUrl: 'https://example.test/o-nas', reuseStatus: 'locked' },
      { id: 'bad-source', attribute: 'certyfikat', value: 'ISO', sourceUrl: 'file:///tmp/source', reuseStatus: 'verified' },
    ];
    const result = generateSchemaGraph({
      siteUrl: 'https://example.test/',
      page: { url: 'https://example.test/uslugi', title: 'Usługi' },
      entity,
      includeOrganization: true,
    });
    const graph = result.schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph).toHaveLength(3);
    expect(graph[0].additionalProperty).toEqual([{ '@type': 'PropertyValue', name: 'obszar', value: 'Warszawa', url: 'https://example.test/o-nas' }]);
    expect(graph[2].publisher).toEqual({ '@id': 'https://example.test/#organization' });
    expect(result.usedVerifiedFacts).toBe(1);
  });

  it('rejects non-http page URLs and omits missing crawled fields rather than inventing values', () => {
    const input = { siteUrl: 'https://example.test', page: { url: 'javascript:alert(1)' }, entity: { name: '', description: '', facts: [] }, includeOrganization: false };
    expect(() => generateSchemaGraph(input)).toThrow(i18n.t('runtimeErrors.schema.invalidUrl'));
    const result = generateSchemaGraph({ ...input, page: { url: 'https://example.test/page' } });
    const page = (result.schema['@graph'] as Array<Record<string, unknown>>)[1];
    expect(page.name).toBeUndefined();
    expect(page.description).toBeUndefined();
    expect(result.omitted).toHaveLength(2);
  });

  it('adds URL-derived breadcrumbs only when explicitly enabled', () => {
    const result = generateSchemaGraph({
      siteUrl: 'https://example.test',
      page: { url: 'https://example.test/guides/coffee-beans', title: 'Coffee' },
      entity: { name: '', description: '', facts: [] },
      includeOrganization: false,
      includeUrlBreadcrumbs: true,
    });
    const graph = result.schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph).toEqual(expect.arrayContaining([
      expect.objectContaining({
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'guides', item: 'https://example.test/guides' },
          { '@type': 'ListItem', position: 2, name: 'coffee beans', item: 'https://example.test/guides/coffee-beans' },
        ],
      }),
    ]));
    expect(result.usedUrlBreadcrumbs).toBe(2);
  });

  it('adds an article node only for a type observed on the selected crawl page', () => {
    const observed = generateSchemaGraph({
      siteUrl: 'https://example.test',
      page: { url: 'https://example.test/news/item', title: 'News item', schemaTypes: ['https://schema.org/NewsArticle'] },
      entity: { name: '', description: '', facts: [] },
      includeOrganization: false,
      articleType: 'NewsArticle',
    });
    const observedGraph = observed.schema['@graph'] as Array<Record<string, unknown>>;
    expect(observedGraph).toEqual(expect.arrayContaining([expect.objectContaining({ '@type': 'NewsArticle', headline: 'News item' })]));
    expect(observed.usedArticleType).toBe('NewsArticle');

    const unobserved = generateSchemaGraph({
      siteUrl: 'https://example.test',
      page: { url: 'https://example.test/news/item', title: 'News item', schemaTypes: ['WebPage'] },
      entity: { name: '', description: '', facts: [] },
      includeOrganization: false,
      articleType: 'NewsArticle',
    });
    expect((unobserved.schema['@graph'] as Array<Record<string, unknown>>).some((item) => item['@type'] === 'NewsArticle')).toBe(false);
    expect(unobserved.omitted).toContain(i18n.t('runtimeErrors.schema.articleTypeNotObserved'));
    expect(unobserved.usedArticleType).toBeNull();
  });
});
