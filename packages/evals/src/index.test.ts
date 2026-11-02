import { describe, it, expect } from 'vitest';
import { EVALS_SUITE_VERSION, getEvalsInfo } from './index.js';

describe('@citewriter/evals scaffold sanity check', () => {
  it('should export the version correctly', () => {
    expect(EVALS_SUITE_VERSION).toBe('0.1.0');
  });

  it('should reference core version correctly', () => {
    const info = getEvalsInfo();
    expect(info.version).toBe('0.1.0');
    expect(info.coreVersion).toBe('0.1.0');
  });
});
