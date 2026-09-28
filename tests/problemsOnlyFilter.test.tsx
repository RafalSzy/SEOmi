import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MetadataTable } from '@/components/Results/MetadataTable';
import { SocialPreview } from '@/components/Results/SocialPreview';
import { StructuredDataView } from '@/components/Results/StructuredDataView';
import { useAuditStore } from '@/stores/auditStore';
import { PageAuditData } from '@/types';
import i18n from '@/i18n';

const problematicAudit: PageAuditData = {
  url: 'https://example.com', final_url: 'https://example.com', timestamp: '2026-09-22T00:00:00.000Z', http_status: 200, response_time_ms: 120, redirect_chain: [],
  meta_tags: { title_length: 0, description_length: 0, other_tags: [] }, open_graph: { all_tags: [] }, twitter_card: { all_tags: [] }, headings: { h1_count: 1, h1_texts: ['Topic'], hierarchy: [], has_valid_hierarchy: true, issues: [] }, images: [], links: { total_links: 0, internal_links: 0, external_links: 0, nofollow_links: 0, links: [] }, security_headers: { score: 90 }, structured_data: [], technical: { hreflang_tags: [] }, health_score: 100, issues: [], content_stats: { word_count: 100, reading_time_minutes: 1, text_ratio_percent: 10, top_keywords: [] },
};

