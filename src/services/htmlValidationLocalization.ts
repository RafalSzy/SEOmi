import type { TFunction } from 'i18next';
import type { CrawledHtmlValidationFinding } from '@/types';

const messageKeys: Record<string, string> = {
  'html-doctype-missing': 'htmlValidationFindings.messageDoctypeMissing',
  'html-doctype-invalid': 'htmlValidationFindings.messageDoctypeInvalid',
  'html-doctype-duplicate': 'htmlValidationFindings.messageDoctypeDuplicate',
  'html-lang-missing': 'htmlValidationFindings.messageLangMissing',
  'html-meta-charset-missing': 'htmlValidationFindings.messageMetaCharsetMissing',
  'html-duplicate-id': 'htmlValidationFindings.messageDuplicateId',
  'html-uri-invalid': 'htmlValidationFindings.messageUriInvalid',
  'encoding-unsupported-label': 'htmlValidationFindings.messageEncodingUnsupported',
  'encoding-invalid-byte-sequence': 'htmlValidationFindings.messageEncodingInvalid',
};

export interface LocalizedHtmlValidationFinding {
  displayMessage: string;
  /** Original parser message remains available as source evidence/export. */
  evidenceMessage: string;
}

export const localizeHtmlValidationFinding = (
  finding: CrawledHtmlValidationFinding,
  t: TFunction,
): LocalizedHtmlValidationFinding => ({
  displayMessage: t(messageKeys[finding.code] ?? 'htmlValidationFindings.messageGeneric', {
    code: finding.code,
    element: finding.element || t('htmlValidationFindings.unknownElement'),
    attribute: finding.attribute || t('htmlValidationFindings.unknownAttribute'),
    defaultValue: finding.message,
  }),
  evidenceMessage: finding.message,
});
