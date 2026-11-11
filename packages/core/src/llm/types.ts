export type LLMProvider = 'gemini' | 'groq' | 'cerebras' | 'ollama' | 'openai';

export type AgentRole = 'researcher' | 'writer' | 'factChecker' | 'editor';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface BudgetLimits {
  maxRunTokens: number;
  maxRunCostUsd: number;
}
