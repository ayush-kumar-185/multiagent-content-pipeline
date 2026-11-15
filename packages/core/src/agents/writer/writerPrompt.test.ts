import { describe, it, expect } from 'vitest';
import {
  buildWriterSystemPrompt,
  buildWriterInitialPrompt,
  buildWriterRevisionPrompt,
} from './prompt.js';
import { Note } from '../../schemas/note.js';
import { ClaimCheck } from '../../schemas/claim.js';

describe('Writer Prompt Generation', () => {
  const sampleNotes: Note[] = [
    {
      id: 'n1',
      claim: 'TypeScript 5.0 treats all enums as union enums.',
      sourceUrl: 'https://typescriptlang.org/release-notes/5.0',
      quote: 'TypeScript 5.0 manages to make all enums into union enums.',
      retrievedAt: '2026-11-15T10:00:00.000Z',
    },
    {
      id: 'n2',
      claim: 'TypeScript 5.0 introduces --verbatimModuleSyntax.',
      sourceUrl: 'https://typescriptlang.org/release-notes/5.0',
      quote: 'TypeScript 5.0 introduces a new option called --verbatimModuleSyntax.',
      retrievedAt: '2026-11-15T10:00:00.000Z',
    },
    {
      id: 'n3',
      claim: 'TypeScript 5.0 introduced const type parameters.',
      sourceUrl: 'https://geeksforgeeks.org/ts-5-updates',
      quote: 'TypeScript 5.0 introduced const type parameters for improved inference.',
      retrievedAt: '2026-11-15T10:00:00.000Z',
    },
  ];

  it('buildWriterRevisionPrompt includes all notes, their IDs, claims, and quotes', () => {
    const topic = 'Advances in TypeScript 5.0 Type Inference';
    const previousDraft = '# TypeScript 5.0\n\nTypeScript 5.0 treats all enums as union enums [n1].';
    const unsupportedClaims: ClaimCheck[] = [
      {
        claim: 'TypeScript 5.0 doubles compile speed across projects.',
        noteIds: ['n1'],
        status: 'unsupported',
        reason: 'No note supports speed doubling.',
      },
    ];
    const editorVerdict = {
      score: 7.5,
      feedback: 'Incorporate new notes on const type parameters.',
      decision: 'revise' as const,
    };

    const prompt = buildWriterRevisionPrompt(
      topic,
      sampleNotes,
      previousDraft,
      unsupportedClaims,
      editorVerdict,
    );

    // Verify all notes are present in the revision prompt
    for (const note of sampleNotes) {
      expect(prompt).toContain(`[${note.id}]`);
      expect(prompt).toContain(note.claim);
      expect(prompt).toContain(note.quote);
      expect(prompt).toContain(note.sourceUrl);
    }

    // Verify core instructions are present
    expect(prompt).toContain('Cover every distinct note at least once where the note is relevant to the topic');
    expect(prompt).toContain("prioritize notes that match the topic's key terms");
    expect(prompt).toContain('When new notes are added after re-research, actively use and incorporate them into the next draft');
    expect(prompt).toContain('Do not loosen the citation rule');
    expect(prompt).toContain(previousDraft);
    expect(prompt).toContain('TypeScript 5.0 doubles compile speed across projects.');
    expect(prompt).toContain('Incorporate new notes on const type parameters.');
  });

  it('buildWriterSystemPrompt and buildWriterInitialPrompt enforce distinct note coverage without loosening citations', () => {
    const sysPrompt = buildWriterSystemPrompt({
      audience: 'engineers',
      tone: 'technical',
      targetWords: 500,
    });
    expect(sysPrompt).toContain('Cover every distinct note at least once where the note is relevant to the topic');
    expect(sysPrompt).toContain("Prioritize notes that match the topic's key terms");
    expect(sysPrompt).toContain('DO NOT LOOSEN CITATION RULES');

    const initPrompt = buildWriterInitialPrompt('Advances in TypeScript 5.0 Type Inference', sampleNotes);
    expect(initPrompt).toContain('Cover every distinct note at least once where the note is relevant to the topic');
    expect(initPrompt).toContain("prioritize notes that match the topic's key terms");
    expect(initPrompt).toContain('Do not loosen the citation rule');
  });
});
