import { Note } from '../schemas/note.js';
import { countWords } from '../agents/editor/deterministicChecks.js';

export interface CoverageGateResult {
  isThin: boolean;
  reasons: string[];
  missingKeyTerms: string[];
  instruction?: string;
  notesCount: number;
  wordCount: number;
  minNotes: number;
  minWords: number;
}

/**
 * Normalizes an English word to its root stem / lemma:
 * - Lowercases and strips non-alphanumeric characters
 * - Handles derivational noun/verb suffixes (e.g. inference/inferences -> infer)
 * - Handles inflectional suffixes: plurals (-s, -es, -ies), past tense (-ed), participles (-ing)
 * - Strips derivational suffixes: -tion, -sion, -ment, -ance, -ence, -able, -ible, -al, -ly, -ity
 * - Strips trailing silent 'e' for consistent root matching (e.g. type/typing/typed -> typ)
 */
export function stemWord(word: string): string {
  let w = (word || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  if (w.length <= 3) return w;

  // Specific derivational pairings:
  // inference, inferences -> infer; difference -> differ; reference -> refer
  w = w.replace(/ences?$/, '');
  w = w.replace(/ances?$/, '');

  // -ation / -ations -> -at (e.g. migration -> migrat, observation -> observat)
  if (w.endsWith('ations')) {
    w = w.slice(0, -6) + 'at';
  } else if (w.endsWith('ation')) {
    w = w.slice(0, -5) + 'at';
  } else if (w.endsWith('tions') || w.endsWith('tion')) {
    w = w.replace(/tions?$/, 't');
  } else if (w.endsWith('sions') || w.endsWith('sion')) {
    w = w.replace(/sions?$/, 's');
  } else if (w.endsWith('ments') || w.endsWith('ment')) {
    w = w.replace(/ments?$/, '');
  }

  // Participles and past tense
  if (w.endsWith('ing')) {
    w = w.slice(0, -3);
    // Double consonant collapse (e.g., inferring -> inferr -> infer)
    if (w.length > 4 && w[w.length - 1] === w[w.length - 2]) {
      w = w.slice(0, -1);
    }
  } else if (w.endsWith('ed')) {
    w = w.slice(0, -2);
    // Double consonant collapse (e.g., inferred -> inferr -> infer)
    if (w.length > 4 && w[w.length - 1] === w[w.length - 2]) {
      w = w.slice(0, -1);
    }
  }

  // Plurals and third-person singulars
  if (w.endsWith('ies') && w.length > 4) {
    w = w.slice(0, -3) + 'y';
  } else if (w.endsWith('es') && w.length > 4 && !w.endsWith('ses') && !w.endsWith('zes')) {
    w = w.slice(0, -2);
  } else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) {
    w = w.slice(0, -1);
  }

  // Adjective / Adverb suffixes
  w = w.replace(/ly$/, '');
  w = w.replace(/ity$/, '');
  w = w.replace(/al$/, '');
  w = w.replace(/able$/, '');
  w = w.replace(/ible$/, '');

  // Strip trailing silent 'e' for root consistency (e.g., type -> typ, migrate -> migrat)
  if (w.endsWith('e') && w.length > 3) {
    w = w.slice(0, -1);
  }

  return w;
}

/**
 * Matches a topic key term (e.g. "type inference") against text by word stem or lemma,
 * not the exact contiguous phrase, case-insensitively.
 *
 * Example:
 * term: "type inference"
 * text: "const type parameters enhance the way TypeScript infers types"
 * - word stems in term: ["typ", "infer"]
 * - word stems in text: contains "typ" (from "type", "types") and "infer" (from "infers")
 * - all constituent stems present -> returns true.
 */
export function matchKeyTermInText(term: string, text: string): boolean {
  if (!term || !term.trim() || !text || !text.trim()) return false;

  // Direct case-insensitive phrase match shortcut
  if (text.toLowerCase().includes(term.toLowerCase())) {
    return true;
  }

  // Tokenize text into words and extract stem set
  const textWords = text
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const textStems = new Set(textWords.map(stemWord).filter(Boolean));

  // Tokenize key term into words and extract constituent stems
  const termWords = term
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const termStems = termWords.map(stemWord).filter(Boolean);

  if (termStems.length === 0) return false;

  // All constituent word stems of the term must appear in the text
  return termStems.every((stem) => textStems.has(stem));
}

/**
 * Extracts significant topic key phrases / compound terms from the topic string.
 * Strips generic prefixes ("advances in", "overview of") and common filler/stop words,
 * then returns primary technical 2-grams (e.g. "type inference", "connection migration")
 * or significant technical keywords.
 */
