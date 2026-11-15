import { describe, it, expect } from 'vitest';
import { runPlannerAgent } from '../agents/planner/plannerAgent.js';
import { runWriterAgent } from '../agents/writer/writerAgent.js';
import { detectSemanticRepetition } from '../agents/editor/repetitionDetector.js';
import { calculateWeightedScore, evaluateHardGates, resolveEditorDecision } from '../agents/editor/scoring.js';
import type { Note } from '../schemas/note.js';
import type { GraphState } from '../schemas/state.js';
import type { QualityScores } from '../schemas/editor.js';

describe('Regression Test: Airplane Food Taste at 35,000 Feet (improvement.md Part 13)', () => {
  const topic = 'Why Airplane Food Tastes Different and Bland at 35,000 Feet';

  const notes: Note[] = [
    {
      id: 'n1',
      claim: 'Low cabin humidity dries nasal mucus and severely degrades olfactory receptor sensitivity.',
      sourceUrl: 'https://example.com/airline-olfaction-study',
      quote: 'At cruising altitude, cabin air humidity drops below 12 percent, drying out mucous membranes required for odor perception.',
      retrievedAt: new Date().toISOString(),
      sourceTitle: 'In-Flight Sensory Biology',
      sourceType: 'academic',
      researchCategory: 'physiology',
    },
    {
      id: 'n2',
      claim: 'Low cabin pressure reduces sweet and salty taste perception by approximately 30 percent.',
      sourceUrl: 'https://example.com/lufthansa-fraunhofer-study',
      quote: 'Simulated cabin pressure at 8,000 feet reduced perception of saltiness and sweetness by approximately 30 percent.',
      retrievedAt: new Date().toISOString(),
      sourceTitle: 'Fraunhofer Institute Catering Study',
      sourceType: 'industry',
      researchCategory: 'ambient_conditions',
    },
    {
      id: 'n3',
      claim: 'Ambient jet engine noise of 85 decibels impairs sweet sensitivity while enhancing umami perception.',
      sourceUrl: 'https://example.com/sound-and-taste-journal',
      quote: 'Continuous background engine noise at 85 dB dampens sweet taste perception but enhances savory umami perception.',
      retrievedAt: new Date().toISOString(),
      sourceTitle: 'Acoustic Effects on Taste Receptors',
      sourceType: 'academic',
      researchCategory: 'acoustic_factors',
    },
    {
      id: 'n4',
      claim: 'Airlines formulate high-altitude menus with umami-dense ingredients to counter flavor dampening.',
      sourceUrl: 'https://example.com/airline-catering-science',
      quote: 'Airlines incorporate glutamate-rich ingredients like tomato juice, mushrooms, and aged cheeses to maintain vibrant flavor profiles at cruise altitude.',
      retrievedAt: new Date().toISOString(),
      sourceTitle: 'Modern Aviation Catering Solutions',
      sourceType: 'industry',
      researchCategory: 'culinary_solutions',
    },
  ];

  it('generates a progressive, non-repetitive Twitter thread without duplicate 30% stats', async () => {
    // 1. Content Planner blueprint
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({
            usage: { prompt_tokens: 350, completion_tokens: 150 },
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    centralAngle: 'At 35,000 feet, low humidity, low air pressure, and engine noise suppress human taste buds by altering olfactory and gustatory signaling.',
                    intendedTakeaway: 'The bland taste is a physiological response to cabin environmental conditions, explaining why umami and tomato juice thrive in flight.',
                    keyInsights: [
                      'Cabin humidity below 12% dries olfactory membranes [n1].',
                      'Cabin pressure reduces sweet and salty sensitivity by 30% [n2].',
                      'Engine noise at 85 dB suppresses sweetness while boosting umami [n3].',
                      'Catering kitchens utilize glutamate-dense ingredients to counteract sensory loss [n4].',
                    ],
                    narrativeFlow: [
                      {
                        id: 'tweet-1',
                        heading: 'Opening Revelation',
                        keyPoint: 'Core answer: Food is not poorly cooked; your senses are dulled at 35,000 feet.',
                        assignedNoteIds: ['n1'],
                        targetWords: 40,
                      },
                      {
                        id: 'tweet-2',
                        heading: 'Low Pressure & Sweet/Salty Suppression',
                        keyPoint: 'Reduced pressure dulls sweet and salty receptors by 30%.',
                        assignedNoteIds: ['n2'],
                        targetWords: 45,
                      },
                      {
                        id: 'tweet-3',
                        heading: 'Acoustic White Noise & Umami',
                        keyPoint: '85 dB engine white noise dampens sweet notes but boosts umami receptors.',
                        assignedNoteIds: ['n3'],
                        targetWords: 45,
                      },
                      {
                        id: 'tweet-4',
                        heading: 'Aviation Culinary Solutions',
                        keyPoint: 'Why tomato juice and umami-rich foods taste delicious in flight.',
                        assignedNoteIds: ['n4'],
                        targetWords: 45,
                      },
                    ],
                    redundantInformation: [
                      'State the 30% reduction metric once in tweet-2; do not repeat in other tweets.',
                    ],
                    missingInformation: [],
                    avoid: [
                      'Repeating 30% stat across multiple tweets',
                      'Generic complaints about airline food quality',
                    ],
                  }),
                },
              },
            ],
          }),
        },
      },
    } as any;

    const baseState: GraphState = {
      runId: 'regression-run-airplane-food',
      topic,
      config: {
        audience: 'curious general audience',
        tone: 'engaging, science-backed and concise',
        targetWords: 250,
        format: 'twitter_thread',
      },
      notes,
      researchRounds: 1,
      draft: '',
      claims: [],
      writeCycles: 0,
      claimChecks: [],
      tokensUsed: 0,
      costUsd: 0,
      agentMetrics: {},
      status: 'running',
      openIssues: [],
    };

    const plannerRes = await runPlannerAgent(baseState, {
      client: fakeClient,
      model: 'mock-llm',
    });

    expect(plannerRes.contentPlan.centralAngle).toContain('35,000 feet');
    expect(plannerRes.contentPlan.narrativeFlow.length).toBe(4);
    expect(plannerRes.contentPlan.redundantInformation[0]).toContain('30%');

    // 2. Writer produces non-repetitive thread based on ContentPlan
    const mockWriterClient = {
      chat: {
        completions: {
          create: async () => ({
            usage: { prompt_tokens: 450, completion_tokens: 180 },
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    draft: `1/ Ever wondered why airplane food tastes so bland at 35,000 feet? It is not the chef's fault: cabin humidity drops below 12 percent, drying olfactory membranes required to perceive flavor [n1].

2/ Low atmospheric pressure inside the cabin further dulls your senses, reducing sweet and salty taste perception by approximately 30 percent [n2].

3/ Meanwhile, continuous 85 dB background engine noise dampens sweetness while paradoxically enhancing savory umami receptors [n3].

4/ This is why airlines formulate menus with glutamate-dense foods like tomato juice and mushrooms, which retain full flavor at cruising altitude [n4].`,
                  }),
                },
              },
            ],
          }),
        },
      },
    } as any;

    const writerState: GraphState = {
      ...baseState,
      contentPlan: plannerRes.contentPlan,
    };

    const writerRes = await runWriterAgent(writerState, {
      client: mockWriterClient,
      model: 'mock-llm',
    });

    // 3. Verify Semantic Repetition Detector flags NO redundant 30% stats
    const repetitionFindings = detectSemanticRepetition(writerRes.draft);
    expect(repetitionFindings).toEqual([]);

    // Count occurrences of "30%" in draft
    const occurrences30Percent = (writerRes.draft.match(/30\s*percent|30%/gi) || []).length;
    expect(occurrences30Percent).toBe(1); // Stated exactly once!

    // 4. Verify Editor Scoring Engine passes hard gates and accepts
    const highScores: QualityScores = {
      factualReliability: 9.5,
      relevance: 9.5,
      depth: 9.0,
      logicalFlow: 9.0,
      originality: 8.5,
      engagement: 9.0,
      repetitionControl: 10.0,
      readability: 9.0,
      conclusionQuality: 8.5,
    };

    const weightedScore = calculateWeightedScore(highScores);
    expect(weightedScore).toBeGreaterThanOrEqual(8.5);

    const hardGates = evaluateHardGates(highScores, {
      repetitionFindings,
      claimChecks: [
        { claim: 'Humidity drops below 12%', noteIds: ['n1'], status: 'supported', reason: 'Verified' },
        { claim: 'Pressure reduces taste by 30%', noteIds: ['n2'], status: 'supported', reason: 'Verified' },
        { claim: 'Engine noise enhances umami', noteIds: ['n3'], status: 'supported', reason: 'Verified' },
        { claim: 'Airlines use glutamate foods', noteIds: ['n4'], status: 'supported', reason: 'Verified' },
      ],
      formatPassed: true,
    });

    expect(hardGates.passed).toBe(true);
    const decision = resolveEditorDecision(weightedScore, hardGates, 'accept');
    expect(decision).toBe('accept');
  });

  it('detects repeated statistics in flawed draft, triggers hard gate revision, and verifies clean resolution', async () => {
    // 1. A flawed draft that unnecessarily repeats "30%" across multiple tweets
    const flawedDraft = `1/ Ever wondered why airplane food tastes so bland at 35,000 feet? Cabin humidity drops by 30% [n1].

2/ Low atmospheric pressure inside the cabin further dulls your senses, reducing sweet and salty taste perception by approximately 30 percent [n2].

3/ In fact, dry cabin air reduces your overall taste perception by another 30% [n1].

4/ Airlines add tomato juice to compensate for taste loss [n4].`;

    // 2. Semantic repetition detector MUST detect the repeated 30% stat across Tweet 1, Tweet 2, Tweet 3
    const findings = detectSemanticRepetition(flawedDraft);
    expect(findings.length).toBeGreaterThan(0);
    const statFinding = findings.find((f) => f.repeatedIdea.includes('30%'));
    expect(statFinding).toBeDefined();
    expect(statFinding!.sectionIds.length).toBeGreaterThanOrEqual(2);
    expect(statFinding!.severity).toBe('high');

    // 3. Editor hard gates MUST fail because of high severity repetition
    const flawedScores: QualityScores = {
      factualReliability: 8.0,
      relevance: 8.0,
      depth: 6.0,
      logicalFlow: 5.0,
      originality: 6.0,
      engagement: 6.0,
      repetitionControl: 4.0, // Failed
      readability: 8.0,
      conclusionQuality: 6.0,
    };

    const hardGates = evaluateHardGates(flawedScores, {
      repetitionFindings: findings,
      formatPassed: true,
    });
    expect(hardGates.passed).toBe(false);
    expect(hardGates.failedGates.some((g) => g.toLowerCase().includes('repetition'))).toBe(true);

    const decision = resolveEditorDecision(calculateWeightedScore(flawedScores), hardGates);
    expect(decision).toBe('revise');

    // 4. Revision prompt receives actionable directives and produces non-repetitive revised draft
    const cleanDraft = `1/ Ever wondered why airplane food tastes so bland at 35,000 feet? Cabin humidity drops below 12 percent, drying olfactory membranes required to perceive flavor [n1].

2/ Low atmospheric pressure inside the cabin further dulls your senses, reducing sweet and salty taste perception by approximately 30 percent [n2].

3/ Meanwhile, continuous 85 dB background engine noise dampens sweetness while paradoxically enhancing savory umami receptors [n3].

4/ This is why airlines formulate menus with glutamate-dense foods like tomato juice and mushrooms, which retain full flavor at cruising altitude [n4].`;

    const cleanFindings = detectSemanticRepetition(cleanDraft);
    expect(cleanFindings).toEqual([]);
    expect((cleanDraft.match(/30\s*percent|30%/gi) || []).length).toBe(1);
  });
});
