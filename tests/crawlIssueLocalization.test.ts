import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { localizeCrawlIssue } from '@/services/crawlIssueLocalization';

describe('crawler issue localization', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('localizes legacy crawler messages without changing the stored message', async () => {
    await i18n.changeLanguage('pl');
    const issue = {
      severity: 'Critical' as const,
      message: 'Missing <title> tag',
    };

    const localized = localizeCrawlIssue(issue, i18n.t.bind(i18n));

    expect(localized.message).toBe(issue.message);
    expect(localized.displayMessage).toBe('Brak tagu <title> strony');
    expect(localized.displayMessage).not.toBe(issue.message);
  });

  it('interpolates crawler evidence and keeps unknown diagnostics intact', async () => {
    await i18n.changeLanguage('de');
    const canonical = localizeCrawlIssue(
      { severity: 'Warning', message: 'Multiple canonical links found (3)' },
      i18n.t.bind(i18n),
    );
    const unknown = localizeCrawlIssue(
      { severity: 'Info', message: 'Browser console error: custom diagnostic' },
      i18n.t.bind(i18n),
    );

    expect(canonical.displayMessage).toContain('3');
    expect(canonical.displayMessage).toContain('Canonical');
    expect(unknown.displayMessage).toBe('Technisches Detail: Browser console error: custom diagnostic');
  });

  it('chooses the correct localized length wording for short and long metadata', async () => {
    await i18n.changeLanguage('en');
    const shortTitle = localizeCrawlIssue(
      { severity: 'Info', message: 'Title length is 12 characters; reference range is 30–60' },
      i18n.t.bind(i18n),
    );
    const longDescription = localizeCrawlIssue(
      { severity: 'Info', message: 'Meta description length is 180 characters; reference range is 70–160' },
      i18n.t.bind(i18n),
    );

    expect(shortTitle.displayMessage).toContain('too short');
    expect(longDescription.displayMessage).toContain('too long');
  });
});