export function extractTopicKeyTerms(topic: string): string[] {
  if (!topic || !topic.trim()) return [];

  const genericPrefixes =
    /^(?:advances in|overview of|introduction to|deep dive into|guide to|exploring|understanding|a study of|analysis of)\s+/i;
  const stripped = topic.replace(genericPrefixes, '').trim();

  const stopWords = new Set([
    'a',
    'an',
    'the',
    'in',
    'on',
    'of',
    'for',
    'to',
    'and',
    'or',
    'with',
    'by',
    'at',
    'from',
    'as',
    'into',
    'about',
    'how',
    'what',
    'why',
    'overview',
    'introduction',
    'guide',
    'advances',
    'features',
    'updates',
    'modern',
    'new',
    'protocol',
    'performance',
  ]);

  const words = stripped
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9./_-]/g, '').trim())
    .filter(Boolean);

  const keyTerms: string[] = [];

  // Extract technical compound phrases (2-grams of content words)
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i]!.toLowerCase();
    const w2 = words[i + 1]!.toLowerCase();
    if (!stopWords.has(w1) && !stopWords.has(w2) && isNaN(Number(w1)) && isNaN(Number(w2))) {
      keyTerms.push(`${w1} ${w2}`);
    }
  }

  // Fallback to individual technical terms (length >= 4 and not stop word)
  if (keyTerms.length === 0) {
    for (const w of words) {
      const lower = w.toLowerCase();
      if (!stopWords.has(lower) && lower.length >= 4) {
        keyTerms.push(lower);
      }
    }
  }

  return Array.from(new Set(keyTerms));
}

/**
 * Deterministic Coverage Gate:
 * Evaluates whether the draft and research state are "thin":
 * 1. Fewer than MIN_NOTES (env, default 5) verified notes.
 * 2. Draft body under MIN_WORDS (env, default 250) words (excluding headings/dividers).
 * 3. The topic's key terms (e.g. "type inference") do not appear in the draft body.
 */
export function evaluateCoverageGate(
  topic: string,
  notes: Note[],
  draft: string,
  options?: {
    minNotes?: number;
    minWords?: number;
  },
): CoverageGateResult {
  const minNotes = options?.minNotes ?? Number(process.env.MIN_NOTES || 5);
  const minWords = options?.minWords ?? Number(process.env.MIN_WORDS || 250);

  const reasons: string[] = [];

  // 1. Check notes count
  const notesCount = notes.length;
  if (notesCount < minNotes) {
    reasons.push(
      `Fewer than MIN_NOTES (${minNotes}) notes collected: found ${notesCount} note(s).`,
    );
  }

  // 2. Check draft body word count (exempting markdown headings and dividers)
  const bodyText = (draft || '')
    .split(/\r?\n/)
    .filter(
      (l) =>
        !l.trim().startsWith('#') &&
        !l.trim().startsWith('---') &&
        !l.trim().startsWith('==='),
    )
    .join(' ');
  const wordCount = countWords(bodyText);

  if (wordCount < minWords) {
    reasons.push(
      `Draft body word count (${wordCount} words) is below MIN_WORDS threshold of ${minWords} words.`,
    );
  }

  // 3. Check topic key terms in draft body (stem / lemma matching)
  const keyTerms = extractTopicKeyTerms(topic);
  const missingKeyTerms: string[] = [];

  for (const term of keyTerms) {
    if (!matchKeyTermInText(term, bodyText)) {
      missingKeyTerms.push(term);
    }
  }

  if (missingKeyTerms.length > 0) {
    reasons.push(
      `Topic key terms missing from draft body: ${missingKeyTerms.map((t) => `"${t}"`).join(', ')}.`,
    );
  }

  const isThin = reasons.length > 0;
  let instruction: string | undefined;

  if (isThin) {
    const missingDesc =
      missingKeyTerms.length > 0
        ? `Ensure you search for and gather notes covering the core topic and key terms: ${missingKeyTerms.map((t) => `"${t}"`).join(', ')}.`
        : '';
    instruction = `The current coverage is thin (${reasons.join(' ')}). ${missingDesc} Gather additional verified notes covering distinct subtopics of "${topic}" to achieve at least ${minNotes} notes and support a draft of at least ${minWords} words. Keep existing notes and add new ones.`;
  }

  return {
    isThin,
    reasons,
    missingKeyTerms,
    instruction,
    notesCount,
    wordCount,
    minNotes,
    minWords,
  };
}

