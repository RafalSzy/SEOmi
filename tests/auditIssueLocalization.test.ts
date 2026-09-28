import { afterEach, describe, expect, it } from 'vitest';
import i18n, { LANGUAGES } from '@/i18n';
import { localizeAuditIssue } from '@/services/auditIssueLocalization';
import type { Issue } from '@/types';

const sourceText = 'Dostępność · finding: surowy komunikat backendu';

const issue = (code: string, params: Record<string, string> = {}): Issue => ({
  severity: 'Warning',
  category: 'Technical',
  code,
  params,
  message: sourceText,
  recommendation: 'Surowa rekomendacja backendu',
});

describe('audit issue localization', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('localizes every accessibility finding code in Polish', async () => {
    await i18n.changeLanguage('pl');
    const findings: Array<[string, Record<string, string>]> = [
      ['accessibility-document-language-missing', {}],
      ['accessibility-document-language-invalid', { value: 'xx' }],
      ['accessibility-main-landmark-missing', {}],
      ['accessibility-multiple-main-landmarks', { count: '2' }],
      ['accessibility-antispam-control-not-text', {}],
      ['accessibility-form-controls-unlabeled', { unlabeled: '4', total: '14' }],
      ['accessibility-duplicate-id', { value: 'id=content' }],
      ['accessibility-aria-reference-unresolved', { value: 'aria-labelledby=missing' }],
      ['accessibility-interactive-name-missing', { value: 'button#save' }],
      ['accessibility-focusable-aria-hidden', { count: '2' }],
      ['accessibility-image-alt-missing', { count: '3' }],
    ];

    for (const [code, params] of findings) {
      const localized = localizeAuditIssue(issue(code, params), i18n.t.bind(i18n));
      expect(localized.displayMessage, code).not.toBe(sourceText);
      expect(localized.displayMessage, code).not.toContain('Dostępność ·');
      expect(localized.displayRecommendation, code).not.toBe('Surowa rekomendacja backendu');
    }

    const unlabeled = localizeAuditIssue(
      issue('accessibility-form-controls-unlabeled', { unlabeled: '4', total: '14' }),
      i18n.t.bind(i18n),
    );
    expect(unlabeled.displayMessage).toContain('4 z 14');
  });

  it('keeps legacy accessibility records localizable without a stable code', async () => {
    await i18n.changeLanguage('en');
    const localized = localizeAuditIssue({
      severity: 'Warning',
      category: 'Technical',
      message: 'Dostępność · accessibility-form-controls-unlabeled: 4 of 14 controls',
      recommendation: 'Associate every control with a programmatic label',
    }, i18n.t.bind(i18n));

    expect(localized.displayMessage).toContain('4 of 14');
    expect(localized.displayMessage).not.toContain('Dostępność ·');

    const englishPrefixed = localizeAuditIssue({
      severity: 'Warning',
      category: 'Technical',
      message: 'Accessibility · accessibility-form-controls-unlabeled: 4 of 14 controls',
      recommendation: 'Associate every control with a programmatic label',
    }, i18n.t.bind(i18n));
    expect(englishPrefixed.displayMessage).toContain('4 of 14');
    expect(englishPrefixed.displayMessage).not.toContain('Accessibility ·');
  });

  it('does not leak the backend accessibility prefix in any configured locale', async () => {
    for (const locale of LANGUAGES) {
      await i18n.changeLanguage(locale.code);
      const localized = localizeAuditIssue(
        issue('accessibility-interactive-name-missing', { value: 'button#save' }),
        i18n.t.bind(i18n),
      );
      expect(localized.displayMessage, locale.code).not.toContain('Dostępność ·');
      expect(localized.displayRecommendation, locale.code).not.toContain('Surowa');
    }
  });
});
