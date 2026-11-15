import { resolveProvider, AgentRole } from '@citewriter/core';

export class MissingApiKeyError extends Error {
  public readonly missingKeys: string[];

  constructor(missingKeys: string[]) {
    super(
      `Startup failed: USE_REAL_LLM=true but missing required API key(s): ${missingKeys.join(', ')}. Please configure these environment variables or set USE_REAL_LLM=false for offline mock mode.`,
    );
    this.name = 'MissingApiKeyError';
    this.missingKeys = missingKeys;
  }
}

/**
 * Returns whether real LLM mode is enabled.
 */
export function isRealLLMMode(): boolean {
  return process.env.USE_REAL_LLM === 'true';
}

/**
 * Validates that all required provider and search keys are configured when USE_REAL_LLM=true.
 * Lists missing keys by name without exposing any existing secret values.
 * Throws MissingApiKeyError if any required key is missing.
 */
export function validateStartupEnvironment(): { mode: 'real' | 'mock'; missingKeys?: string[] } {
  if (!isRealLLMMode()) {
    return { mode: 'mock' };
  }

  const missing = new Set<string>();

  // 1. Check Search Provider Key
  const searchProvider = (process.env.SEARCH_PROVIDER || 'tavily').toLowerCase();
  if (searchProvider === 'tavily') {
    if (!process.env.TAVILY_API_KEY) {
      missing.add('TAVILY_API_KEY');
    }
  } else if (searchProvider === 'brave') {
    if (!process.env.BRAVE_SEARCH_API_KEY) {
      missing.add('BRAVE_SEARCH_API_KEY');
    }
  }

  // 2. Check Configured Agent LLM Providers
  const roles: AgentRole[] = ['researcher', 'writer', 'factChecker', 'editor'];
  for (const role of roles) {
    const provider = resolveProvider({ role });
    switch (provider) {
      case 'gemini':
        if (
          !process.env.GEMINI_API_KEY &&
          !process.env.GOOGLE_API_KEY &&
          !process.env.GOOGLE_AI_STUDIO_API_KEY
        ) {
          missing.add('GEMINI_API_KEY');
        }
        break;
      case 'groq':
        if (!process.env.GROQ_API_KEY) {
          missing.add('GROQ_API_KEY');
        }
        break;
      case 'cerebras':
        if (!process.env.CEREBRAS_API_KEY) {
          missing.add('CEREBRAS_API_KEY');
        }
        break;
      case 'openai':
        if (!process.env.OPENAI_API_KEY) {
          missing.add('OPENAI_API_KEY');
        }
        break;
      case 'ollama':
        // Ollama runs locally; no cloud API key strictly required
        break;
    }
  }

  if (missing.size > 0) {
    throw new MissingApiKeyError(Array.from(missing));
  }

  return { mode: 'real' };
}
