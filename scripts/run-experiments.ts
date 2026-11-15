import dotenv from 'dotenv';
dotenv.config();

import { createLLMClient } from '../packages/core/src/llm/client.js';

interface HeaderSnapshot {
  limitTokens?: string;
  remainingTokens?: string;
  resetTokens?: string;
  limitRequests?: string;
  remainingRequests?: string;
  resetRequests?: string;
}

function extractHeaders(rawHeaders?: any): HeaderSnapshot {
  const result: HeaderSnapshot = {};
  if (!rawHeaders) return result;

  const get = (key: string) => {
    if (typeof rawHeaders.get === 'function') return rawHeaders.get(key) ?? undefined;
    return rawHeaders[key] ?? rawHeaders[key.toLowerCase()] ?? undefined;
  };

  result.limitTokens = get('x-ratelimit-limit-tokens');
  result.remainingTokens = get('x-ratelimit-remaining-tokens');
  result.resetTokens = get('x-ratelimit-reset-tokens');
  result.limitRequests = get('x-ratelimit-limit-requests');
  result.remainingRequests = get('x-ratelimit-remaining-requests');
  result.resetRequests = get('x-ratelimit-reset-requests');

  return result;
}

async function runExperiment1() {
  console.log('\n============================================================');
  console.log('EXPERIMENT 1: Does requested max_tokens count toward TPM?');
  console.log('============================================================');

  const client = createLLMClient({ provider: 'groq' });
  const model = 'openai/gpt-oss-20b';

  // Step 1: Baseline call with small max_tokens
  console.log('Step 1: Baseline call (max_tokens: 10)...');
  const call1Promise = client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: 'Say "hi"' }],
    max_tokens: 10,
    temperature: 0,
  });
  const res1 = await (call1Promise as any).withResponse();
  const headers1 = extractHeaders(res1.response?.headers);
  console.log('  Call 1 Usage:', res1.data.usage);
  console.log('  Call 1 Headers:');
  console.log(`    limit-tokens:     ${headers1.limitTokens}`);
  console.log(`    remaining-tokens: ${headers1.remainingTokens}`);
  console.log(`    reset-tokens:     ${headers1.resetTokens}`);

  // Wait 1 second
  await new Promise((r) => setTimeout(r, 1000));

  // Step 2: Call with large max_tokens (4000) but short 1-word answer
  console.log('\nStep 2: Large max_tokens call (max_tokens: 4000, short output)...');
  const call2Promise = client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: 'Reply with the single word: "test"' }],
    max_tokens: 4000,
    temperature: 0,
  });
  const res2 = await (call2Promise as any).withResponse();
  const headers2 = extractHeaders(res2.response?.headers);
  console.log('  Call 2 Usage:', res2.data.usage);
  console.log('  Call 2 Response:', JSON.stringify(res2.data.choices[0]?.message?.content));
  console.log('  Call 2 Headers:');
  console.log(`    limit-tokens:     ${headers2.limitTokens}`);
  console.log(`    remaining-tokens: ${headers2.remainingTokens}`);
  console.log(`    reset-tokens:     ${headers2.resetTokens}`);

  const rem1 = parseInt(headers1.remainingTokens ?? '0', 10);
  const rem2 = parseInt(headers2.remainingTokens ?? '0', 10);
  const diff = rem1 - rem2;
  console.log(`\n  Remaining tokens change: ${rem1} -> ${rem2} (delta: ${diff})`);

  return {
    call1: { usage: res1.data.usage, headers: headers1 },
    call2: { usage: res2.data.usage, headers: headers2 },
    delta: diff,
  };
}

async function runExperiment2() {
  console.log('\n============================================================');
  console.log('EXPERIMENT 2: Are limits per-model or shared across models?');
  console.log('============================================================');

  const client = createLLMClient({ provider: 'groq' });
  const modelA = 'openai/gpt-oss-20b';
  const modelB = 'qwen/qwen3.8-27b';

  console.log(`Step 1: Calling Model A ("${modelA}")...`);
  const callAPromise = client.chat.completions.create({
    model: modelA,
    messages: [{ role: 'user', content: 'Say "A"' }],
    max_tokens: 10,
    temperature: 0,
  });
  const resA = await (callAPromise as any).withResponse();
  const headersA = extractHeaders(resA.response?.headers);
  console.log('  Model A Usage:', resA.data.usage);
  console.log('  Model A Headers:');
  console.log(`    limit-tokens:     ${headersA.limitTokens}`);
  console.log(`    remaining-tokens: ${headersA.remainingTokens}`);
  console.log(`    limit-requests:   ${headersA.limitRequests}`);
  console.log(`    remaining-requests: ${headersA.remainingRequests}`);

  console.log(`\nStep 2: Calling Model B ("${modelB}")...`);
  const callBPromise = client.chat.completions.create({
    model: modelB,
    messages: [{ role: 'user', content: 'Say "B"' }],
    max_tokens: 10,
    temperature: 0,
  });
  const resB = await (callBPromise as any).withResponse();
  const headersB = extractHeaders(resB.response?.headers);
  console.log('  Model B Usage:', resB.data.usage);
  console.log('  Model B Headers:');
  console.log(`    limit-tokens:     ${headersB.limitTokens}`);
  console.log(`    remaining-tokens: ${headersB.remainingTokens}`);
  console.log(`    limit-requests:   ${headersB.limitRequests}`);
  console.log(`    remaining-requests: ${headersB.remainingRequests}`);

  return {
    modelA: { model: modelA, headers: headersA, usage: resA.data.usage },
    modelB: { model: modelB, headers: headersB, usage: resB.data.usage },
  };
}

async function main() {
  console.log('Starting Phase D Experiments (total tokens budget < 500 tokens)...\n');
  const exp1 = await runExperiment1();
  const exp2 = await runExperiment2();
  console.log('\nAll experiments completed successfully.');
}

main().catch(console.error);

