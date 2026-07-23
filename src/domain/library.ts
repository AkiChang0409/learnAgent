import type { Note } from '../types';
import { cleanSubjectName } from '../services/notes';

export function mergeTopicNames(declaredTopics: string[] = [], notes: Note[] = []): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const rawTopic of [...declaredTopics, ...notes.map((note) => note.topic)]) {
    const topic = rawTopic.trim() || '未命名主题';
    const key = topic.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
  }
  return topics;
}

export function selectMostRecentNoteForSubject(notes: Note[], subjectName: string): Note | undefined {
  const subject = cleanSubjectName(subjectName);
  const candidates = notes.filter((note) => cleanSubjectName(note.subject) === subject);
  const byRecent = (a: Note, b: Note) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  return candidates.filter((note) => !note.parentId).sort(byRecent)[0] || candidates.sort(byRecent)[0];
}

/**
 * Repairs broken parent references without deleting user content. For a cycle,
 * exactly one deterministic edge is removed so the remaining hierarchy is kept.
 */
export function repairNoteHierarchy(notes: Note[]): Note[] {
  const byId = new Map(notes.map((note) => [note.id, { ...note }]));
  for (const note of byId.values()) {
    if (note.parentId === note.id || (note.parentId && !byId.has(note.parentId))) {
      note.parentId = undefined;
    }
  }

  const processed = new Set<string>();
  for (const start of byId.keys()) {
    if (processed.has(start)) continue;
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let current: string | undefined = start;
    while (current && byId.has(current) && !processed.has(current)) {
      const cycleAt = pathIndex.get(current);
      if (cycleAt !== undefined) {
        const cycleIds = path.slice(cycleAt).sort((a, b) => a.localeCompare(b));
        const breakId = cycleIds[0];
        const cycleNote = byId.get(breakId);
        if (cycleNote) cycleNote.parentId = undefined;
        break;
      }
      pathIndex.set(current, path.length);
      path.push(current);
      current = byId.get(current)?.parentId;
    }
    path.forEach((id) => processed.add(id));
  }
  return notes.map((note) => byId.get(note.id) || note);
}

export function noteSortValue(note: Note) {
  return note.position ?? Number.MAX_SAFE_INTEGER;
}

export function rootNotePosition(notes: Note[], subject: string, topic: string) {
  const roots = notes.filter((note) => !note.parentId && note.subject === subject && note.topic === topic);
  return roots.length ? Math.max(...roots.map(noteSortValue)) + 1 : 0;
}

function descendantsOf(notes: Note[], parentId: string) {
  const ids = new Set<string>();
  const visit = (id: string) => notes.filter((note) => note.parentId === id).forEach((child) => {
    if (ids.has(child.id)) return;
    ids.add(child.id);
    visit(child.id);
  });
  visit(parentId);
  return ids;
}

function positionKey(note: Pick<Note, 'subject' | 'topic' | 'parentId'>) {
  return `${note.subject || '通用学习'}\u0000${note.topic || '未命名主题'}\u0000${note.parentId || ''}`;
}

export function normalizeNotePositions(
  notes: Note[],
  preferredOrder?: { subject: string; topic: string; parentId: string; orderedIds: string[] }
) {
  const preferred = preferredOrder ? new Map(preferredOrder.orderedIds.map((id, index) => [id, index])) : null;
  const preferredKey = preferredOrder ? positionKey(preferredOrder) : '';
  const groups = new Map<string, Note[]>();
  notes.forEach((note) => groups.set(positionKey(note), [...(groups.get(positionKey(note)) || []), note]));
  const positions = new Map<string, number>();
  groups.forEach((group, key) => {
    [...group].sort((a, b) => {
      if (preferred && key === preferredKey) {
        return (preferred.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (preferred.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      }
      return noteSortValue(a) - noteSortValue(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    }).forEach((note, index) => positions.set(note.id, index));
  });
  return notes.map((note) => ({ ...note, position: positions.get(note.id) ?? note.position ?? 0 }));
}

export function moveNoteInTree(notes: Note[], input: {
  draggedId: string;
  targetId: string | null;
  placement: 'before' | 'inside' | 'after' | 'root' | 'topic';
  targetTopic?: string;
  targetSubject?: string;
  movedAt: string;
}): Note[] {
  const dragged = notes.find((note) => note.id === input.draggedId);
  const target = input.targetId ? notes.find((note) => note.id === input.targetId) : null;
  if (!dragged || (input.targetId && !target) || input.targetId === input.draggedId) return notes;
  const childIds = descendantsOf(notes, input.draggedId);
  if (input.targetId && childIds.has(input.targetId)) return notes;
  const subject = target?.subject || input.targetSubject || dragged.subject || '通用学习';
  const topic = input.placement === 'topic' ? input.targetTopic || dragged.topic || '未命名主题'
    : input.placement === 'root' ? dragged.topic : target?.topic || dragged.topic || '未命名主题';
  const parentId = input.placement === 'root' || input.placement === 'topic' ? undefined
    : input.placement === 'inside' ? target?.id : target?.parentId;
  const moved = notes.map((note) => note.id === dragged.id
    ? { ...note, subject, topic, parentId, updatedAt: input.movedAt }
    : childIds.has(note.id) ? { ...note, subject, topic, updatedAt: input.movedAt } : note);
  const siblingIds = moved.filter((note) => note.subject === subject && note.topic === topic
    && (note.parentId || '') === (parentId || '') && note.id !== dragged.id)
    .sort((a, b) => noteSortValue(a) - noteSortValue(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((note) => note.id);
  let index = siblingIds.length;
  if ((input.placement === 'before' || input.placement === 'after') && target) {
    const targetIndex = siblingIds.indexOf(target.id);
    index = targetIndex < 0 ? siblingIds.length : targetIndex + (input.placement === 'after' ? 1 : 0);
  }
  const orderedIds = [...siblingIds];
  orderedIds.splice(index, 0, dragged.id);
  return normalizeNotePositions(moved, { subject, topic, parentId: parentId || '', orderedIds });
}

export function removeNoteWithPromotedChildren(notes: Note[], noteId: string) {
  const removed = notes.find((note) => note.id === noteId);
  if (!removed) return { notes, removed: undefined, directChildIds: [] as string[] };
  const directChildIds = notes.filter((note) => note.parentId === noteId).map((note) => note.id);
  return {
    removed,
    directChildIds,
    notes: normalizeNotePositions(notes.filter((note) => note.id !== noteId)
      .map((note) => note.parentId === noteId ? { ...note, parentId: removed.parentId } : note))
  };
}

export function restoreRemovedNote(notes: Note[], removed: Note, directChildIds: string[]) {
  if (notes.some((note) => note.id === removed.id)) return notes;
  return normalizeNotePositions([
    ...notes.map((note) => directChildIds.includes(note.id) ? { ...note, parentId: removed.id } : note),
    removed
  ]);
}
