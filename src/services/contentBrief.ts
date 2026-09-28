import type { ContentBriefVersion, ContentParagraphReview, TopicalContentBrief, TopicalEntityFact, TopicalNode } from '@/services/topicalMap';
import type { CrawledPageSummary } from '@/types';
import { createId } from '@/services/ids';
import i18n from '@/i18n';

export interface ContentBriefAssessment {
  targetQuery: string | null;
  missingRequiredEntities: string[];
  lockedFactsInDraft: TopicalEntityFact[];
  unavailableInternalLinks: string[];
  unreviewedParagraphs: string[];
  unsupportedParagraphs: string[];
  wordCount: number;
  paragraphCount: number;
  draftQuality: DraftQualityAssessment;
  aeoReadiness: AeoReadinessAssessment;
  readyForBrief: boolean;
  readyToAdvance: boolean;
}

export interface DraftQualityAssessment {
  score: number;
  grade: 'excellent' | 'good' | 'needs-work' | 'thin';
  components: { depth: number; examples: number; specificity: number; antiFiller: number; length: number };
  wordCount: number;
  sectionCount: number;
  medianWordsPerSection: number;
  fillerMatches: string[];
  recommendations: string[];
  methodology: string;
}

export interface AeoReadinessAssessment {
  score: number;
  components: { definition: number; questionAnswers: number; summary: number; structure: number; brevity: number; standalone: number; schemaSignal: number };
  questionHeadings: number;
  answeredQuestionHeadings: number;
  schemaTypesObserved: string[];
  outlineIssues: string[];
  recommendations: string[];
  methodology: string;
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const briefText = (key: string, variables?: Record<string, unknown>): string => i18n.t(`runtimeErrors.contentBrief.${key}`, variables);
const normalizeHttpUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return value.trim();
    url.hash = '';
    return url.toString();
  } catch { return value.trim(); }
};
export const extractDraftParagraphs = (draft: string): string[] => draft.split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.trim()).filter(Boolean);

export const isHttpSourceUrl = (value: string) => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
};

export interface ParagraphSourceEvidence {
  matched: boolean;
  scope: 'sentence-match' | 'excerpt' | 'semantic-terms' | 'title' | 'no-signal' | 'not-in-snapshot';
  matchedTerms: string[];
  overlapPercent: number | null;
  matchedExcerpt?: string;
  matchedSentence?: string;
  sentenceOverlapPercent?: number | null;
  responseSpan?: { start: number; end: number };
  sourceSpan?: { start: number; end: number };
  pageUrl?: string;
}

const evidenceStopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'are', 'from', 'to', 'of', 'a', 'an', 'or', 'in', 'on', 'is', 'jest', 'oraz', 'dla', 'z', 'w', 'na', 'do', 'i', 'że']);
const evidenceTokens = (value: string): string[] => [...new Set(
  value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter((token) => token.length >= 3 && !evidenceStopWords.has(token)),
)];

const sourceAliases = (value: string): string[] => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return [];
    url.hash = '';
    return [url.href];
  } catch { return []; }
};

interface BriefSentenceSpan {
  text: string;
  start: number;
  end: number;
}

const briefSentenceSpans = (value: string): BriefSentenceSpan[] => {
  const sentences: BriefSentenceSpan[] = [];
  for (const match of value.matchAll(/[^.!?\n]+/gu)) {
    const raw = match[0];
    const text = raw.trim();
    if (!text || evidenceTokens(text).length < 3) continue;
    const rawStart = match.index ?? 0;
    const start = rawStart + raw.indexOf(text);
    sentences.push({ text, start, end: start + text.length });
    if (sentences.length >= 30) break;
  }
  return sentences;
};

interface BriefSentenceMatch extends BriefSentenceSpan {
  excerpt: string;
  overlap: number;
  matchedTerms: string[];
}

