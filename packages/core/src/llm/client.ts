import OpenAI from 'openai';
import dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config();

export interface LLMClientConfig {
  apiKey?: string;
  baseURL?: string;
}

export function createLLMClient(config: LLMClientConfig = {}): OpenAI {
  const apiKey =
    config.apiKey ??
    process.env.OPENROUTER_API_KEY ??
    process.env.OPENAI_API_KEY ??
    'dummy-key-for-stubs-and-tests';

  const isUsingOpenRouter = Boolean(process.env.OPENROUTER_API_KEY && !process.env.OPENAI_BASE_URL);

  const baseURL =
    config.baseURL ??
    process.env.OPENAI_BASE_URL ??
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
