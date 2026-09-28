import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TrendChart } from '@/components/Charts/TrendChart';
import i18n from '@/i18n';

describe('TrendChart', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  it('preserves missing timeline points as gaps instead of zeroes', () => {
    const { container } = render(
      <TrendChart values={[10, null, 30]} label="Historia zdrowia" />,
    );

    expect(screen.getByRole('img', { name: 'Historia zdrowia' })).toBeTruthy();
    const polylines = Array.from(container.querySelectorAll('polyline'));
    expect(polylines).toHaveLength(2);
    expect(polylines[0].getAttribute('points')).toContain('0.00');
    expect(polylines[1].getAttribute('points')).toContain('100.00');
    expect(polylines[0].getAttribute('points')).not.toContain('50.00');
    expect(polylines[1].getAttribute('points')).not.toContain('50.00');
  });

  it('does not draw a chart from a single collected point', () => {
    render(<TrendChart values={[null, 12, undefined]} label="Brak historii" />);

    expect(screen.getByText('No time-series data collected yet.')).toBeTruthy();
  });
});
