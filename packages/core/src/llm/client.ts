import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'node:path';

// Ensure environment variables are loaded from cwd or monorepo root
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import { LLMProvider, AgentRole } from './types.js';

export const PROVIDER_DEFAULT_BASE_URLS: Record<LLMProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  ollama: 'http://localhost:11434/v1',
  openai: 'https://api.openai.com/v1',
};

export const SUPPORTED_PROVIDERS: LLMProvider[] = ['gemini', 'groq', 'cerebras', 'ollama', 'openai'];

function isValidProvider(val: string): val is LLMProvider {
  return SUPPORTED_PROVIDERS.includes(val.toLowerCase() as LLMProvider);
}

export function roleToEnvPrefix(role: AgentRole): string {
  switch (role) {
    case 'researcher':
      return 'RESEARCHER';
    case 'writer':
      return 'WRITER';
    case 'factChecker':
      return 'FACT_CHECKER';
    case 'editor':
      return 'EDITOR';
  }
}

/**
 * Checks whether at least one LLM provider (Google AI Studio, Groq, Cerebras, Ollama, or OpenAI)
 * is configured in the environment.
 */
export function hasConfiguredLLM(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_AI_STUDIO_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.CEREBRAS_API_KEY ||
      process.env.OLLAMA_BASE_URL ||
      process.env.OPENAI_API_KEY,
  );
}

/**
 * Resolves the appropriate LLM provider based on explicit config, agent role,
 * model name heuristics, or available API keys.
 */
export function resolveProvider(options?: {
  provider?: string;
  role?: AgentRole;
  model?: string;
}): LLMProvider {
  // 1. Explicit provider passed in options
  if (options?.provider && isValidProvider(options.provider)) {
    return options.provider.toLowerCase() as LLMProvider;
  }

  // 2. Unambiguous model name heuristics
  // Models that can only belong to a specific provider
  const modelStr = (options?.model || '').toLowerCase();
  if (modelStr.includes('gemini')) return 'gemini';
  if (
    modelStr.includes('groq') ||
    modelStr.includes('versatile') ||
    modelStr.includes('instant') ||
    modelStr.includes('mixtral') ||
    modelStr.includes('gemma2')
  ) {
    return 'groq';
  }
  if (modelStr.includes('cerebras')) return 'cerebras';
  if (modelStr.includes('ollama')) return 'ollama';

  // 3. Role-specific environment override (e.g. WRITER_PROVIDER=cerebras)
  if (options?.role) {
    const rolePrefix = roleToEnvPrefix(options.role);
    const envRoleProvider = process.env[`${rolePrefix}_PROVIDER`]?.trim().toLowerCase();
    if (envRoleProvider && isValidProvider(envRoleProvider)) {
      return envRoleProvider;
    }
  }

  // 4. Global default provider override
  const globalProvider = (process.env.LLM_PROVIDER || process.env.DEFAULT_LLM_PROVIDER)?.trim().toLowerCase();
  if (globalProvider && isValidProvider(globalProvider)) {
    return globalProvider;
  }

  // 5. Ambiguous model heuristics (e.g. llama3.3 which could be Cerebras or Groq)
  if (
    modelStr.startsWith('llama3.3') ||
    modelStr.startsWith('llama-3.3') ||
    modelStr.startsWith('llama3.1') ||
    modelStr.startsWith('llama-3.1')
  ) {
    if (process.env.CEREBRAS_API_KEY) return 'cerebras';
    if (process.env.GROQ_API_KEY) return 'groq';
    return 'cerebras';
  }

  // 6. Credential availability fallback
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_STUDIO_API_KEY) {
    return 'gemini';
  }
  if (process.env.GROQ_API_KEY) {
    return 'groq';
  }
  if (process.env.CEREBRAS_API_KEY) {
    return 'cerebras';
  }
  if (process.env.OLLAMA_BASE_URL) {
    return 'ollama';
  }
  if (process.env.OPENAI_API_KEY) {
    return 'openai';
  }

  // Default to gemini (Google AI Studio)
  return 'gemini';
}

