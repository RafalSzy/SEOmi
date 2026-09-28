import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import ar from '@/i18n/locales/ar.json';
import de from '@/i18n/locales/de.json';
import es from '@/i18n/locales/es.json';
import fr from '@/i18n/locales/fr.json';
import itLocale from '@/i18n/locales/it.json';
import ja from '@/i18n/locales/ja.json';
import ko from '@/i18n/locales/ko.json';
import pl from '@/i18n/locales/pl.json';
import pt from '@/i18n/locales/pt.json';
import ru from '@/i18n/locales/ru.json';
import zh from '@/i18n/locales/zh.json';

describe('AMP locale coverage', () => {
  it('does not leave AMP UI copy in the English fallback', () => {
    const locales = { ar, de, es, fr, it: itLocale, ja, ko, pl, pt, ru, zh };
    const scalarKeys = [
      'legacyReportMissing', 'title', 'description', 'reportMissing', 'notDetected',
      'detection', 'documentDeclares', 'alternateUrl', 'ruleScope', 'partialRules',
      'declaredAmpHtml', 'findings', 'noFindings', 'outOfScope',
    ] as const;
    const severityKeys = ['error', 'warning', 'info'] as const;
    for (const [code, locale] of Object.entries(locales)) {
      for (const key of scalarKeys) {
        expect(locale.ampUi[key], `${code}.ampUi.${key}`).not.toBe(en.ampUi[key]);
      }
      for (const key of severityKeys) {
        expect(locale.ampUi.severity[key], `${code}.ampUi.severity.${key}`).toBeTruthy();
      }
    }
  });
});
