import { afterEach, describe, expect, it } from 'vitest';
import i18n, { LANGUAGES } from '@/i18n';
import { localizeStructuredDataFinding } from '@/services/schemaIssueLocalization';

describe('structured-data finding localization', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('localizes stable validator codes in every configured locale while preserving evidence', async () => {
    const finding = {
      code: 'product-name-missing',
      severity: 'warning' as const,
      message: 'Product has no name property in the locally supported product rich-result profile.',
      path: '$.name',
      recommendation: 'Add a non-empty name property to Product.',
    };

    for (const locale of LANGUAGES) {
      await i18n.changeLanguage(locale.code);
      const localized = localizeStructuredDataFinding(
        finding,
        { format: 'JSON-LD', dataType: 'Product' },
        i18n.t.bind(i18n),
      );
      expect(localized.displayMessage, locale.code).toContain('product-name-missing');
      expect(localized.displayMessage, locale.code).not.toContain(finding.message);
      expect(localized.displayRecommendation, locale.code).not.toContain(finding.recommendation);
      expect(localized.evidenceMessage).toBe(finding.message);
      expect(localized.evidenceRecommendation).toBe(finding.recommendation);
    }
  });

  it('selects localized wording for invalid, empty, duplicate, and bounded findings', async () => {
    await i18n.changeLanguage('pl');
    const translate = (code: string) => localizeStructuredDataFinding({
      code,
      severity: 'warning',
      message: `raw-${code}`,
      recommendation: `raw-recommendation-${code}`,
    }, { format: 'Microdata', dataType: 'Product' }, i18n.t.bind(i18n));

    expect(translate('product-related-property-shape-invalid').displayMessage).toContain('nieprawidłową');
    expect(translate('product-name-empty-or-invalid').displayMessage).toContain('pustą');
    expect(translate('jsonld-type-duplicate').displayMessage).toContain('zduplikowaną');
    expect(translate('schema-validation-traversal-truncated').displayMessage).toContain('limit bezpieczeństwa');
  });
});

