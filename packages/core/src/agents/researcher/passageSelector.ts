import { UNTRUSTED_START_DELIMITER, UNTRUSTED_END_DELIMITER } from '../../tools/fetch/htmlExtractor.js';

export interface Passage {
  text: string;
  score: number;
  index: number;
  estimatedTokens: number;
}

export interface PassageSelectorOptions {
  tokenBudget?: number; // max estimated tokens per page (default from env or 500)
  minPassageLengthChars?: number;
}

const DEFAULT_STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'can\'t', 'cannot', 'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing',
  'don\'t', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t',
  'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers',
  'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if',
  'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most',
  'mustn\'t', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
  'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d',
  'she\'ll', 'she\'s', 'should', 'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the',
  'their', 'theirs', 'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they', 'they\'d',
  'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
  'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what',
  'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom',
  'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re',
  'you\'ve', 'your', 'yours', 'yourself', 'yourselves',
]);

/**
 * Tokenize a query or text into cleaned lowercase keywords, omitting common stop words.
 */
export function tokenizeKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-./]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !DEFAULT_STOP_WORDS.has(w));
}

/**
 * Estimate token count using the standard character heuristic (4 chars per token).
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Splits raw document text into meaningful candidate passages (paragraphs or grouped blocks).
 * Ensures every passage is an exact verbatim slice of rawText so downstream quote verification
 * will always succeed.
 */
export function splitIntoPassages(rawText: string, minLengthChars = 60): string[] {
  if (!rawText || !rawText.trim()) return [];

  // Split on double newlines (paragraphs) or single newlines if paragraphs are sparse
  const paragraphs = rawText
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length >= minLengthChars);

  if (paragraphs.length >= 2) {
    return paragraphs;
  }

  // Fallback to line-based splitting for single-block texts
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= minLengthChars);

  if (lines.length > 0) {
    return lines;
  }

  return [rawText.trim()];
}

/**
 * Scores a passage against query keywords using BM25-inspired term frequency and query coverage.
 */
export function scorePassage(passage: string, queryKeywords: string[]): number {
  if (queryKeywords.length === 0) return 1;

  const passageLower = passage.toLowerCase();
  let score = 0;
  let matchesCount = 0;

  for (const term of queryKeywords) {
    // Count exact word occurrences
    let index = 0;
    let termFreq = 0;
    while ((index = passageLower.indexOf(term, index)) !== -1) {
      termFreq++;
      index += term.length;
    }

    if (termFreq > 0) {
      matchesCount++;
      // Diminishing returns on term frequency (BM25 term saturation)
      const tfScore = (termFreq * 2.2) / (termFreq + 1.2);
      // Give higher weight to rarer/longer technical terms
      const termWeight = Math.log(1 + term.length);
      score += tfScore * termWeight;
    }
  }

  // Bonus for coverage across multiple different query terms
  const coverageRatio = matchesCount / queryKeywords.length;
  score *= 1 + coverageRatio;

  return score;
}

export function getResearcherPageTokenBudget(): number {
  const envVal =
    process.env.RESEARCHER_PAGE_TOKEN_BUDGET ??
    process.env.RESEARCHER_PASSAGE_TOKEN_BUDGET;
  if (envVal && !isNaN(Number(envVal)) && Number(envVal) > 0) {
    return Number(envVal);
  }
  return 900; // Default budget: 900 tokens per page (approx 3,600 characters)
}

/**
 * Selects the most relevant passages from a document for a given query/topic,
 * fitting within the specified token budget.
 *
 * Keeps quotes 100% exact verbatim substrings of rawText.
 */
export function selectRelevantPassages(
  rawText: string,
  query: string,
  options: PassageSelectorOptions = {},
): {
  selectedPassages: string[];
  totalTokensEstimated: number;
  extractedText: string;
} {
  const tokenBudget = options.tokenBudget ?? getResearcherPageTokenBudget();
  const passages = splitIntoPassages(rawText, options.minPassageLengthChars ?? 60);

  if (passages.length === 0) {
    return {
      selectedPassages: [],
      totalTokensEstimated: 0,
      extractedText: '',
    };
  }

  // If the entire text already fits within the token budget, return it directly
  const fullTextTokens = estimateTokenCount(rawText);
  if (fullTextTokens <= tokenBudget) {
    return {
      selectedPassages: [rawText],
      totalTokensEstimated: fullTextTokens,
      extractedText: rawText,
    };
  }

  const queryKeywords = tokenizeKeywords(query);

  const scoredPassages: Passage[] = passages.map((text, index) => {
    return {
      text,
      score: scorePassage(text, queryKeywords),
      index,
      estimatedTokens: estimateTokenCount(text),
    };
  });

  // If any passages matched query keywords, discard zero-score passages to prevent irrelevant noise
  const hasRelevant = scoredPassages.some((p) => p.score > 0);
  const eligible = hasRelevant
    ? scoredPassages.filter((p) => p.score > 0)
    : scoredPassages;

  // Sort passages by relevance score descending
  const ranked = [...eligible].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: earlier passages in document preferred
    return a.index - b.index;
  });

  // Greedily pick highest-scoring passages within tokenBudget
  const chosen: Passage[] = [];
  let accumulatedTokens = 0;

  for (const item of ranked) {
    const remaining = tokenBudget - accumulatedTokens;
    if (remaining <= 0) break;

    if (item.estimatedTokens <= remaining) {
      chosen.push(item);
      accumulatedTokens += item.estimatedTokens;
    } else if (remaining >= 30) {
      // Partial inclusion: include the verbatim leading slice of the relevant passage up to remaining budget
      const maxChars = remaining * 4;
      const sliced = item.text.slice(0, maxChars);
      chosen.push({
        text: sliced,
        score: item.score,
        index: item.index,
        estimatedTokens: remaining,
      });
      accumulatedTokens += remaining;
      break;
    }
  }

  // Sort chosen passages back into their natural document order
  chosen.sort((a, b) => a.index - b.index);

  const selectedPassages = chosen.map((c) => c.text);
  const extractedText = selectedPassages.join('\n\n[...]\n\n');

  return {
    selectedPassages,
    totalTokensEstimated: accumulatedTokens,
    extractedText,
  };
}

/**
 * Formats a fetched page with relevance-selected passages wrapped in untrusted content delimiters.
 */
export function formatPageWithRelevantPassages(
  page: { url: string; title: string; rawText: string },
  query: string,
  options: PassageSelectorOptions = {},
): string {
  const { extractedText, totalTokensEstimated } = selectRelevantPassages(
    page.rawText,
    query,
    options,
  );

  return `${UNTRUSTED_START_DELIMITER}\n[SOURCE TITLE: ${page.title}]\n[PAGE URL: ${page.url}]\n[RELEVANCE SELECTED PASSAGES (~${totalTokensEstimated} tokens)]:\n\n${extractedText}\n${UNTRUSTED_END_DELIMITER}`;
}
