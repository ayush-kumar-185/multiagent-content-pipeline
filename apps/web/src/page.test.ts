import { describe, it, expect } from 'vitest';
import { CITEWRITER_CORE_VERSION } from '@citewriter/core';

describe('Web app scaffold test', () => {
  it('correctly links to core package version', () => {
    expect(CITEWRITER_CORE_VERSION).toBe('0.1.0');
  });
});
