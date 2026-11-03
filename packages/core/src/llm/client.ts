import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'node:path';

// Ensure environment variables are loaded from cwd or monorepo root
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

export interface LLMClientConfig {
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

export function createLLMClient(config: LLMClientConfig = {}): OpenAI {
  const envKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  const apiKey = config.apiKey || envKey || 'dummy-key-for-stubs-and-tests';

  const isUsingOpenRouter = Boolean(process.env.OPENROUTER_API_KEY && !process.env.OPENAI_BASE_URL);

  const baseURL =
    config.baseURL ||
    process.env.OPENAI_BASE_URL ||
    (isUsingOpenRouter ? 'https://openrouter.ai/api/v1' : undefined);

  const defaultHeaders = isUsingOpenRouter
    ? {
        'HTTP-Referer': 'https://citewriter.local',
        'X-Title': 'CiteWriter Multi-Agent Engine',
      }
    : undefined;

  return new OpenAI({
    apiKey,
    baseURL,
    defaultHeaders,
    timeout: config.timeout ?? 30_000,
    maxRetries: config.maxRetries ?? 3,
  });
}

export type AgentRole = 'researcher' | 'writer' | 'factChecker' | 'editor';

export function getAgentModel(role: AgentRole): string {
  switch (role) {
    case 'researcher':
      return process.env.RESEARCHER_MODEL ?? 'gpt-4o-mini';
    case 'writer':
      return process.env.WRITER_MODEL ?? 'gpt-4o';
    case 'factChecker':
      return process.env.FACT_CHECKER_MODEL ?? 'gpt-4o-mini';
    case 'editor':
      return process.env.EDITOR_MODEL ?? 'gpt-4o';
  }
}
