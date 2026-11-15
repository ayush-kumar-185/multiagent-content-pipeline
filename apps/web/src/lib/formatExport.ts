/**
 * Utility functions for exporting and formatting CiteWriter content for social media
 * (LinkedIn, Twitter/X, threads, etc.) vs long-form technical markdown.
 */

/**
 * Converts standard alphanumeric characters to Unicode Mathematical Sans-Serif Bold
 * so that text renders as bold natively when pasted into LinkedIn, Twitter/X, and social media.
 */
export function toUnicodeBold(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // A-Z -> U+1D5D4 to U+1D5ED
    if (code >= 65 && code <= 90) {
      result += String.fromCodePoint(0x1d5d4 + (code - 65));
    }
    // a-z -> U+1D5EE to U+1D607
    else if (code >= 97 && code <= 122) {
      result += String.fromCodePoint(0x1d5ee + (code - 97));
    }
    // 0-9 -> U+1D7EC to U+1D7F5
    else if (code >= 48 && code <= 57) {
      result += String.fromCodePoint(0x1d7ec + (code - 48));
    } else {
      result += text[i];
    }
  }
  return result;
}

export interface SocialExportOptions {
  /** If true, converts **bold** to Unicode bold characters. If false, strips the asterisks. Defaults to true. */
  unicodeBold?: boolean;
}

/**
 * Strips all citation brackets ([n1], [n2], [n1][n2], [n1, n2], etc.) and normalizes
 * punctuation and spacing so the resulting markdown or prose is completely clean.
 */
export function stripCitations(text: string): string {
  if (!text) return '';

  return text
    // 1. Remove all citation markers case-insensitively with flexible whitespace
    .replace(/\[\s*n\d+(?:\s*,\s*n\d+)*\s*\]/gi, '')
    // 2. Clean up any trailing whitespace before punctuation (e.g. "acquired ." -> "acquired.")
    .replace(/\s+([.,!?:;])/g, '$1')
    // 3. Clean up multiple horizontal spaces/tabs
    .replace(/[ \t]{2,}/g, ' ')
    // 4. Clean up spaces at end and beginning of lines after citation removal
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .trim();
}

/**
 * Prepares content for social media publication (LinkedIn / Twitter / Social feeds):
 * 1. Strips all citation brackets: [n1], [n2], [n1][n2], [n1, n2] so the copied text is pure and publication-ready.
 * 2. Formats bold text: converts **bold** into real Unicode bold for LinkedIn/Twitter or strips asterisks.
 * 3. Cleans up punctuation spacing left behind by citation removal.
 */
export function cleanForSocialMedia(
  draft: string,
  options: SocialExportOptions = { unicodeBold: true },
): string {
  if (!draft) return '';

  // 1. Remove all citation markers and fix punctuation spacing
  let cleaned = stripCitations(draft);

  // 2. Convert or strip markdown bold **text**
  if (options.unicodeBold !== false) {
    cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, (_, match) => toUnicodeBold(match));
  } else {
    cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');
  }

  return cleaned.trim();
}

