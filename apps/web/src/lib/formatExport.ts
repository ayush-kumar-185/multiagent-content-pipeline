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

  // 1. Remove all citation markers like [n1], [n1, n2], [n1][n2]
  let cleaned = draft.replace(/\[n\d+(?:\s*,\s*n\d+)*\]/g, '');

  // 2. Clean up any trailing spaces before punctuation (e.g. "worlds ." -> "worlds.")
  cleaned = cleaned.replace(/\s+([.,!?:;])/g, '$1');

  // 3. Convert or strip markdown bold **text**
  if (options.unicodeBold !== false) {
    cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, (_, match) => toUnicodeBold(match));
  } else {
    cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');
  }

  // 4. Clean up any multiple spaces
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');

  return cleaned.trim();
}

