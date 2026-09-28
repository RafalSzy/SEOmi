import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PageAuditData } from '@/types';
import { SecurityHeaders } from '@/components/Results/SecurityHeaders';
import { useAuditStore } from '@/stores/auditStore';
import i18n from '@/i18n';

const audit = {
  security_headers: { score: 65 },
  technical: {},
  transport_security: {
    scheme: 'https',
    https: true,
    mixed_content_urls: ['http://cdn.example.test/app.js'],
    cookies: [{ name: 'session', secure: false, http_only: true, same_site: 'Lax' }],
    tls_coverage: 'Certificate chain and negotiated TLS version are not inspected.',
  },
} as unknown as PageAuditData;

describe('transport security report', () => {
  beforeEach(async () => { await i18n.changeLanguage('pl'); useAuditStore.setState({ showOnlyProblems: false }); });

  it('shows HTTPS, mixed content and cookie attributes without cookie values', () => {
    render(<SecurityHeaders audit={audit} />);

    expect(screen.getByText('Transport i cookies')).toBeTruthy();
    expect(screen.getByText('HTTPS · HTTPS')).toBeTruthy();
    expect(screen.getByText('http://cdn.example.test/app.js')).toBeTruthy();
    expect(screen.getByText('session')).toBeTruthy();
    expect(screen.getByText('Secure brak')).toBeTruthy();
    expect(screen.getByText('HttpOnly ✓')).toBeTruthy();
    expect(screen.getByText('SameSite Lax')).toBeTruthy();
    expect(screen.getByText(/Certificate chain and negotiated TLS version are not inspected/)).toBeTruthy();
  });
});