const bestBriefSentenceMatch = (paragraph: string, excerpts: string[]): BriefSentenceMatch | null => {
  let best: BriefSentenceMatch | null = null;
  for (const sentence of briefSentenceSpans(paragraph)) {
    const sentenceTerms = new Set(evidenceTokens(sentence.text));
    for (const excerpt of excerpts) {
      const excerptTerms = new Set(evidenceTokens(excerpt));
      if (!sentenceTerms.size || !excerptTerms.size) continue;
      const matchedTerms = [...sentenceTerms].filter((term) => excerptTerms.has(term));
      const union = new Set([...sentenceTerms, ...excerptTerms]);
      const overlap = union.size ? matchedTerms.length / union.size : 0;
      if (matchedTerms.length < 3 || overlap < 0.35 || (best && overlap <= best.overlap)) continue;
      best = { ...sentence, excerpt, overlap, matchedTerms: matchedTerms.slice(0, 12) };
    }
  }
  return best;
};

/**
 * Compare a reviewed paragraph with bounded content evidence from the selected
 * crawl. This is observability only: it never flips sourceChecked and does
 * not prove entailment, freshness, or truth.
 */
export const matchParagraphToCrawlSource = (
  paragraph: string,
  sourceUrl: string,
  pages: CrawledPageSummary[],
): ParagraphSourceEvidence => {
  const aliases = new Set(sourceAliases(sourceUrl));
  const page = pages.find((candidate) => [candidate.url, candidate.final_url].flatMap((url) => url ? sourceAliases(url) : []).some((url) => aliases.has(url)));
  if (!page) return { matched: false, scope: 'not-in-snapshot', matchedTerms: [], overlapPercent: null };
  const paragraphPhrase = normalize(paragraph);
  const paragraphTermSet = new Set(evidenceTokens(paragraph));
  const excerpts = page.semantic_excerpts ?? [];
  const exactExcerpt = excerpts.find((excerpt) => {
    const normalizedExcerpt = normalize(excerpt);
    return normalizedExcerpt.length >= 40 && paragraphPhrase.includes(normalizedExcerpt);
  });
  if (exactExcerpt) return { matched: true, scope: 'excerpt', matchedTerms: evidenceTokens(exactExcerpt).filter((term) => paragraphTermSet.has(term)).slice(0, 12), overlapPercent: 100, matchedExcerpt: exactExcerpt, pageUrl: page.final_url || page.url };
  const sentenceMatch = bestBriefSentenceMatch(paragraph, excerpts);
  if (sentenceMatch) return {
    matched: true,
    scope: 'sentence-match',
    matchedTerms: sentenceMatch.matchedTerms,
    overlapPercent: Math.round(sentenceMatch.overlap * 100),
    matchedExcerpt: sentenceMatch.excerpt,
    matchedSentence: sentenceMatch.text,
    sentenceOverlapPercent: Math.round(sentenceMatch.overlap * 100),
    responseSpan: { start: sentenceMatch.start, end: sentenceMatch.end },
    sourceSpan: { start: 0, end: sentenceMatch.excerpt.length },
    pageUrl: page.final_url || page.url,
  };
  const sourceTerms = evidenceTokens([page.title ?? '', ...(page.semantic_terms ?? [])].join(' '));
  const matchedTerms = sourceTerms.filter((term) => paragraphTermSet.has(term)).slice(0, 12);
  const overlapPercent = sourceTerms.length ? Math.round(matchedTerms.length / sourceTerms.length * 100) : null;
  if (matchedTerms.length >= 3 && overlapPercent !== null && overlapPercent >= 20) return { matched: true, scope: page.semantic_terms?.length ? 'semantic-terms' : 'title', matchedTerms, overlapPercent, pageUrl: page.final_url || page.url };
  return { matched: false, scope: page.semantic_terms?.length ? 'no-signal' : 'title', matchedTerms, overlapPercent, pageUrl: page.final_url || page.url };
};

const MAX_DRAFT_VERSIONS = 30;
const versionId = () => createId('draft');

/**
 * Save an explicit local checkpoint. A checkpoint is never created implicitly
 * on every keystroke, so a long draft cannot fill workspace storage while it
 * is being edited. Consecutive identical drafts are de-duplicated.
 */