/**
 * Retrieves the API key for a given provider.
 */
export function getProviderApiKey(provider: LLMProvider): string {
  switch (provider) {
    case 'gemini':
      return (
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.GOOGLE_AI_STUDIO_API_KEY ||
        'dummy-gemini-key'
      );
    case 'groq':
      return process.env.GROQ_API_KEY || 'dummy-groq-key';
    case 'cerebras':
      return process.env.CEREBRAS_API_KEY || 'dummy-cerebras-key';
    case 'ollama':
      return process.env.OLLAMA_API_KEY || 'ollama';
    case 'openai':
      return process.env.OPENAI_API_KEY || 'dummy-openai-key';
  }
}

/**
 * Retrieves the base URL for a given provider, respecting custom base URL overrides.
 */
export function getProviderBaseUrl(provider: LLMProvider): string {
  switch (provider) {
    case 'gemini':
      return process.env.GEMINI_BASE_URL || PROVIDER_DEFAULT_BASE_URLS.gemini;
    case 'groq':
      return process.env.GROQ_BASE_URL || PROVIDER_DEFAULT_BASE_URLS.groq;
    case 'cerebras':
      return process.env.CEREBRAS_BASE_URL || PROVIDER_DEFAULT_BASE_URLS.cerebras;
    case 'ollama':
      return process.env.OLLAMA_BASE_URL || PROVIDER_DEFAULT_BASE_URLS.ollama;
    case 'openai':
      return process.env.OPENAI_BASE_URL || PROVIDER_DEFAULT_BASE_URLS.openai;
  }
}

/**
 * Normalizes model names for the provider (e.g. strips external prefixes like "google/" or "groq/").
 */
