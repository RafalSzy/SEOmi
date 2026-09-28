import { describe, expect, it } from 'vitest';
import { normalizeRankTrackingMarketDraft } from '@/components/Keywords/RankTracking';

describe('rank tracking market draft', () => {
  it('keeps the selected language supported by the new location', () => {
    expect(normalizeRankTrackingMarketDraft('DE', 'pl')).toEqual({ location: 'DE', language: 'de' });
    expect(normalizeRankTrackingMarketDraft('CH', 'it')).toEqual({ location: 'CH', language: 'it' });
  });
});
