import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn utility', () => {
  it('combines class names and resolves tailwind collisions', () => {
    const result = cn('px-2 py-1', 'bg-red-500', { 'text-white': true, hidden: false });
    expect(result).toBe('px-2 py-1 bg-red-500 text-white');

    const overridden = cn('p-4', 'p-2');
    expect(overridden).toBe('p-2');
  });
});
