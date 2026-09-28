import { afterEach, describe, expect, it } from 'vitest';
import i18n, { LANGUAGES } from '@/i18n';
import { localizeAmpFinding } from '@/services/ampIssueLocalization';

describe('AMP finding localization', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('keeps parser messages as evidence and localizes the primary copy', async () => {
    const finding = {
      code: 'amp-runtime-missing',
      severity: 'error' as const,
      message: 'AMP runtime script was not found.',
      evidence: 'Missing script[src=...]',
      recommendation: 'Include the official AMP runtime script with the async attribute.',
    };
    for (const locale of LANGUAGES) {
      await i18n.changeLanguage(locale.code);
      const localized = localizeAmpFinding(finding, i18n.t.bind(i18n));
      expect(localized.displayMessage, locale.code).not.toBe(finding.message);
      expect(localized.displayRecommendation, locale.code).not.toBe(finding.recommendation);
      expect(localized.evidenceMessage).toBe(finding.message);
      expect(localized.evidenceRecommendation).toBe(finding.recommendation);
    }
  });
});

