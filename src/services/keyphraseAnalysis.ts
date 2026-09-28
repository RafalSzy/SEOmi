import { PageAuditData, HeadingNode } from '@/types';
import i18n from '@/i18n';

export interface KeyphraseEvidence {
  field: 'title' | 'meta_description' | 'headings' | 'anchors' | 'body';
  label: string;
  occurrences: number;
  evidence: string[];
}

export const flattenHeadings = (nodes: HeadingNode[]): HeadingNode[] => nodes.flatMap((node) => [node, ...flattenHeadings(node.children)]);

const occurrences = (value: string, phrase: string): number => value.toLocaleLowerCase().split(phrase.toLocaleLowerCase()).length - 1;

const evidenceExcerpt = (value: string, phrase: string): string => {
  const lowerValue = value.toLocaleLowerCase();
  const matchAt = lowerValue.indexOf(phrase.toLocaleLowerCase());
  if (matchAt < 0 || value.length <= 180) return value;
  const start = Math.max(0, matchAt - 70);
  const end = Math.min(value.length, matchAt + phrase.length + 90);
  return `${start ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`;
};

export const analyzeKeyphrase = (audit: PageAuditData, input: string): KeyphraseEvidence[] => {
  const phrase = input.trim();
  if (!phrase) return [];
  const headings = flattenHeadings(audit.headings.hierarchy);
  const sources: Array<[KeyphraseEvidence['field'], string, string[]]> = [
    ['title', i18n.t('runtimeErrors.keyphrase.title'), audit.meta_tags.title ? [audit.meta_tags.title] : []],
    ['meta_description', i18n.t('runtimeErrors.keyphrase.metaDescription'), audit.meta_tags.description ? [audit.meta_tags.description] : []],
    ['headings', i18n.t('runtimeErrors.keyphrase.headings'), headings.map((heading) => heading.text)],
    ['anchors', i18n.t('runtimeErrors.keyphrase.anchors'), audit.links.links.map((link) => link.text)],
    ['body', i18n.t('runtimeErrors.keyphrase.body'), audit.content_stats.body_text ? [audit.content_stats.body_text] : []],
  ];
  return sources.map(([field, label, values]) => {
    const matches = values.filter((value) => value.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()));
    return { field, label, occurrences: values.reduce((total, value) => total + occurrences(value, phrase), 0), evidence: matches.map((value) => evidenceExcerpt(value, phrase)) };
  });
};
