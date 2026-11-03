export const CITEWRITER_CORE_VERSION = '0.1.0';

export interface CoreSanityCheck {
  status: 'ok';
  initializedAt: string;
}

export function getCoreStatus(): CoreSanityCheck {
  return {
    status: 'ok',
    initializedAt: new Date().toISOString(),
  };
}

export * from './schemas/index.js';
export * from './graph/index.js';
export * from './llm/index.js';
export * from './tools/index.js';
export * from './agents/index.js';
export * from './observability/index.js';
