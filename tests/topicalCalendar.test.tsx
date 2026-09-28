import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicalCalendar } from '@/components/Charts/TopicalCalendar';
import { createTopicalNode, type TopicalNode } from '@/services/topicalMap';
import i18n from '@/i18n';

const planned = { ...createTopicalNode('Coffee guide'), id: 'planned', scheduledDate: '2026-09-10', lifecycle: 'planned' as const };
const published = { ...createTopicalNode('Coffee beans'), id: 'published', scheduledDate: '2026-09-18', lifecycle: 'published' as const };
const backlog = { ...createTopicalNode('Coffee grinder'), id: 'backlog', scheduledDate: '', lifecycle: 'published' as const };
const filters = { lifecycle: 'all' as const, kind: 'all' as const, boundary: 'all' as const };

const renderCalendar = (nodes: TopicalNode[] = [planned, published, backlog]) => {
  const handlers = { onMonthChange: vi.fn(), onFiltersChange: vi.fn(), onSearchChange: vi.fn(), onSelect: vi.fn(), onCreate: vi.fn(), onBack: vi.fn() };
  render(<TopicalCalendar nodes={nodes} month="2026-09" filters={filters} search="" {...handlers} />);
  return handlers;
};

describe('TopicalCalendar', () => {
  beforeEach(async () => { await i18n.changeLanguage('pl'); });
  it('navigates months, opens scheduled and unscheduled topics, and creates a date-bound topic', () => {
    const handlers = renderCalendar();

    fireEvent.click(screen.getByRole('button', { name: 'Następny miesiąc' }));
    expect(handlers.onMonthChange).toHaveBeenCalledWith('2026-10');
    fireEvent.click(screen.getByRole('button', { name: 'Coffee guide' }));
    expect(handlers.onSelect).toHaveBeenCalledWith('planned');
    fireEvent.click(screen.getByRole('button', { name: /Coffee grinder/ }));
    expect(handlers.onSelect).toHaveBeenCalledWith('backlog');
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj temat na 2026-09-11' }));
    expect(handlers.onCreate).toHaveBeenCalledWith('2026-09-11');
    fireEvent.click(screen.getByRole('button', { name: 'Powrót do listy tematów' }));
    expect(handlers.onBack).toHaveBeenCalledOnce();
  });

  it('filters by lifecycle, kind, boundary and terms without mutating topical nodes', () => {
    const nodes = [planned, published, backlog];
    const handlers = renderCalendar(nodes);
    fireEvent.change(screen.getByLabelText('Filtruj etap kalendarza'), { target: { value: 'published' } });
    expect(handlers.onFiltersChange).toHaveBeenCalledWith({ ...filters, lifecycle: 'published' });
    fireEvent.change(screen.getByLabelText('Szukaj tematów w kalendarzu'), { target: { value: 'espresso' } });
    expect(handlers.onSearchChange).toHaveBeenCalledWith('espresso');
    expect(nodes).toHaveLength(3);
    expect(screen.getByText('1 tematów po filtrach')).toBeTruthy();
  });
});