export const saveDraftVersion = (
  brief: TopicalContentBrief,
  note = '',
  savedAt = new Date().toISOString(),
): TopicalContentBrief => {
  const draftMarkdown = brief.draftMarkdown.trim() ? brief.draftMarkdown : '';
  if (!draftMarkdown) return brief;
  const normalizedNote = note.trim().slice(0, 240);
  const latest = brief.draftVersions[0];
  if (latest?.draftMarkdown === draftMarkdown && latest.note === normalizedNote) return brief;
  const version: ContentBriefVersion = {
    id: versionId(),
    savedAt,
    note: normalizedNote,
    draftMarkdown,
  };
  return { ...brief, draftVersions: [version, ...brief.draftVersions].slice(0, MAX_DRAFT_VERSIONS) };
};

export interface DraftDiff {
  changed: boolean;
  addedLineCount: number;
  removedLineCount: number;
  addedLines: string[];
  removedLines: string[];
  addedCharacterCount: number;
  removedCharacterCount: number;
}

/**
 * A bounded, deterministic line/multiset diff for editorial review. It does
 * not claim semantic equivalence or fact verification; repeated lines are
 * counted correctly and the visible evidence is capped for large drafts.
 */
export const compareDrafts = (before: string, after: string, evidenceLimit = 40): DraftDiff => {
  const safeLimit = Number.isFinite(evidenceLimit) ? Math.max(1, Math.min(200, Math.floor(evidenceLimit))) : 40;
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const counts = (lines: string[]) => {
    const map = new Map<string, number>();
    lines.forEach((line) => map.set(line, (map.get(line) ?? 0) + 1));
    return map;
  };
  const beforeCounts = counts(beforeLines);
  const afterCounts = counts(afterLines);
  const removedLines: string[] = [];
  const addedLines: string[] = [];
  beforeCounts.forEach((count, line) => {
    const difference = Math.max(0, count - (afterCounts.get(line) ?? 0));
    for (let index = 0; index < difference; index += 1) removedLines.push(line);
  });
  afterCounts.forEach((count, line) => {
    const difference = Math.max(0, count - (beforeCounts.get(line) ?? 0));
    for (let index = 0; index < difference; index += 1) addedLines.push(line);
  });
  const characterCount = (lines: string[]) => lines.reduce((total, line) => total + line.length, 0);
  return {
    changed: before !== after,
    addedLineCount: addedLines.length,
    removedLineCount: removedLines.length,
    addedLines: addedLines.slice(0, safeLimit),
    removedLines: removedLines.slice(0, safeLimit),
    addedCharacterCount: characterCount(addedLines),
    removedCharacterCount: characterCount(removedLines),
  };
};

export interface ContentBriefExportPayload {
  schemaVersion: 1;
  exportedAt: string;
  node: { id: string; title: string; lifecycle: TopicalNode['lifecycle'] };
  brief: TopicalContentBrief;
}

/** Serialize only user-entered brief data for an explicit local handoff. */
export const buildContentBriefExport = (
  node: TopicalNode,
  brief: TopicalContentBrief,
  exportedAt = new Date().toISOString(),
): ContentBriefExportPayload => ({
  schemaVersion: 1,
  exportedAt,
  node: { id: node.id, title: node.title, lifecycle: node.lifecycle },
  brief,
});

/** Markdown handoff intentionally keeps provenance labels and does not invent claims. */
export const buildContentBriefMarkdown = (node: TopicalNode, brief: TopicalContentBrief): string => {
  const query = node.queries.find((item) => item.id === brief.targetQueryId);
  const sections = [
    `# ${node.title.trim() || briefText('draftTitle')}`,
    '',
    briefText('stage') + `: ${node.lifecycle}`,
    briefText('primaryQuery') + `: ${query?.text || briefText('notSelected')}`,
    briefText('formatGoal') + `: ${brief.snippetTarget}`,
    '',
    `## ${briefText('requiredEntities')}`,
    ...(brief.requiredEntities.length ? brief.requiredEntities.map((item) => `- ${item}`) : [`- ${briefText('noEntities')}`]),
    '',
    `## ${briefText('internalLinks')}`,
    ...(brief.internalLinkTargets.length ? brief.internalLinkTargets.map((url) => `- ${url}`) : [`- ${briefText('noTargets')}`]),
    '',
    `## ${briefText('draft')}`,
    brief.draftMarkdown || `_${briefText('noDraft')}_`,
    '',
    `> ${briefText('exportNote')}`,
  ];
  return sections.join('\n');
};

