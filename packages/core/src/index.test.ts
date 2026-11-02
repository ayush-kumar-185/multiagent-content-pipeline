import { describe, it, expect } from 'vitest';
import { CITEWRITER_CORE_VERSION, getCoreStatus } from './index.js';

describe('@citewriter/core scaffold sanity check', () => {
  it('should export the version correctly', () => {
    expect(CITEWRITER_CORE_VERSION).toBe('0.1.0');
  });

  it('should return a valid status object', () => {
    const status = getCoreStatus();
    expect(status.status).toBe('ok');
    expect(typeof status.initializedAt).toBe('string');
  });
});
