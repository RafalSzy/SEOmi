import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditTabs } from '@/components/Results/AuditTabs';
import { useAuditStore } from '@/stores/auditStore';

describe('single-page audit tab navigation', () => {
  beforeEach(() => {
    useAuditStore.setState({ activeTab: 'overview', showOnlyProblems: false });
  });

  it('groups audit tabs and exposes real tab semantics', () => {
    render(<AuditTabs />);

    expect(screen.getByRole('navigation', { name: /Audit sections/i })).not.toBeNull();
    expect(screen.getByRole('tablist', { name: /Audit result tabs/i })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Content' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Technical' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Data' })).not.toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(11);
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-controls')).toBe('audit-panel');
  });

  it('supports keyboard movement across groups and toggles the problem filter', () => {
    render(<AuditTabs />);
    const overview = screen.getByRole('tab', { name: 'Overview' });

    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(useAuditStore.getState().activeTab).toBe('metadata');
    expect(screen.getByRole('tab', { name: /Meta Tags|Metadata/i }).getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(screen.getByRole('tab', { name: /Meta Tags|Metadata/i }), { key: 'End' });
    expect(useAuditStore.getState().activeTab).toBe('dataforseo');

    fireEvent.click(screen.getByRole('button', { name: /Only problems/i }));
    expect(useAuditStore.getState().showOnlyProblems).toBe(true);
  });
});
