import 'dotenv/config';
import { runEditorAgent } from '../packages/core/src/agents/editor/editorAgent.js';
import { GraphState } from '../packages/core/src/schemas/state.js';
import { parseCitationsFromDraft } from '../packages/core/src/agents/writer/citationParser.js';

async function main() {
  process.env.TOKEN_AUDIT = '1';
  
  const sampleDraft = `TypeScript 5.0 introduces const type parameters, enabling developers to preserve literal types when calling generic functions without needing 'as const' assertions [n1]. The release also stabilizes the official ECMAScript decorators standard, replacing experimental decorators with stage-3 compliant syntax [n2]. Performance enhancements include namespace cleanup, reducing package size by 37% and build time by 15% [n3]. Furthermore, TypeScript 5.0 simplifies multiple configuration files using the new 'extends' array support [n4].`;
  const claims = parseCitationsFromDraft(sampleDraft);

  const mockState: GraphState = {
    runId: 'audit-run-1-1794603775214',
    topic: 'Advances in TypeScript 5.0 Type Inference',
    config: { audience: 'developers', tone: 'technical', targetWords: 400 },
    notes: [],
    researchRounds: 1,
    draft: sampleDraft,
    claims,
    writeCycles: 1,
    claimChecks: [],
    tokensUsed: 9496,
    costUsd: 0.003,
    status: 'running',
    openIssues: [],
  };

  console.log('Running Editor Agent on measured draft...');
  const res = await runEditorAgent(mockState);
  console.log('Editor Verdict:', res.editorVerdict);
  console.log('Editor Tokens Delta:', res.tokensUsed - mockState.tokensUsed);
}

main().catch(console.error);

