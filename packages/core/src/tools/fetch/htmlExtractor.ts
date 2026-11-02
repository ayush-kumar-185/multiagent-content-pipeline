import * as cheerio from 'cheerio';

export const UNTRUSTED_START_DELIMITER = '<<<START_UNTRUSTED_EXTERNAL_WEB_CONTENT>>>';
export const UNTRUSTED_END_DELIMITER = '<<<END_UNTRUSTED_EXTERNAL_WEB_CONTENT>>>';

export interface ExtractedPageText {
  title: string;
  rawText: string;
  wrappedText: string;
}

/**
 * Strips scripts, styles, navigations, and headers/footers, returning clean readable text.
 */
export function extractReadableTextFromHtml(html: string): ExtractedPageText {
  const $ = cheerio.load(html);

  // 1. Remove non-content elements
  $(
    'script, style, noscript, iframe, svg, canvas, nav, header, footer, aside, .advertisement, .nav, .menu, .sidebar',
  ).remove();

  const title =
    $('title').first().text().trim() || $('h1').first().text().trim() || 'Untitled Page';

  // 2. Prioritize article or main if present, else fallback to body
  const targetElement =
    $('article').length > 0 ? $('article') : $('main').length > 0 ? $('main') : $('body');

  // Convert break tags and paragraphs to newlines
  targetElement.find('br').replaceWith('\n');
  targetElement.find('p, div, li, h1, h2, h3, h4, h5, h6, tr').each((_, el) => {
    $(el).append('\n');
  });

  const rawExtracted = targetElement.text();

  // Normalize excessive spaces and newlines
  const rawText = rawExtracted
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

  const wrappedText = `${UNTRUSTED_START_DELIMITER}\n[SOURCE TITLE: ${title}]\n\n${rawText}\n${UNTRUSTED_END_DELIMITER}`;

  return {
    title,
    rawText,
    wrappedText,
  };
}
