import { describe, expect, it } from 'vitest';
import { appDataReducer } from '../src/domain/app-data-reducer';
import { emptyData } from '../src/services/notes';

describe('app data reducer', () => {
  it('supports functional updates without mutating the previous snapshot', () => {
    const previous = { ...emptyData, notes: [] };
    const next = appDataReducer(previous, {
      type: 'update',
      update: (current) => ({ ...current, notes: [{
        id: 'n1', title: '新笔记', subject: '计算机', topic: '架构', tags: [], summary: '', sections: [],
        cases: [], pitfalls: [], interviewQuestions: [], createdAt: '2026-01-01', updatedAt: '2026-01-01'
      }] })
    });
    expect(previous.notes).toHaveLength(0);
    expect(next.notes[0].title).toBe('新笔记');
  });
});