const FILLER_PHRASES = [
  'at the end of the day', 'when it comes to', 'in general', 'generally speaking', 'a variety of', 'a wide range of',
  'it is important', 'it is crucial', 'plays a vital role', 'leverage', 'utilize', 'seamless', 'robust', 'cutting-edge',
  'game changer', 'in today\'s world', 'na koniec dnia', 'ogólnie rzecz biorąc', 'jeśli chodzi o', 'szeroki zakres',
  'odgrywa kluczową rolę', 'jest kluczowe', 'jest ważne', 'jest istotne', 'wykorzystaj potencjał', 'nowoczesne rozwiązanie',
  'innowacyjne rozwiązanie', 'kompleksowe rozwiązanie', 'w dzisiejszym świecie', 'warto zauważyć', 'należy pamiętać',
];
const EXAMPLE_MARKERS = ['for example', 'for instance', 'e.g.', 'such as', 'in practice', 'consider ', 'na przykład', 'np.', 'w praktyce', 'rozważmy', 'przykładowo'];
const STOP_CAPS = new Set(['The', 'This', 'That', 'These', 'Those', 'How', 'What', 'Why', 'When', 'Where', 'Who', 'Which', 'This', 'Jest', 'To', 'Ten', 'Ta', 'Tego', 'Jak', 'Co', 'Dlaczego', 'Kiedy', 'Gdzie', 'Który', 'Która', 'Warto', 'Każdy', 'Każda', 'Dzięki', 'Jeśli', 'Można', 'Należy', 'Przykład']);
const stripFrontMatter = (value: string) => value.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, '');
const scoreWords = (value: string) => (value.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) ?? []).length;
const scoreSections = (value: string) => {
  const parts = value.split(/^##\s+(.+)$/m);
  const sections: Array<{ heading: string; body: string }> = [];
  for (let index = 1; index < parts.length; index += 2) sections.push({ heading: parts[index].trim(), body: parts[index + 1] ?? '' });
  return sections;
};
type DraftBlock = { kind: 'h1' | 'h2' | 'h3' | 'list' | 'table' | 'paragraph'; text: string };
const markdownBlocks = (value: string): DraftBlock[] => {
  const blocks: DraftBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ').trim() }); paragraph = []; };
  for (const rawLine of stripFrontMatter(value).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('#')) {
      flush();
      const hashes = line.match(/^#+/)?.[0].length ?? 1;
      blocks.push({ kind: hashes === 1 ? 'h1' : hashes === 2 ? 'h2' : 'h3', text: line.replace(/^#+\s*/, '') });
    } else if (/^(?:[-*+]\s|\d+[.)]\s)/.test(line)) {
      flush(); blocks.push({ kind: 'list', text: line.replace(/^(?:[-*+]\s|\d+[.)]\s)/, '') });
    } else if (line.startsWith('|')) {
      flush(); blocks.push({ kind: 'table', text: line });
    } else paragraph.push(line);
  }
  flush();
  return blocks;
};
const questionStarts = new Set(['what', 'why', 'how', 'when', 'where', 'which', 'who', 'is', 'are', 'can', 'do', 'does', 'should', 'will', 'vs', 'co', 'jak', 'dlaczego', 'kiedy', 'gdzie', 'który', 'która', 'czy', 'ile', 'kim', 'czym']);
const isQuestionHeading = (heading: string) => heading.trim().endsWith('?') || questionStarts.has(heading.trim().toLocaleLowerCase().split(/\s+/)[0]);
const sentenceLengths = (value: string) => value.split(/(?<=[.!?])\s+/).map((sentence) => scoreWords(sentence)).filter(Boolean);
const DANGLING_START = /^(?:this|that|it|these|those|they|he|she|the former|the latter|to|ten|ta|taki|taka|takie|one|oni|ona|ono|jego|jej|ich|powyższy|powyższa|powyższe)\b/i;

/** Deterministic extractability signals; schema presence is not schema validation or evidence of AI citations. */
export const assessAeoReadiness = (markdown: string, snippetTarget: TopicalContentBrief['snippetTarget'], schemaTypesObserved: string[] = []): AeoReadinessAssessment => {
  const blocks = markdownBlocks(markdown);
  const paragraphs = blocks.filter((block) => block.kind === 'paragraph');
  const headingLevels = blocks.filter((block) => block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3').map((block) => block.kind === 'h1' ? 1 : block.kind === 'h2' ? 2 : 3);
  const outlineIssues: string[] = [];
  const h1Count = headingLevels.filter((level) => level === 1).length;
  if (blocks.length > 0 && h1Count === 0) outlineIssues.push(briefText('outlineMissingH1'));
  if (h1Count > 1) outlineIssues.push(briefText('outlineMultipleH1', { count: h1Count }));
  headingLevels.forEach((level, index) => {
    const previous = headingLevels[index - 1];
    if (previous !== undefined && level > previous + 1) outlineIssues.push(briefText('outlineJump', { previous, level }));
  });
  const lead = paragraphs[0]?.text ?? '';
  const definition = /\b(is|are|means|refers to|jest|są|oznacza|to\s+rodzaj|definiuje się jako)\b/i.test(lead) && scoreWords(lead) <= 55 ? 15 : 0;
  const recommendations: string[] = [];
  if (!definition) recommendations.push(briefText('definitionRecommendation'));
  let questionHeadings = 0;
  let answeredQuestionHeadings = 0;
  const answerSentences: number[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== 'h2' || !isQuestionHeading(block.text)) return;
    questionHeadings += 1;
    const next = blocks[index + 1];
    if (next?.kind === 'paragraph' && scoreWords(next.text) <= 50) {
      answeredQuestionHeadings += 1;
      answerSentences.push(...sentenceLengths(next.text));
    } else recommendations.push(briefText('directAnswer', { heading: block.text }));
  });
  const questionAnswers = questionHeadings ? Math.round(30 * answeredQuestionHeadings / questionHeadings) : 15;
  if (!questionHeadings) recommendations.push(briefText('questionHeadings'));
  const hasList = blocks.some((block) => block.kind === 'list');
  const hasTable = blocks.some((block) => block.kind === 'table');
  const structure = (hasList ? 8 : 0) + (hasTable ? 7 : 0);
  if (!hasList && !hasTable) recommendations.push(briefText('listOrTable'));
  const firstBlocks = blocks.slice(0, 4);
  const summaryPresent = firstBlocks.some((block) => block.kind === 'paragraph' && scoreWords(block.text) <= 60);
  const targetFormatPresent = snippetTarget === 'none'
    || snippetTarget === 'definition' && definition > 0
    || snippetTarget === 'list' && hasList
    || snippetTarget === 'table' && hasTable
    || snippetTarget === 'steps' && /^\s*\d+[.)]\s/m.test(stripFrontMatter(markdown))
    || snippetTarget === 'faq' && questionHeadings > 0;
  const summary = summaryPresent && targetFormatPresent ? 10 : 0;
  if (!summaryPresent) recommendations.push(briefText('summary'));
  if (summaryPresent && !targetFormatPresent) recommendations.push(briefText('targetFormat'));
  const medianAnswerLength = answerSentences.length ? [...answerSentences].sort((a, b) => a - b)[Math.floor((answerSentences.length - 1) / 2)] : null;
  const brevity = medianAnswerLength === null ? 5 : medianAnswerLength <= 25 ? 10 : medianAnswerLength <= 32 ? 5 : 0;
  if (medianAnswerLength !== null && medianAnswerLength > 25) recommendations.push(briefText('shortenAnswers'));
  const paragraphsWithDanglingSubjects = paragraphs.filter((block) => DANGLING_START.test(block.text)).length;
  const standalone = paragraphs.length ? Math.round(10 * (1 - paragraphsWithDanglingSubjects / paragraphs.length)) : 10;
  if (paragraphsWithDanglingSubjects) recommendations.push(briefText('nameTopic', { count: paragraphsWithDanglingSubjects }));
  const schemaSignal = schemaTypesObserved.length ? 10 : 0;
  if (!schemaSignal) recommendations.push(briefText('schemaMissing'));
  return {
    score: definition + questionAnswers + summary + structure + brevity + standalone + schemaSignal,
    components: { definition, questionAnswers, summary, structure, brevity, standalone, schemaSignal },
    questionHeadings, answeredQuestionHeadings, schemaTypesObserved: [...new Set(schemaTypesObserved)], outlineIssues, recommendations,
    methodology: briefText('aeoMethodology'),
  };
};