export function normalizeModelForProvider(model: string, provider: LLMProvider): string {
  let cleaned = model.trim();

  // Strip explicit provider prefix if formatted with space delimiter as "provider / model"
  const spaceMatch = cleaned.match(/^([a-z0-9_-]+)\s+\/\s+(.*)$/i);
  if (spaceMatch && spaceMatch[1] && spaceMatch[2] && isValidProvider(spaceMatch[1])) {
    cleaned = spaceMatch[2].trim();
  }

  switch (provider) {
    case 'gemini':
      if (cleaned.toLowerCase().startsWith('gemini/') || cleaned.toLowerCase().startsWith('google/')) {
        cleaned = cleaned.replace(/^(gemini|google)\//i, '');
      }
      return cleaned;

    case 'groq':
      if (cleaned.toLowerCase().startsWith('groq/')) {
        cleaned = cleaned.slice('groq/'.length);
      }
      return cleaned;

    case 'cerebras':
      if (cleaned.toLowerCase().startsWith('cerebras/')) {
        cleaned = cleaned.slice('cerebras/'.length);
      }
      if (cleaned === 'meta-llama/llama-3.3-70b-instruct') {
        return 'llama3.3-70b';
      }
      if (cleaned === 'meta-llama/llama-3.1-8b-instruct') {
        return 'llama3.1-8b';
      }
      return cleaned;

    case 'ollama':
      if (cleaned.toLowerCase().startsWith('ollama/')) {
        cleaned = cleaned.slice('ollama/'.length);
      }
      return cleaned;

    case 'openai':
      if (cleaned.toLowerCase().startsWith('openai/')) {
        cleaned = cleaned.slice('openai/'.length);
      }
      return cleaned;
  }
}

export function getAgentProvider(role: AgentRole): LLMProvider {
  const rolePrefix = roleToEnvPrefix(role);
  const envProvider =
    process.env[`${rolePrefix}_PROVIDER`] ??
    (role === 'factChecker' ? process.env.FACTCHECKER_PROVIDER : undefined);
  if (envProvider && isValidProvider(envProvider)) {
    return envProvider.trim().toLowerCase() as LLMProvider;
  }

  // Check if model string starts with provider prefix e.g. "groq / ..."
  const rawModel =
    process.env[`${rolePrefix}_MODEL`] ??
    (role === 'factChecker' ? process.env.FACTCHECKER_MODEL : undefined);
  if (rawModel && rawModel.includes('/')) {
    const parts = rawModel.split(/\s*\/\s*/);
    const providerPart = parts[0];
    if (providerPart && isValidProvider(providerPart)) {
      return providerPart.trim().toLowerCase() as LLMProvider;
    }
  }

  return resolveProvider({ role, model: getAgentModel(role) });
}

export function getAgentModel(role: AgentRole): string {
  const rolePrefix = roleToEnvPrefix(role);
  let raw =
    process.env[`${rolePrefix}_MODEL`] ??
    (role === 'factChecker' ? process.env.FACTCHECKER_MODEL : undefined);

  if (!raw) {
    switch (role) {
      case 'researcher':
        return 'openai/gpt-oss-20b';
      case 'writer':
        return 'qwen/qwen3.8-27b';
      case 'factChecker':
        return 'openai/gpt-oss-120b';
      case 'editor':
        return 'gemini-3.1-flash-lite';
    }
  }

  raw = raw.trim();
  // If format is spaced "provider / model", e.g. "groq / openai/gpt-oss-20b"
  const spaceMatch = raw.match(/^([a-z0-9_-]+)\s+\/\s+(.*)$/i);
  if (spaceMatch && spaceMatch[1] && spaceMatch[2] && isValidProvider(spaceMatch[1])) {
    return spaceMatch[2].trim();
  }

  // If format is prefixed with this role's configured provider, e.g. "groq/openai/gpt-oss-20b"
  const roleProvider =
    process.env[`${rolePrefix}_PROVIDER`] ??
    (role === 'factChecker' ? process.env.FACTCHECKER_PROVIDER : undefined);
  if (roleProvider && raw.toLowerCase().startsWith(`${roleProvider.toLowerCase()}/`)) {
    return raw.slice(roleProvider.length + 1).trim();
  }

  return raw;
}

export function getAgentMaxTokens(role: AgentRole): number {
  const rolePrefix = roleToEnvPrefix(role);
  const raw =
    process.env[`${rolePrefix}_MAX_TOKENS`] ??
    (role === 'factChecker' ? process.env.FACTCHECKER_MAX_TOKENS : undefined);
  if (raw && !isNaN(Number(raw))) {
    return Number(raw);
  }
  switch (role) {
    case 'researcher':
      return 2000;
    case 'writer':
      return 2500;
    case 'factChecker':
      return 2500;
    case 'editor':
      return 600;
  }
}

export function getAgentReasoningEffort(role: AgentRole): string | undefined {
  const rolePrefix = roleToEnvPrefix(role);
  const raw =
    process.env[`${rolePrefix}_REASONING_EFFORT`] ??
    (role === 'factChecker' ? process.env.FACTCHECKER_REASONING_EFFORT : undefined);
  return raw ? raw.trim().toLowerCase() : undefined;
}

export interface LLMClientConfig {
  apiKey?: string;
  baseURL?: string;
  provider?: LLMProvider;
  role?: AgentRole;
  model?: string;
  timeout?: number;
  maxRetries?: number;
  defaultHeaders?: Record<string, string>;
}

export function createLLMClient(config: LLMClientConfig = {}): OpenAI {
  const provider = resolveProvider({
    provider: config.provider,
    role: config.role,
    model: config.model,
  });

  const apiKey = config.apiKey || getProviderApiKey(provider);
  const baseURL = config.baseURL || getProviderBaseUrl(provider);

  return new OpenAI({
    apiKey,
    baseURL,
    defaultHeaders: config.defaultHeaders,
    timeout: config.timeout ?? 30_000,
    maxRetries: config.maxRetries ?? 3,
  });
}

export function createLLMClientForAgent(role: AgentRole): OpenAI {
  return createLLMClient({ role, model: getAgentModel(role) });
}
