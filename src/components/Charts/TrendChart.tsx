import { useTranslation } from 'react-i18next';

interface TrendChartProps {
  values: Array<number | null | undefined>;
  label: string;
  invert?: boolean;
}

export const TrendChart = ({ values, label, invert = false }: TrendChartProps) => {
  const { t } = useTranslation();
  const usable = values
    .map((value, index) => ({ value, index }))
    .filter((entry): entry is { value: number; index: number } => Number.isFinite(entry.value));
  if (usable.length < 2) return <span className="text-[11px] text-slate-500">{t('componentUi.noTimeSeries')}</span>;
  const minimum = Math.min(...usable.map((entry) => entry.value));
  const maximum = Math.max(...usable.map((entry) => entry.value));
  const spread = maximum - minimum || 1;
  const denominator = Math.max(values.length - 1, 1);
  const pointFor = (entry: { value: number; index: number }): string => {
    const x = (entry.index / denominator) * 100;
    const normalized = (entry.value - minimum) / spread;
    const y = 90 - (invert ? 1 - normalized : normalized) * 80;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };
  const segments: string[] = [];
  let segment: string[] = [];
  values.forEach((value, index) => {
    if (Number.isFinite(value)) {
      segment.push(pointFor({ value: value as number, index }));
      return;
    }
    if (segment.length) {
      segments.push(segment.join(' '));
      segment = [];
    }
  });
  if (segment.length) segments.push(segment.join(' '));
  return <svg role="img" aria-label={label} viewBox="0 0 100 100" preserveAspectRatio="none" className="h-16 w-full overflow-visible"><path d="M0 90 H100" className="stroke-slate-800" strokeWidth="1" vectorEffect="non-scaling-stroke" />{segments.map((points, index) => <polyline key={`${label}-${index}`} points={points} fill="none" className="stroke-emerald-400" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />)}</svg>;
};
