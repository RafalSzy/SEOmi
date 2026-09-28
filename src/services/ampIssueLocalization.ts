import type { TFunction } from 'i18next';
import type { AmpFinding } from '@/types';

export interface LocalizedAmpFinding {
  displayMessage: string;
  displayRecommendation?: string;
  evidenceMessage: string;
  evidenceRecommendation: string;
}

type AmpMessageKind = 'missing' | 'invalid' | 'duplicate' | 'truncated' | 'generic';

const kindForCode = (code: string): AmpMessageKind => {
  const normalized = code.toLocaleLowerCase();
  if (normalized.includes('limit') || normalized.includes('over-budget')) return 'truncated';
  if (normalized.includes('multiple')) return 'duplicate';
  if (normalized.includes('missing')) return 'missing';
  if (
    normalized.includes('invalid') ||
    normalized.includes('not-allowlisted') ||
    normalized.includes('not-allowed') ||
    normalized.includes('event-handler') ||
    normalized.includes('css-import')
  ) return 'invalid';
  return 'generic';
};

const keyForKind = (kind: AmpMessageKind): string => `ampFindings.message${kind[0].toUpperCase()}${kind.slice(1)}`;

/** Resolve local AMP rule output for the active locale without mutating evidence. */
export const localizeAmpFinding = (
  finding: AmpFinding,
  t: TFunction,
): LocalizedAmpFinding => {
  const params = {
    code: finding.code,
    severity: finding.severity,
  };
  return {
    displayMessage: t(keyForKind(kindForCode(finding.code)), params),
    displayRecommendation: finding.recommendation
      ? t('ampFindings.recommendation', params)
      : undefined,
    evidenceMessage: finding.message,
    evidenceRecommendation: finding.recommendation,
  };
};
