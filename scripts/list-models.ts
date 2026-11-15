import dotenv from 'dotenv';
dotenv.config();

import { createLLMClient } from '../packages/core/src/llm/client.js';

interface ModelInfo {
  id: string;
  owned_by?: string;
}

async function listGroqModels(): Promise<string[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.log('[Groq] Skipped: GROQ_API_KEY not set');
    return [];
  }

  try {
    const client = createLLMClient({ provider: 'groq' });
    const response = await client.models.list();
    const models = response.data.map((m: ModelInfo) => m.id).sort();
    return models;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Groq] Error listing models:', msg);
    return [];
  }
}

async function listGeminiModels(): Promise<string[]> {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_AI_STUDIO_API_KEY;
  if (!apiKey) {
    console.log('[Gemini] Skipped: GEMINI_API_KEY not set');
    return [];
  }

  // First try OpenAI-compatible endpoint via client
  try {
    const client = createLLMClient({ provider: 'gemini' });
    const response = await client.models.list();
    const models = response.data.map((m: ModelInfo) => m.id).sort();
    if (models.length > 0) return models;
  } catch (err: unknown) {
    // If OpenAI-compatible models.list() fails or is unsupported, fall back to native REST
  }

  // Fallback to Google AI Studio v1beta native REST models list
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Gemini] REST Error (${res.status}):`, errText);
      return [];
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (data.models || [])
      .map((m) => m.name.replace(/^models\//, ''))
      .sort();
    return models;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Gemini] Error listing models:', msg);
    return [];
  }
}

async function listCerebrasModels(): Promise<string[]> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    return [];
  }

  try {
    const client = createLLMClient({ provider: 'cerebras' });
    const response = await client.models.list();
    return response.data.map((m: ModelInfo) => m.id).sort();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Cerebras] Error listing models:', msg);
    return [];
  }
}

async function main() {
  console.log('====================================================');
  console.log('Querying configured provider list-models endpoints...');
  console.log('====================================================\n');

  console.log('--- GROQ ACCESSIBLE MODELS ---');
  const groqModels = await listGroqModels();
  if (groqModels.length > 0) {
    console.log(`Total Groq Models: ${groqModels.length}`);
    for (const m of groqModels) {
      console.log(` - ${m}`);
    }
  } else {
    console.log('No models returned from Groq.');
  }

  console.log('\n--- GEMINI (GOOGLE AI STUDIO) ACCESSIBLE MODELS ---');
  const geminiModels = await listGeminiModels();
  if (geminiModels.length > 0) {
    console.log(`Total Gemini Models: ${geminiModels.length}`);
    for (const m of geminiModels) {
      console.log(` - ${m}`);
    }
  } else {
    console.log('No models returned from Gemini.');
  }

  if (process.env.CEREBRAS_API_KEY) {
    console.log('\n--- CEREBRAS ACCESSIBLE MODELS ---');
    const cerebrasModels = await listCerebrasModels();
    if (cerebrasModels.length > 0) {
      console.log(`Total Cerebras Models: ${cerebrasModels.length}`);
      for (const m of cerebrasModels) {
        console.log(` - ${m}`);
      }
    }
  }

  console.log('\n====================================================');
}

main().catch(console.error);