/**
 * Mechanical editorial signals adapted from the upstream quality workflow.
 * This is advisory only: specificity is not fact-checking and the score is not a ranking metric.
 */
export const assessDraftQuality = (markdown: string, referenceWordFloor = 800): DraftQualityAssessment => {
  const body = stripFrontMatter(markdown);
  const clean = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ');
  const wordCount = scoreWords(clean);
  const sections = scoreSections(body);
  const sectionWordCounts = (sections.length ? sections : [{ heading: '', body }]).map((section) => scoreWords(section.body.replace(/```[\s\S]*?```/g, ' ').replace(/^\s*\|.*\|\s*$/gm, ' ')));
  const sortedCounts = [...sectionWordCounts].sort((left, right) => left - right);
  const middle = Math.floor(sortedCounts.length / 2);
  const medianWordsPerSection = sortedCounts.length ? sortedCounts.length % 2 ? sortedCounts[middle] : Math.round((sortedCounts[middle - 1] + sortedCounts[middle]) / 2) : 0;
  const depth = Math.round(25 * Math.min(1, medianWordsPerSection / 90));
  const sectionsWithExamples = sections.filter((section) => EXAMPLE_MARKERS.some((marker) => section.body.toLocaleLowerCase().includes(marker))).length;
  const examples = Math.round(20 * Math.min(1, (sections.length ? sectionsWithExamples / sections.length : 0) / 0.6));
  const namedTerms = (clean.match(/\b[\p{Lu}][\p{L}\p{N}.-]{2,}\b/gu) ?? []).filter((word) => !STOP_CAPS.has(word)).length;
  const numbers = (clean.match(/(?<![\p{L}\p{N}$])\$?\d[\d,.]*(?:\s?%|\s?(?:zł|PLN|EUR|USD))?/gu) ?? []).length;
  const citations = (body.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).length;
  const concreteDetailsPerHundred = (namedTerms + numbers + citations) / Math.max(wordCount, 1) * 100;
  const specificity = Math.round(20 * Math.min(1, concreteDetailsPerHundred / 3));
  const lower = clean.toLocaleLowerCase();
  const fillerMatches = FILLER_PHRASES.filter((phrase) => lower.includes(phrase));
  const fillerOccurrences = FILLER_PHRASES.reduce((total, phrase) => total + (lower.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, 0);
  const fillerDensity = fillerOccurrences / Math.max(wordCount, 1) * 100;
  const antiFiller = Math.round(20 * Math.max(0, 1 - fillerDensity / 1.2));
  const safeFloor = Number.isFinite(referenceWordFloor) ? Math.min(10_000, Math.max(1, Math.floor(referenceWordFloor))) : 800;
  const length = Math.round(15 * Math.min(1, wordCount / safeFloor));
  const score = depth + examples + specificity + antiFiller + length;
  const recommendations: string[] = [];
  if (medianWordsPerSection < 90) recommendations.push(briefText('expandSections', { median: medianWordsPerSection }));
  if (sections.length && sectionsWithExamples / sections.length < 0.6) recommendations.push(briefText('examples', { withExamples: sectionsWithExamples, total: sections.length }));
  if (concreteDetailsPerHundred < 3) recommendations.push(briefText('specificity'));
  if (fillerDensity > 0.4) recommendations.push(briefText('filler', { matches: fillerMatches.slice(0, 5).join(', ') }));
  if (wordCount < safeFloor) recommendations.push(briefText('wordFloor', { count: wordCount, floor: safeFloor }));
  return {
    score,
    grade: score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'needs-work' : 'thin',
    components: { depth, examples, specificity, antiFiller, length },
    wordCount, sectionCount: sections.length, medianWordsPerSection, fillerMatches, recommendations,
    methodology: briefText('editorialMethodology', { floor: safeFloor }),
  };
};

export const updateParagraphReview = (
  reviews: ContentParagraphReview[],
  paragraph: string,
  patch: Partial<ContentParagraphReview>,
): ContentParagraphReview[] => {
  const current = reviews.find((review) => review.paragraph === paragraph);
  const next = { paragraph, treatment: 'unreviewed' as const, sourceUrl: '', sourceChecked: false, ...current, ...patch };
  return [...reviews.filter((review) => review.paragraph !== paragraph), next].slice(-500);
};

/**
 * Deterministic editorial gate. It catches exact locked-fact reuse but does
 * not claim to detect every factual assertion, paraphrase, or hallucination.
 */
export const assessContentBrief = (
  node: TopicalNode,
  brief: TopicalContentBrief,
  facts: TopicalEntityFact[],
  pages: CrawledPageSummary[],
): ContentBriefAssessment => {
  const targetQuery = node.queries.find((query) => query.id === brief.targetQueryId)?.text ?? null;
  const draft = normalize(brief.draftMarkdown);
  const lockedFactsInDraft = facts.filter((fact) => fact.reuseStatus !== 'verified' && normalize(fact.value).length >= 3 && draft.includes(normalize(fact.value)));
  const crawledUrls = new Set(pages.flatMap((page) => [page.url, page.final_url]).map(normalizeHttpUrl));
  const unavailableInternalLinks = brief.internalLinkTargets.filter((url) => !crawledUrls.has(normalizeHttpUrl(url)));
  const missingRequiredEntities = brief.requiredEntities.filter((entity) => !draft.includes(normalize(entity)));
  const paragraphs = extractDraftParagraphs(brief.draftMarkdown);
  const unreviewedParagraphs = paragraphs.filter((paragraph) => !brief.paragraphReviews.some((review) => review.paragraph === paragraph && review.treatment !== 'unreviewed'));
  const unsupportedParagraphs = paragraphs.filter((paragraph) => brief.paragraphReviews.some((review) => review.paragraph === paragraph
    && review.treatment === 'source-backed'
    && (!review.sourceChecked || !isHttpSourceUrl(review.sourceUrl))));
  const readyForBrief = Boolean(targetQuery && brief.snippetTarget !== 'none');
  const draftQuality = assessDraftQuality(brief.draftMarkdown);
  const assignedUrls = new Set(node.sourceUrls.map(normalizeHttpUrl));
  const schemaTypesObserved = [...new Set(pages.filter((page) => assignedUrls.has(normalizeHttpUrl(page.url)) || assignedUrls.has(normalizeHttpUrl(page.final_url))).flatMap((page) => page.schema_types ?? []))];
  const aeoReadiness = assessAeoReadiness(brief.draftMarkdown, brief.snippetTarget, schemaTypesObserved);

  return {
    targetQuery,
    missingRequiredEntities,
    lockedFactsInDraft,
    unavailableInternalLinks,
    unreviewedParagraphs,
    unsupportedParagraphs,
    wordCount: brief.draftMarkdown.trim().split(/\s+/).filter(Boolean).length,
    paragraphCount: paragraphs.length,
    draftQuality,
    aeoReadiness,
    readyForBrief,
    readyToAdvance: Boolean(readyForBrief && paragraphs.length > 0 && missingRequiredEntities.length === 0 && lockedFactsInDraft.length === 0 && unavailableInternalLinks.length === 0 && unreviewedParagraphs.length === 0 && unsupportedParagraphs.length === 0),
  };
};

export const verifiedFactsForReuse = (facts: TopicalEntityFact[]): TopicalEntityFact[] =>
  facts.filter((fact) => fact.reuseStatus === 'verified' && Boolean(fact.sourceUrl));
