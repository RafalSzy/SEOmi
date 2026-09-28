import { afterEach, describe, expect, it } from 'vitest';
import i18n, { LANGUAGES } from '@/i18n';
import { localizeHtmlValidationFinding } from '@/services/htmlValidationLocalization';

describe('HTML validation finding localization', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('localizes stable HTML validation codes without discarding parser evidence', async () => {
    const finding = {
      code: 'html-uri-invalid',
      severity: 'Warning',
      message: 'Wartość atrybutu URI ma niepoprawne kodowanie procentowe.',
      element: 'a',
      attribute: 'href',
    };
    for (const locale of LANGUAGES) {
      await i18n.changeLanguage(locale.code);
      const localized = localizeHtmlValidationFinding(finding, i18n.t.bind(i18n));
      expect(localized.displayMessage, locale.code).not.toBe(finding.message);
      expect(localized.displayMessage.length, locale.code).toBeGreaterThan(0);
      expect(localized.evidenceMessage).toBe(finding.message);
    }
  });

  it('has translated entries for the document language and charset rules', async () => {
    for (const code of [
      'html-doctype-invalid',
      'html-doctype-duplicate',
      'html-lang-missing',
      'html-meta-charset-missing',
    ]) {
      for (const locale of LANGUAGES) {
        await i18n.changeLanguage(locale.code);
        const localized = localizeHtmlValidationFinding({
          code,
          severity: 'Warning',
          message: `parser evidence for ${code}`,
          element: 'html',
          attribute: 'lang',
        }, i18n.t.bind(i18n));
        expect(localized.displayMessage, `${locale.code}:${code}`).not.toContain(code);
        expect(localized.displayMessage.length, `${locale.code}:${code}`).toBeGreaterThan(0);
      }
    }
  });
});
