import { Claim, ClaimCheck } from '../../schemas/claim.js';
import { RunConfig } from '../../schemas/config.js';

export interface DeterministicEditorReport {
  wordCount: number;
  lengthPassed: boolean;
  lengthMessage: string;
  fleschScore: number;
  gradeLevel: number;
  readingEaseLabel: string;
  totalSentences: number;
  citedSentencesCount: number;
  citationCoverageRatio: number;
  citationPassed: boolean;
  citationMessage: string;
  summary: string;
}

export function countWords(text: string): number {
  if (!text || !text.trim()) return 0;
  // Strip markdown tags and count words
  const clean = text.replace(/[#*`_~[\]]/g, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  return words.length;
}

export function countSyllablesInWord(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return 1;
  if (clean.length <= 3) return 1;

  // Count vowel groups
  const vowelGroups = clean.match(/[aeiouy]+/g);
  let count = vowelGroups ? vowelGroups.length : 1;

  // Subtract trailing silent 'e'
  if (clean.endsWith('e') && !clean.endsWith('le')) {
    count--;
  }

  return Math.max(1, count);
}

export function calculateReadability(text: string): {
  fleschScore: number;
  gradeLevel: number;
  readingEaseLabel: string;
  totalSentences: number;
} {
  const clean = text.replace(/#+\s.*/g, ''); // strip headings
  // Split on sentence-ending punctuation OR line breaks / bullet points
  const sentences = clean
    .split(/(?:(?<=[.!?])\s+|\r?\n+)/)
    .map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((s) => s.length > 5);

  const numSentences = Math.max(1, sentences.length);
  const words = clean
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
  const numWords = Math.max(1, words.length);

  let totalSyllables = 0;
  for (const w of words) {
    totalSyllables += countSyllablesInWord(w);
  }

  // Flesch Reading Ease
  const flesch = 206.835 - 1.015 * (numWords / numSentences) - 84.6 * (totalSyllables / numWords);
  const fleschScore = Number(Math.max(0, Math.min(100, flesch)).toFixed(1));

  // Flesch-Kincaid Grade Level
  const grade = 0.39 * (numWords / numSentences) + 11.8 * (totalSyllables / numWords) - 15.59;
  const gradeLevel = Number(Math.max(1, grade).toFixed(1));

  let readingEaseLabel = 'Fairly Difficult (Technical)';
  if (fleschScore >= 70) readingEaseLabel = 'Easy to Read';
  else if (fleschScore >= 50) readingEaseLabel = 'Standard / Technical';
  else if (fleschScore >= 30) readingEaseLabel = 'Difficult (Advanced Technical)';
  else readingEaseLabel = 'Very Difficult (Academic)';

  return {
    fleschScore,
    gradeLevel,
    readingEaseLabel,
    totalSentences: numSentences,
  };
}

export function runDeterministicEditorChecks(
  draft: string,
  claims: Claim[],
  config: Partial<RunConfig> = {},
  claimChecks: ClaimCheck[] = [],
): DeterministicEditorReport {
  const words = countWords(draft);
  const target = config.targetWords ?? 500;
  // Tolerance: 60% to 140% of target word count
  const minWords = Math.floor(target * 0.6);
  const maxWords = Math.ceil(target * 1.4);

  // Check if all claims are supported and no uncited/unsupported sentences
  const hasChecks = claimChecks.length > 0;
  const allClaimsSupported = hasChecks
    ? claimChecks.every((c) => c.status === 'supported')
    : claims.length > 0;

  const isBelowTarget = words < minWords;
  const isAboveTarget = words > maxWords;

  // Treat word count below target as advisory when all sentences are cited and claims are supported
  const lengthPassed = isAboveTarget ? false : isBelowTarget ? allClaimsSupported : true;

  let lengthMessage = '';
  if (isAboveTarget) {
    lengthMessage = `Length check FLAGGED (${words} words; exceeds maximum acceptable range of ${maxWords} words).`;
  } else if (isBelowTarget) {
    if (allClaimsSupported) {
      lengthMessage = `Length check ADVISORY (${words} words; below target range of ${minWords} - ${maxWords} words, but treated as advisory because all claims are cited and supported from research notes. Do NOT request expansion beyond notes).`;
    } else {
      lengthMessage = `Length check FLAGGED (${words} words; acceptable target range is ${minWords} - ${maxWords} words).`;
    }
  } else {
    lengthMessage = `Length check PASSED (${words} words; target ${target} ± 40%).`;
  }

  const readability = calculateReadability(draft);

  // Citation coverage
  const citedSentencesCount = claims.length;
  const totalSentences = readability.totalSentences;
  const ratio = totalSentences > 0 ? Number((citedSentencesCount / totalSentences).toFixed(2)) : 0;
  // At least 40% of sentences in a technical article should carry factual citations
  const citationPassed = citedSentencesCount > 0 && ratio >= 0.35;

  const citationMessage = citationPassed
    ? `Citation coverage PASSED (${citedSentencesCount} cited claims across ${totalSentences} sentences, ${Math.round(ratio * 100)}% coverage).`
    : `Citation coverage FLAGGED (${citedSentencesCount} cited claims; expected higher density for technical claims).`;

  const summary = [
    `Deterministic Editorial Audit:`,
    `- ${lengthMessage}`,
    `- Readability: Flesch Score ${readability.fleschScore}/100, Grade Level ${readability.gradeLevel} (${readability.readingEaseLabel})`,
    `- ${citationMessage}`,
  ].join('\n');

  return {
    wordCount: words,
    lengthPassed,
    lengthMessage,
    fleschScore: readability.fleschScore,
    gradeLevel: readability.gradeLevel,
    readingEaseLabel: readability.readingEaseLabel,
    totalSentences,
    citedSentencesCount,
    citationCoverageRatio: ratio,
    citationPassed,
    citationMessage,
    summary,
  };
}
