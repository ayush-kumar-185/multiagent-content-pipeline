import { describe, it, expect } from 'vitest';
import {
  detectSemanticRepetition,
  extractDraftSections,
  extractStatistics,
} from './repetitionDetector.js';
import type { RepetitionFinding } from '../../schemas/editor.js';

describe('Semantic Repetition Detector', () => {
  it('extracts statistics properly from sentences', () => {
    const text = 'Cabin air pressure drops by 30% and humidity falls to under 12%. Over $4.5 million was spent in 2024.';
    const stats = extractStatistics(text);
    expect(stats).toContain('30%');
    expect(stats).toContain('12%');
    expect(stats).toContain('$4.5 million');
  });

  it('splits draft into sections for numbered twitter threads', () => {
    const thread = `1/ Flying at 35,000 feet dulls taste buds [n1].
2/ In fact, dry cabin air reduces taste perception by 30% [n2].
3/ Furthermore, low humidity drops our perception by another 30% [n3].`;
    const sections = extractDraftSections(thread);
    expect(sections.length).toBe(3);
    expect(sections[0]!.id).toBe('Tweet 1');
  });

  it('flags repeated statistics across different sections', () => {
    const thread = `1/ Flying at 35,000 feet dulls your taste receptors [n1].
2/ In flight, dry cabin air reduces sweet perception by 30% [n2].
3/ The low pressure in the cabin also drops salty perception by 30% [n3].`;
    const findings = detectSemanticRepetition(thread);
    const statFindings = findings.filter((f: RepetitionFinding) => f.repeatedIdea.includes('30%'));
    expect(statFindings.length).toBeGreaterThan(0);
    expect(statFindings[0]!.sectionIds).toEqual(['Tweet 2', 'Tweet 3']);
  });

  it('detects high semantic/lexical overlap between redundant paragraphs', () => {
    const draft = `## The Role of Cabin Humidity
The low atmospheric pressure and dry air inside modern airline cabins significantly numb human taste buds and olfactory senses during cruise altitude [n1].

## Humidity and Pressure Effects
The low atmospheric pressure and dry air inside airline cabins significantly numb our taste buds and olfactory senses during high altitude flights [n2].`;
    const findings = detectSemanticRepetition(draft);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe('high');
    expect(findings[0]!.recommendation).toBe('merge');
  });

  it('returns empty array when content has no duplicate stats or semantic overlap', () => {
    const cleanDraft = `## Atmospheric Pressure
At 35,000 feet, ambient pressure is equivalent to an elevation of 6,000 to 8,000 feet above sea level [n1].

## Cabin Humidity
Aircraft environmental systems keep interior moisture below 12 percent relative humidity [n2].

## Background Engine Noise
Continuous white noise from jet engines at 85 decibels dampens auditory and gustatory sensory pathways [n3].`;
    const findings = detectSemanticRepetition(cleanDraft);
    expect(findings).toEqual([]);
  });
});
