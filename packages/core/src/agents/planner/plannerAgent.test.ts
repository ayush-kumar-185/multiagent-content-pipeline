import { describe, it, expect } from 'vitest';
import { ContentPlanSchema } from '../../schemas/contentPlan.js';
import { buildPlannerSystemPrompt, buildPlannerUserPrompt } from './prompt.js';
import type { Note } from '../../schemas/note.js';
import type { RunConfig } from '../../schemas/config.js';

describe('Content Planner Agent', () => {
  it('validates a correct ContentPlan schema', () => {
    const validPlan = {
      centralAngle: 'Cabin pressure and low humidity dull taste perception by up to 30%.',
      intendedTakeaway: 'Understanding airline catering science and how umami remains unaffected.',
      keyInsights: [
        'Cabin humidity drops below 12%, drying olfactory membranes [n1].',
        'Low pressure equivalent to 8,000 feet numbs sweet and salty taste buds [n2].',
        'Umami receptors remain unaffected by white noise and altitude [n3].',
      ],
      narrativeFlow: [
        {
          id: 'tweet-1',
          heading: 'Hook & Core Answer',
          keyPoint: 'Why food tastes bland: sensory physiology at 35,000ft',
          assignedNoteIds: ['n1'],
          targetWords: 35,
        },
        {
          id: 'tweet-2',
          heading: 'Physiology & Olfaction',
          keyPoint: 'Dry cabin air numbs 80% of flavor perception',
          assignedNoteIds: ['n2'],
          targetWords: 40,
        },
      ],
      redundantInformation: ['Both notes mention 30% reduction; assign only to tweet-1.'],
      missingInformation: [],
      avoid: ['Do not repeat the 30% stat across multiple tweets.'],
    };

    const parsed = ContentPlanSchema.safeParse(validPlan);
    expect(parsed.success).toBe(true);
  });

  it('builds system prompt tailored to twitter_thread format', () => {
    const config: RunConfig = {
      audience: 'general audience',
      tone: 'engaging and analytical',
      targetWords: 300,
      format: 'twitter_thread',
    };
    const prompt = buildPlannerSystemPrompt(config);
    expect(prompt).toContain('Twitter Thread');
    expect(prompt).toContain('DIRECT ANSWER FIRST');
    expect(prompt).toContain('REPETITION ERADICATION');
  });

  it('builds user prompt with formatted notes', () => {
    const notes: Note[] = [
      {
        id: 'n1',
        claim: 'Cabin air is drier than the Sahara desert',
        sourceUrl: 'https://example.com/airline-study',
        quote: 'Cabin humidity frequently falls below 12 percent.',
        retrievedAt: new Date().toISOString(),
      },
    ];
    const config: RunConfig = {
      audience: 'general audience',
      tone: 'informative',
      targetWords: 200,
    };
    const userPrompt = buildPlannerUserPrompt('Airplane Food Science', notes, config);
    expect(userPrompt).toContain('[n1]');
    expect(userPrompt).toContain('Cabin humidity frequently falls below 12 percent');
    expect(userPrompt).toContain('Airplane Food Science');
  });
});
