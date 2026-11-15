import { describe, it, expect } from 'vitest';
import { stripCitations, cleanForSocialMedia, toUnicodeBold } from './formatExport';

describe('formatExport utility', () => {
  describe('stripCitations', () => {
    it('handles empty or undefined string', () => {
      expect(stripCitations('')).toBe('');
    });

    it('removes single citation brackets like [n1] and fixes punctuation spacing', () => {
      const input = 'Elon Musk acquired Twitter in October 2022 for $44 billion [n1].';
      const output = stripCitations(input);
      expect(output).toBe('Elon Musk acquired Twitter in October 2022 for $44 billion.');
    });

    it('removes consecutive citation brackets like [n1][n2]', () => {
      const input = 'In July 2023, the platform officially rebranded to X [n1][n2].';
      const output = stripCitations(input);
      expect(output).toBe('In July 2023, the platform officially rebranded to X.');
    });

    it('removes comma-separated citation brackets like [n1, n2]', () => {
      const input = 'The vision was inspired by Tencent WeChat [n1, n2].';
      const output = stripCitations(input);
      expect(output).toBe('The vision was inspired by Tencent WeChat.');
    });

    it('handles whitespace inside brackets and case variations [ n3 ], [N4]', () => {
      const input = 'A complete overhaul of payments [ n3 ] and identity verification [N4] followed.';
      const output = stripCitations(input);
      expect(output).toBe('A complete overhaul of payments and identity verification followed.');
    });

    it('cleans citations from headings', () => {
      const input = '## The Rebranding to X [n1]\n\nTwitter became X [n2].';
      const output = stripCitations(input);
      expect(output).toBe('## The Rebranding to X\n\nTwitter became X.');
    });
  });

  describe('cleanForSocialMedia', () => {
    it('strips citations and converts bold to Unicode bold for LinkedIn / Twitter', () => {
      const input = '**Twitter** was acquired for **$44 billion** [n1].';
      const output = cleanForSocialMedia(input, { unicodeBold: true });
      expect(output).not.toContain('[n1]');
      expect(output).not.toContain('**');
      expect(output).toContain(toUnicodeBold('Twitter'));
      expect(output).toContain(toUnicodeBold('$44 billion'));
    });

    it('strips citations and removes asterisks when unicodeBold is false', () => {
      const input = '**Twitter** was acquired for $44B [n1].';
      const output = cleanForSocialMedia(input, { unicodeBold: false });
      expect(output).toBe('Twitter was acquired for $44B.');
    });
  });
});

