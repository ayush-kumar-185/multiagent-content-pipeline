import { describe, it, expect } from 'vitest';
import { runPlannerAgent } from '../agents/planner/plannerAgent.js';
import { runWriterAgent } from '../agents/writer/writerAgent.js';
import { detectSemanticRepetition } from '../agents/editor/repetitionDetector.js';
import {
  calculateWeightedScore,
  evaluateHardGates,
  resolveEditorDecision,
} from '../agents/editor/scoring.js';
import {
  auditAllClaims,
  detectsCausalInference,
  detectsIndustryBehaviorClaim,
} from '../agents/factChecker/evidenceAuditor.js';
import { parseCitationsFromDraft } from '../agents/writer/citationParser.js';
import type { Note } from '../schemas/note.js';
import type { GraphState } from '../schemas/state.js';
import type { QualityScores } from '../schemas/editor.js';

describe('Regression Test: Airplane Food Taste Precision & Narrative Coherence (imppp.md)', () => {
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
      studyContext: 'Cruising altitude in-flight cabin environment',
      evidenceType: 'measured_result',
      limitations: 'Measured for dry mucous membranes and odor perception, not taste buds directly',
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
      studyContext: 'Simulated cabin pressure at 8,000 feet in Fraunhofer Institute test chamber',
      evidenceType: 'measured_result',
      limitations: 'Measured specifically for saltiness and sweetness thresholds in a simulated chamber',
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
      studyContext: 'Laboratory acoustic chamber with 85 dB continuous white/engine noise',
      evidenceType: 'measured_result',
      limitations: 'Applies to continuous background noise exposure, specifically modulating sweet and umami pathways',
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
      studyContext: 'Aviation catering formulation practices',
      evidenceType: 'industry_practice',
      limitations: 'Documents observed ingredient use across airlines to maintain flavor at altitude',
    },
  ];

  it('Part 1: Investigates and identifies the 5 flaws in the initial airplane-food thread', () => {
    // The initial draft exhibiting the 5 flaws documented in imppp.md
    const flawedDraft = `1/ Ever wondered why airplane food tastes so bland at 35,000 feet? It is not the chef's fault: cabin humidity drops below 12 percent, drying olfactory membranes required to perceive flavor [n1].

2/ Low atmospheric pressure inside the cabin further dulls your senses, reducing sweet and salty taste perception by approximately 30 percent [n2].

3/ Meanwhile, continuous 85 dB background engine noise dampens sweetness while paradoxically enhancing savory umami receptors [n3].

4/ This is why airlines formulate menus with glutamate-dense foods like tomato juice and mushrooms, which retain full flavor at cruising altitude [n4].`;

    const parsedClaims = parseCitationsFromDraft(flawedDraft);
    expect(parsedClaims.length).toBe(4);

    // Audit each sentence
    const auditResults = auditAllClaims(parsedClaims, notes);
    expect(auditResults.length).toBe(4);

    // Flaw 1 Check: Drying olfactory membranes as established flavor mechanism
    const tweet1Audit = auditResults[0]!;
    expect(tweet1Audit.auditRecord.makesCausalInference).toBe(true);
    expect(detectsCausalInference(tweet1Audit.auditRecord.claim)).toBe(true);

    // Flaw 2 & 3 Check: Dulls your senses / 30% without experimental conditions (simulated 8,000 ft)
    const tweet2Audit = auditResults[1]!;
    expect(tweet2Audit.auditRecord.qualifications?.length).toBeGreaterThan(0);
    expect(tweet2Audit.auditRecord.qualifications?.some((q) => q.includes('simulated'))).toBe(true);

    // Flaw 4 & 5 Check: Claiming airlines formulate menus because of this study without independent proof of decision motive
    const tweet4Audit = auditResults[3]!;
    expect(detectsIndustryBehaviorClaim(tweet4Audit.auditRecord.claim)).toBe(true);
    // Tweet 4 claims "This is why airlines formulate menus..." leaping from lab science to corporate motive
    expect(tweet4Audit.auditRecord.qualifications?.some((q) => q.includes('evidence does not confirm'))).toBe(true);
    expect(tweet4Audit.auditRecord.supportClassification).toBe('partial');

    // Hard Gate Verification: Flawed draft MUST fail editor hard gates
    const flawedScores: QualityScores = {
      factualReliability: 7.2,
      relevance: 9.0,
      depth: 6.5,
      logicalFlow: 6.0,
      originality: 7.0,
      engagement: 7.5,
      repetitionControl: 7.0,
      readability: 8.5,
      conclusionQuality: 7.0,
      evidenceToClaimPrecision: 6.0, // Failed (< 7.0)
      causalReasoning: 5.5,          // Failed (< 6.0)
      numericalTraceability: 5.0,    // Failed (< 6.0)
      industryClaimGroundedness: 5.0,// Failed (< 6.0)
      narrativeContinuity: 5.5,      // Failed (< 6.0)
      redundantExplanations: 6.0,
    };

    const hardGates = evaluateHardGates(flawedScores, {
      claimChecks: auditResults.map((a) => a.suggestedCheck),
      formatPassed: true,
    });

    expect(hardGates.passed).toBe(false);
    expect(hardGates.failedGates.length).toBeGreaterThanOrEqual(2);
    expect(hardGates.failedGates.some((g) => g.includes('precision'))).toBe(true);
    expect(hardGates.failedGates.some((g) => g.includes('causal reasoning'))).toBe(true);

    const decision = resolveEditorDecision(calculateWeightedScore(flawedScores), hardGates);
    expect(decision).toBe('revise');
  });

  it('Part 2: Generates clean, qualified, logically progressive thread and verifies all 5 regression requirements', async () => {
    // 1. Content Planner blueprint enforcing distinct mechanisms and experimental context
    const fakePlannerClient = {
      chat: {
        completions: {
          create: async () => ({
            usage: { prompt_tokens: 380, completion_tokens: 160 },
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    centralAngle:
                      'At 35,000 feet, low humidity, cabin pressure, and engine noise independently alter human sensory perception, prompting aviation caterers to rely on umami-rich ingredients.',
                    intendedTakeaway:
                      'In-flight taste loss is a measurable physiological reaction to distinct environmental factors, explaining why umami and tomato juice stay flavorful at altitude.',
                    keyInsights: [
                      'Cabin humidity below 12% dries mucous membranes essential for odor perception [n1].',
                      'In simulated 8,000-foot cabin pressure tests, sweet and salty thresholds drop by approximately 30% [n2].',
                      'Continuous 85 dB engine white noise dampens sweetness while heightening umami signaling [n3].',
                      'To maintain flavor, aviation caterers incorporate glutamate-dense ingredients like tomato juice and mushrooms [n4].',
                    ],
                    narrativeFlow: [
                      {
                        id: 'tweet-1',
                        heading: 'Opening & Olfactory Humidity Mechanism',
                        keyPoint:
                          'Introduce the core answer: food tastes bland because dry cabin air (<12% humidity) impairs mucous membranes essential for odor perception.',
                        assignedNoteIds: ['n1'],
                        targetWords: 45,
                      },
                      {
                        id: 'tweet-2',
                        heading: 'Pressure & Taste Modality Specificity',
                        keyPoint:
                          'Transition: Beyond humidity, cabin pressure shifts taste thresholds. In simulated 8,000-ft tests, sweet and salty perception drops by ~30%.',
                        assignedNoteIds: ['n2'],
                        targetWords: 45,
                      },
                      {
                        id: 'tweet-3',
                        heading: 'Acoustic White Noise & Umami Heightening',
                        keyPoint:
                          'Transition: Beyond air properties, 85 dB engine acoustics dampen sweetness while heightening savory umami perception.',
                        assignedNoteIds: ['n3'],
                        targetWords: 45,
                      },
                      {
                        id: 'tweet-4',
                        heading: 'Aviation Culinary Adaptation',
                        keyPoint:
                          'Transition: How caterers adapt to these sensory shifts by incorporating glutamate-rich foods like tomato juice that retain flavor.',
                        assignedNoteIds: ['n4'],
                        targetWords: 45,
                      },
                    ],
                    redundantInformation: [
                      'Do not repeat the 30% statistic outside tweet-2.',
                      'Do not repeat general "senses are dulled" statements; distinguish olfaction from taste thresholds.',
                    ],
                    missingInformation: [],
                    avoid: [
                      'Claiming airlines intentionally designed menus based on sensory papers without evidence',
                      'Stating unproven causal mechanisms as definitive biological dogma',
                      'Repeating 30% stat',
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
      runId: 'regression-run-airplane-food-precision',
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
      client: fakePlannerClient,
      model: 'mock-llm',
    });

    expect(plannerRes.contentPlan.centralAngle).toContain('35,000 feet');
    expect(plannerRes.contentPlan.narrativeFlow.length).toBe(4);

    // 2. Writer produces clean, qualified draft
    const cleanDraftText = `1/ Ever wondered why airplane food tastes bland at 35,000 feet? At cruising altitude, cabin air humidity drops below 12 percent, drying out mucous membranes required for odor perception [n1].

2/ Humidity is only part of the story—cabin pressure also shifts taste thresholds. In simulated cabin pressure at 8,000 feet, perception of saltiness and sweetness is reduced by approximately 30 percent [n2].

3/ Beyond air properties, cabin acoustics modulate taste pathways. Continuous background engine noise at 85 dB dampens sweet taste perception but enhances savory umami perception [n3].

4/ To counter flavor dampening at cruising altitude, airlines incorporate glutamate-rich ingredients like tomato juice, mushrooms, and aged cheeses that retain full flavor [n4].`;

    const mockWriterClient = {
      chat: {
        completions: {
          create: async () => ({
            usage: { prompt_tokens: 480, completion_tokens: 190 },
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    draft: cleanDraftText,
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

    // 3. Parse claims and run complete Evidence Audit
    const parsedClaims = parseCitationsFromDraft(writerRes.draft);
    expect(parsedClaims.length).toBe(4);

    const auditResults = auditAllClaims(parsedClaims, notes);

    // Verify Audit Record structure for every factual sentence
    for (const res of auditResults) {
      const record = res.auditRecord;
      expect(record.claim).toBeDefined();
      expect(record.noteIds.length).toBeGreaterThan(0);
      expect(record.sourceUrl).toBeDefined();
      expect(record.exactPassage).toBeDefined();
      expect(['direct', 'partial', 'unsupported']).toContain(record.supportClassification);
      expect(typeof record.makesCausalInference).toBe('boolean');
      expect(record.reason).toBeDefined();
    }

    // Check Requirement 1: Unsupported claims are resolved (all direct)
    const classifications = auditResults.map((a) => a.auditRecord.supportClassification);
    expect(classifications).toEqual(['direct', 'direct', 'direct', 'direct']);

    // Check Requirement 2: Precise statistics retain original context (30% in simulated 8,000 ft; 85 dB engine noise)
    const tweet2Claim = parsedClaims[1]!;
    expect(tweet2Claim.claim).toContain('simulated cabin pressure at 8,000 feet');
    expect(tweet2Claim.claim).toContain('saltiness and sweetness');
    expect(tweet2Claim.claim).toContain('30 percent');

    const tweet3Claim = parsedClaims[2]!;
    expect(tweet3Claim.claim).toContain('85 dB');
    expect(tweet3Claim.claim.toLowerCase()).toContain('continuous background engine noise');

    // Check Requirement 3: Scientific evidence is not used to invent airline business practices
    const tweet4Claim = parsedClaims[3]!;
    expect(tweet4Claim.claim).toContain('glutamate-rich ingredients');
    expect(auditResults[3]!.auditRecord.supportClassification).toBe('direct');
    expect(auditResults[3]!.auditRecord.exactPassage).toContain('Airlines incorporate glutamate-rich ingredients');

    // Check Requirement 4: Narrative progression (Logical bridges between humidity -> pressure -> acoustics -> catering)
    expect(writerRes.draft).toContain('Humidity is only part of the story');
    expect(writerRes.draft).toContain('Beyond air properties, cabin acoustics modulate');
    expect(writerRes.draft).toContain('To counter flavor dampening');

    // Check Requirement 5: No two tweets repeat essentially the same insight or statistic
    const repetitionFindings = detectSemanticRepetition(writerRes.draft);
    expect(repetitionFindings).toEqual([]);
    const count30 = (writerRes.draft.match(/30\s*percent|30%/gi) || []).length;
    expect(count30).toBe(1);

    // 4. Editor evaluation with all explicit precision dimensions
    const precisionScores: QualityScores = {
      factualReliability: 9.8,
      relevance: 9.5,
      depth: 9.2,
      logicalFlow: 9.5,
      originality: 9.0,
      engagement: 9.0,
      repetitionControl: 10.0,
      readability: 9.5,
      conclusionQuality: 9.0,
      evidenceToClaimPrecision: 9.8,
      causalReasoning: 9.5,
      numericalTraceability: 9.8,
      industryClaimGroundedness: 9.5,
      narrativeContinuity: 9.5,
      redundantExplanations: 9.5,
    };

    const weightedScore = calculateWeightedScore(precisionScores);
    expect(weightedScore).toBeGreaterThanOrEqual(9.0);

    const hardGates = evaluateHardGates(precisionScores, {
      claimChecks: auditResults.map((a) => a.suggestedCheck),
      repetitionFindings,
      formatPassed: true,
      hasCentralAnswer: true,
    });

    expect(hardGates.passed).toBe(true);
    expect(hardGates.failedGates).toEqual([]);

    const decision = resolveEditorDecision(weightedScore, hardGates, 'accept');
    expect(decision).toBe('accept');
  });
});
