import { RepetitionFinding } from '../../schemas/editor.js';

export interface DraftSection {
  id: string;
  index: number;
  text: string;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'were', 'been',
  'more', 'about', 'into', 'than', 'will', 'also', 'their', 'when', 'which',
  'what', 'some', 'they', 'them', 'other', 'over', 'these', 'could', 'would',
]);

/**
 * Splits draft into labeled sections (tweets, headings, or paragraphs)
 */
export function extractDraftSections(draft: string): DraftSection[] {
  if (!draft || !draft.trim()) return [];

  // Check if thread with numbered tweets like "1/", "1/8", or "1."
  const tweetRegex = /(?:^|\n)(?:\d+[\/\.)]\s*)/g;
  const isThread = (draft.match(tweetRegex) || []).length >= 3;

  if (isThread) {
    const rawChunks = draft.split(/(?:^|\n)(?=\d+[\/\.)]\s*)/).filter((c) => c.trim().length > 0);
    return rawChunks.map((chunk, idx) => {
      const matchNum = chunk.match(/^\s*(\d+)[\/\.)]/);
      const id = matchNum ? `Tweet ${matchNum[1]}` : `Tweet ${idx + 1}`;
      return { id, index: idx + 1, text: chunk.trim() };
    });
  }

  // Standard article / post: split by headings or double newlines
  const paragraphs = draft.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return paragraphs.map((p, idx) => {
    let id = `Paragraph ${idx + 1}`;
    if (p.startsWith('#')) {
      const headingText = p.replace(/^#+\s*/, '').slice(0, 30);
      id = `Section: ${headingText}`;
    }
    return { id, index: idx + 1, text: p.trim() };
  });
}

/**
 * Extracts distinct numerical statistics (percentages like 30%, monetary values like $44B, counts).
 */
export function extractStatistics(text: string): string[] {
  const matches = text.match(
    /(?:\$\d+(?:\.\d+)?(?:\s*(?:billion|million|trillion|k|b|m))?|\b\d+(?:\.\d+)?%|\b\d+(?:,\d+)?\s*(?:percent|percentage|steps|feet|hours|minutes|seconds)\b)/gi,
  );
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.toLowerCase().trim())));
}

/**
 * Extracts significant content words from text for semantic overlap analysis.
 */
function tokenizeContentWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Computes Jaccard similarity between two token sets.
 */
function computeJaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deterministically analyzes a draft for semantic repetition across sections or tweets.
 * Detects:
 * 1. Repeated key statistics appearing across multiple distinct sections.
 * 2. High semantic idea overlap between non-adjacent sections.
 */
export function detectSemanticRepetition(draft: string): RepetitionFinding[] {
  const findings: RepetitionFinding[] = [];
  const sections = extractDraftSections(draft);
  if (sections.length < 2) return findings;

  // 1. Check for Repeated Statistics
  const statOccurrences = new Map<string, string[]>();
  for (const sec of sections) {
    const stats = extractStatistics(sec.text);
    for (const stat of stats) {
      const existing = statOccurrences.get(stat) || [];
      existing.push(sec.id);
      statOccurrences.set(stat, existing);
    }
  }

  for (const [stat, sectionIds] of statOccurrences.entries()) {
    if (sectionIds.length >= 2) {
      findings.push({
        sectionIds,
        repeatedIdea: `Statistic "${stat}" is repeated across ${sectionIds.length} sections (${sectionIds.join(', ')}). State the core finding once and use subsequent sections to explain mechanism, context, or implications.`,
        severity: sectionIds.length >= 3 ? 'high' : 'medium',
        recommendation: sectionIds.length >= 3 ? 'remove' : 'rewrite',
      });
    }
  }

  // 2. Check for High Semantic Overlap Between Sections
  const tokenizedSections = sections.map((sec) => ({
    ...sec,
    tokens: tokenizeContentWords(sec.text),
  }));

  for (let i = 0; i < tokenizedSections.length; i++) {
    for (let j = i + 1; j < tokenizedSections.length; j++) {
      const secA = tokenizedSections[i]!;
      const secB = tokenizedSections[j]!;

      // Skip adjacent if one section is purely a title heading line (< 4 words)
      if (j === i + 1 && (secA.tokens.size < 4 || secB.tokens.size < 4)) {
        continue;
      }

      const similarity = computeJaccardSimilarity(secA.tokens, secB.tokens);
      if (similarity >= 0.50 && secA.tokens.size >= 6 && secB.tokens.size >= 6) {
        findings.push({
          sectionIds: [secA.id, secB.id],
          repeatedIdea: `Sections "${secA.id}" and "${secB.id}" communicate substantially identical information (Jaccard similarity ${(similarity * 100).toFixed(0)}%).`,
          severity: similarity >= 0.65 ? 'high' : 'medium',
          recommendation: 'merge',
        });
      }
    }
  }

  return findings;
}
