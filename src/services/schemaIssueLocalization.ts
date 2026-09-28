import type { TFunction } from 'i18next';
import type { StructuredDataValidationIssue } from '@/types';

export interface StructuredDataFindingContext {
  format: string;
  dataType: string;
}

export interface LocalizedStructuredDataFinding {
  displaySeverity: string;
  displayMessage: string;
  displayRecommendation?: string;
  /** Original validator output kept for evidence/export only. */
  evidenceMessage: string;
  evidenceRecommendation?: string;
}

type MessageKind =
  | 'missing'
  | 'invalid'
  | 'empty'
  | 'duplicate'
  | 'notDetected'
  | 'truncated'
  | 'unsupported'
  | 'generic';

const messageKindForCode = (code: string): MessageKind => {
  const normalized = code.toLocaleLowerCase();
  if (normalized.includes('truncated')) return 'truncated';
  if (normalized.includes('unsupported')) return 'unsupported';
  if (normalized.includes('not-detected') || normalized.includes('non-schema')) return 'notDetected';
  if (normalized.includes('duplicate')) return 'duplicate';
  if (normalized.includes('missing') || normalized.includes('not-absolute')) return 'missing';
  if (normalized.includes('empty')) return 'empty';
  if (normalized.includes('invalid') || normalized.includes('shape')) return 'invalid';
  return 'generic';
};

const messageKeyForKind = (kind: MessageKind): string => `schemaFindings.message${kind[0].toUpperCase()}${kind.slice(1)}`;

/**
 * Localize deterministic Schema.org findings without replacing the raw
 * validator output stored in a snapshot. The stable code is the portable
 * contract; the original message remains available as evidence/export data.
 */
export const localizeStructuredDataFinding = (
  finding: StructuredDataValidationIssue,
  context: StructuredDataFindingContext,
  t: TFunction,
): LocalizedStructuredDataFinding => {
  const path = finding.path || t('schemaFindings.noPath');
  const params = {
    code: finding.code,
    format: context.format,
    type: context.dataType,
    severity: finding.severity,
    path,
  };
  const kind = messageKindForCode(finding.code);
  const displayMessage = t(messageKeyForKind(kind), params);
  const displaySeverity = finding.severity === 'error'
    ? t('schemaFindings.severityError')
    : finding.severity === 'warning'
      ? t('schemaFindings.severityWarning')
      : t('schemaFindings.severityInfo');
  const displayRecommendation = finding.recommendation
    ? t('schemaFindings.recommendation', params)
    : undefined;

  return {
    displaySeverity,
    displayMessage,
    displayRecommendation,
    evidenceMessage: finding.message,
    evidenceRecommendation: finding.recommendation,
  };
};
