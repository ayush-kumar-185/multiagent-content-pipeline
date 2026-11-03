import { CITEWRITER_CORE_VERSION } from '@citewriter/core';

export const EVALS_SUITE_VERSION = '0.1.0';

export function getEvalsInfo() {
  return {
    version: EVALS_SUITE_VERSION,
    coreVersion: CITEWRITER_CORE_VERSION,
  };
}

export * from './types.js';
export * from './loader.js';
export * from './metrics.js';
export * from './baselines.js';
export * from './reportGenerator.js';
export * from './runner.js';