describe('only-problems filter in remaining audit tabs', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('pl');
    useAuditStore.setState({ showOnlyProblems: true });
  });

  it('replaces the metadata table with evidence-backed metadata findings', () => {
    render(<MetadataTable audit={problematicAudit} />);
    expect(screen.getByRole('region', { name: 'Problemy: metadane' }).textContent).toContain('Brak tytułu strony');
    expect(screen.queryByText('Technical Directives & Robots')).toBeNull();
  });

  it('replaces social previews with missing social declarations', () => {
    render(<SocialPreview audit={problematicAudit} />);
    expect(screen.getByRole('region', { name: 'Problemy: metadane społecznościowe' }).textContent).toContain('Brak Open Graph title');
    expect(screen.queryByText('Live Real-Time Metadata Sandbox')).toBeNull();
  });

  it('reports the absence of structured data when no declaration was detected', () => {
    render(<StructuredDataView audit={problematicAudit} />);
    expect(screen.getByRole('region', { name: 'Problemy: dane strukturalne' }).textContent).toContain('Brak danych strukturalnych');
  });

  it('shows persisted schema findings in the filtered and detailed views', () => {
    const auditWithFindings = {
      ...problematicAudit,
      structured_data: [{
        data_type: 'Product', format: 'JSON-LD', content: { '@type': 'Product' },
        validation_issues: [
          { code: 'product-name-missing', severity: 'warning' as const, message: 'Product has no name property.' },
          { code: 'jsonld-context-not-detected', severity: 'info' as const, message: 'Informational context note.' },
        ],
      }],
    };
    const filteredView = render(<StructuredDataView audit={auditWithFindings} />);
    const problemRegion = screen.getByRole('region', { name: 'Problemy: dane strukturalne' });
    expect(problemRegion.textContent).toContain('Product has no name property.');
    expect(problemRegion.textContent).not.toContain('Informational context note.');

    filteredView.unmount();
    useAuditStore.setState({ showOnlyProblems: false });
    render(<StructuredDataView audit={auditWithFindings} />);
    expect(screen.getByText(i18n.t('legacyUi.structured.validationFindings', { count: 2 }))).not.toBeNull();
    expect(screen.getByText('Informational context note.')).not.toBeNull();
  });

  it('shows precise DOM locators and safe HTML snippets for unlabeled controls', () => {
    useAuditStore.setState({ showOnlyProblems: false });
    const auditWithAccessibility = {
      ...problematicAudit,
      accessibility: {
        document_language: 'pl', landmarks: [], aria_attribute_count: 0,
        form_control_count: 14, unlabeled_form_control_count: 1,
        hidden_form_control_count: 1,
        hidden_form_controls: [{
          dom_position: 1,
          dom_query: "document.querySelectorAll('input, select, textarea')[0]",
          html_snippet: '<input type="hidden" name="csrf">',
          line: 1,
          column: 1,
        }],
        findings: [{
          code: 'accessibility-form-controls-unlabeled', severity: 'warning',
          message: '1 z 14 kontrolek formularza nie ma wykrytej etykiety programowej.',
          evidence: 'Nieopisane pola: 1/14; szczegóły elementów podano poniżej.',
          recommendation: 'Powiąż pole z etykietą.',
          elements: [{
            dom_position: 4,
            dom_query: "document.querySelectorAll('input, select, textarea')[3]",
            html_snippet: '<input type="email" name="contact">',
            line: 4,
            column: 1,
          }],
        }],
        manual_review_items: [],
      },
    } as PageAuditData;
    render(<MetadataTable audit={auditWithAccessibility} />);

    expect(screen.getByText("document.querySelectorAll('input, select, textarea')[3]")).not.toBeNull();
    expect(screen.getByText('<input type="email" name="contact">')).not.toBeNull();
    expect(screen.getByText('Kontrolka #4 w kolejności DOM (w tym hidden) · źródło 4:1')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Kopiuj kod dowodu kontrolka formularza #4' })).not.toBeNull();
    expect(screen.getByText('Ukryte pola formularza · 1')).not.toBeNull();
    expect(screen.getByText('<input type="hidden" name="csrf">')).not.toBeNull();
  });

  it('shows source evidence and selector-specific actions for duplicate ids and ARIA references', () => {
    useAuditStore.setState({ showOnlyProblems: false });
    const auditWithMarkupFindings = {
      ...problematicAudit,
      accessibility: {
        document_language: 'pl', landmarks: [], aria_attribute_count: 1,
        form_control_count: 0, unlabeled_form_control_count: 0,
        findings: [
          {
            code: 'accessibility-duplicate-id', severity: 'warning',
            message: 'Wykryto 1 powtórzony identyfikator HTML.', evidence: 'Przykłady: duplicate', recommendation: 'Nadaj elementom unikalne identyfikatory.',
            elements: [{ dom_position: 2, dom_query: "document.querySelectorAll('[id]')[1]", html_snippet: '<span id="duplicate">', line: 7, column: 3 }],
          },
          {
            code: 'accessibility-aria-reference-unresolved', severity: 'warning',
            message: 'Wykryto 1 referencję ARIA do nieistniejącego identyfikatora.', evidence: 'aria-labelledby=missing', recommendation: 'Wskaż istniejący element.',
            elements: [{ dom_position: 1, dom_query: "document.querySelectorAll('[aria-labelledby], [aria-describedby], [aria-controls], [aria-owns], [aria-flowto], [aria-details], [aria-errormessage]')[0]", html_snippet: '<div aria-labelledby="missing">', line: 8, column: 1 }],
          },
        ],
        manual_review_items: [],
      },
    } as PageAuditData;
    render(<MetadataTable audit={auditWithMarkupFindings} />);

    expect(screen.getByText("document.querySelectorAll('[id]')[1]")).not.toBeNull();
    expect(screen.getByText('<span id="duplicate">')).not.toBeNull();
    expect(screen.getByText('element z powtórzonym ID #2 w kolejności selektora · źródło 7:3')).not.toBeNull();
    expect(screen.getByText("document.querySelectorAll('[aria-labelledby], [aria-describedby], [aria-controls], [aria-owns], [aria-flowto], [aria-details], [aria-errormessage]')[0]")).not.toBeNull();
    expect(screen.getByText('<div aria-labelledby="missing">')).not.toBeNull();
    expect(screen.getByText('element z referencją ARIA #1 w kolejności selektora · źródło 8:1')).not.toBeNull();
  });
});
