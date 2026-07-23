import { describe, expect, it } from 'vitest';
import type { Note } from '../types';
import { mergeTopicNames, moveNoteInTree, removeNoteWithPromotedChildren, repairNoteHierarchy, restoreRemovedNote, selectMostRecentNoteForSubject } from './library';

function note(id: string, patch: Partial<Note> = {}): Note {
  return {
    id,
    title: id,
    subject: '计算机',
    topic: '基础',
    tags: [],
    summary: '',
    sections: [],
    cases: [],
    pitfalls: [],
    interviewQuestions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch
  };
}

describe('library domain', () => {
  it('keeps declared empty topics and merges note-derived topics case-insensitively', () => {
    expect(mergeTopicNames(['空主题', '基础'], [note('a'), note('b', { topic: '基础 ' })])).toEqual([
      '空主题',
      '基础'
    ]);
  });

  it('selects the most recently updated root note in the switched subject', () => {
    const notes = [
      note('old', { updatedAt: '2026-01-01T00:00:00.000Z' }),
      note('child', { parentId: 'old', updatedAt: '2026-03-01T00:00:00.000Z' }),
      note('new', { updatedAt: '2026-02-01T00:00:00.000Z' }),
      note('other', { subject: '数学', updatedAt: '2026-04-01T00:00:00.000Z' })
    ];
    expect(selectMostRecentNoteForSubject(notes, '计算机')?.id).toBe('new');
  });

  it('repairs missing parents, self-links, and multi-node cycles', () => {
    const repaired = repairNoteHierarchy([
      note('missing', { parentId: 'nope' }),
      note('self', { parentId: 'self' }),
      note('a', { parentId: 'b' }),
      note('b', { parentId: 'c' }),
      note('c', { parentId: 'a' })
    ]);
    expect(repaired.find((item) => item.id === 'missing')?.parentId).toBeUndefined();
    expect(repaired.find((item) => item.id === 'self')?.parentId).toBeUndefined();
    expect(repaired.find((item) => item.id === 'a')?.parentId).toBeUndefined();
    expect(repaired.find((item) => item.id === 'b')?.parentId).toBe('c');
  });

  it('moves a subtree across topics while preventing descendant cycles', () => {
    const notes = [
      note('parent', { position: 0 }),
      note('child', { parentId: 'parent', position: 0 }),
      note('target', { topic: '进阶', position: 0 })
    ];
    expect(moveNoteInTree(notes, {
      draggedId: 'parent', targetId: 'child', placement: 'inside', movedAt: '2026-02-01'
    })).toBe(notes);
    const moved = moveNoteInTree(notes, {
      draggedId: 'parent', targetId: 'target', placement: 'after', movedAt: '2026-02-01'
    });
    expect(moved.find((item) => item.id === 'parent')).toMatchObject({ topic: '进阶', parentId: undefined, position: 1 });
    expect(moved.find((item) => item.id === 'child')).toMatchObject({ topic: '进阶', parentId: 'parent' });
  });

  it('promotes direct children on delete and restores the hierarchy on undo', () => {
    const notes = [note('root'), note('child', { parentId: 'root' }), note('grandchild', { parentId: 'child' })];
    const removed = removeNoteWithPromotedChildren(notes, 'root');
    expect(removed.notes.find((item) => item.id === 'child')?.parentId).toBeUndefined();
    const restored = restoreRemovedNote(removed.notes, removed.removed!, removed.directChildIds);
    expect(restored.find((item) => item.id === 'child')?.parentId).toBe('root');
    expect(restored.find((item) => item.id === 'grandchild')?.parentId).toBe('child');
  });
});
