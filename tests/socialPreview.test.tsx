import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialPreview } from '../src/components/Results/SocialPreview';
import { useProjectStore } from '../src/stores/projectStore';
import { useAuditStore } from '../src/stores/auditStore';
import { PageAuditData } from '../src/types';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => key === 'uiUnits.pixelValue' ? `${options?.value}px` : key }),
}));

const audit = {
  url: 'https://example.com/page',
  final_url: 'https://example.com/page',
  meta_tags: { title: 'Original title', title_length: 14, description: 'An original description for the test page.', description_length: 42, other_tags: [] },
  open_graph: { og_title: 'Original title', og_description: 'An original description for the test page.', og_site_name: 'Example', all_tags: [] },
  twitter_card: { all_tags: [] },
  images: [],
  technical: { hreflang_tags: [] },
} as unknown as PageAuditData;

describe('live Google SERP preview', () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({ activeProjectId: 'serp-project' });
    useAuditStore.setState({ showOnlyProblems: false });
  });

  afterEach(cleanup);

  it('updates the desktop/mobile preview live and persists drafts per project and URL', async () => {
    const first = render(<SocialPreview audit={audit} />);
    fireEvent.change(screen.getByPlaceholderText('legacyUi.social.titlePlaceholder'), { target: { value: 'Updated SERP title for search results' } });
    fireEvent.change(screen.getByPlaceholderText('legacyUi.social.descriptionPlaceholder'), { target: { value: 'Search results preview shows search results live while the page owner edits title and description metadata.' } });
    fireEvent.change(screen.getByPlaceholderText('legacyUi.social.searchQueryPlaceholder'), { target: { value: 'search results' } });

    expect(screen.getAllByRole('heading', { name: 'Updated SERP title for search results' }).length).toBeGreaterThan(1);
    const snippet = screen.getByLabelText('legacyUi.social.googleSnippetAria');
    expect(Array.from(snippet.querySelectorAll('strong')).map((item) => item.textContent)).toEqual(['Search', 'results', 'search', 'results']);
    fireEvent.click(screen.getByText('social.mobile'));
    expect(screen.getByText(/340px \(mobile\)/)).toBeTruthy();

    const key = 'seomi_serp_preview_serp-project_https%3A%2F%2Fexample.com%2Fpage';
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      expect(saved).toMatchObject({
        title: 'Updated SERP title for search results',
        query: 'search results',
      });
    });
    first.unmount();

    render(<SocialPreview audit={audit} />);
    expect(screen.getByPlaceholderText('legacyUi.social.titlePlaceholder')).toHaveProperty('value', 'Updated SERP title for search results');
    expect(screen.getByPlaceholderText('legacyUi.social.searchQueryPlaceholder')).toHaveProperty('value', 'search results');
    expect(within(screen.getByLabelText('legacyUi.social.googleSnippetAria')).getAllByText('results').length).toBeGreaterThan(0);
  });

  it('renders evidence-backed sitelinks and rich-result candidates from the audit', () => {
    render(<SocialPreview audit={{
      ...audit,
      links: { total_links: 1, internal_links: 1, external_links: 0, nofollow_links: 0, links: [{ href: '/about', text: 'About us', is_internal: true }] },
      structured_data: [{ data_type: 'Product', format: 'JSON-LD', content: { '@type': 'Product', name: 'SEO audit', offers: { price: '99', priceCurrency: 'PLN' } } }],
    }} />);
    expect(screen.getByText('About us')).toBeTruthy();
    expect(screen.getByText('Product rich result')).toBeTruthy();
    expect(screen.getByText('99 PLN')).toBeTruthy();
  });
});
