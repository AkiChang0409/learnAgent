import { describe, expect, it } from 'vitest';
import type { AppData } from '../types';
import { emptyData } from '../services/notes';
import { createChangeBatch } from './useAutosave';

describe('createChangeBatch', () => {
  it('transports only changed entities and deletions', () => {
    const before: AppData = { ...emptyData, notes: [] };
    const note = {
      id: 'n1', title: 'A', subject: 'S', topic: 'T', tags: [], summary: '', sections: [], cases: [], pitfalls: [],
      interviewQuestions: [], createdAt: '2026-01-01', updatedAt: '2026-01-01'
    };
    const after: AppData = { ...before, notes: [note] };
    expect(createChangeBatch(before, after).notes).toEqual({ upsert: [note], deleteIds: [] });
    expect(createChangeBatch(after, before).notes).toEqual({ upsert: [], deleteIds: ['n1'] });
  });
});
