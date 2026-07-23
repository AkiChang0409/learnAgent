import {
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import type { DragEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from '../types';
import type { SaveState } from '../hooks/useAutosave';
import { cleanSubjectName, formatDate } from '../services/notes';

export type NoteDropPlacement = 'before' | 'inside' | 'after' | 'root' | 'topic';
type DropTarget = { subject: string; noteId: string | null; placement: NoteDropPlacement; topic?: string } | null;

export interface RailSubject {
  id: string;
  name: string;
  noteCount: number;
  topicCount: number;
}

interface NoteTreeNode {
  note: Note;
  children: NoteTreeNode[];
}

interface TopicGroup {
  topic: string;
  nodes: NoteTreeNode[];
  noteCount: number;
  latestUpdatedAt: string;
}

function noteSortValue(note: Note) {
  return note.position ?? Number.MAX_SAFE_INTEGER;
}

function sortNotes(notes: Note[]) {
  return [...notes].sort(
    (a, b) => noteSortValue(a) - noteSortValue(b) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

function buildNoteTree(notes: Note[]): NoteTreeNode[] {
  const noteIds = new Set(notes.map((note) => note.id));
  const nodes = new Map(notes.map((note) => [note.id, { note, children: [] as NoteTreeNode[] }]));
  const roots: NoteTreeNode[] = [];

  sortNotes(notes).forEach((note) => {
    const node = nodes.get(note.id);
    if (!node) return;
    if (note.parentId && noteIds.has(note.parentId)) {
      nodes.get(note.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  });

  nodes.forEach((node) => {
    node.children = sortNotes(node.children.map((child) => child.note))
      .map((childNote) => nodes.get(childNote.id))
      .filter(Boolean) as NoteTreeNode[];
  });

  return roots;
}

function buildTopicGroups(notes: Note[]): TopicGroup[] {
  const groups = new Map<string, Note[]>();
  notes.forEach((note) => {
    const topic = note.topic.trim() || '未命名主题';
    groups.set(topic, [...(groups.get(topic) || []), note]);
  });

  return Array.from(groups.entries())
    .map(([topic, topicNotes]) => ({
      topic,
      nodes: buildNoteTree(topicNotes),
      noteCount: topicNotes.length,
      latestUpdatedAt:
        topicNotes.map((note) => note.updatedAt).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || ''
    }))
    .sort((a, b) => new Date(b.latestUpdatedAt).getTime() - new Date(a.latestUpdatedAt).getTime());
}

export function AppRail({
  notes,
  subjects,
  selectedNoteId,
  focusedSubject,
  isSettingsOpen,
  noteSearch,
  searchResults,
  saveState,
  isImporting,
  expandedSubjects,
  onSearchChange,
  onToggleSubject,
  onSelectNote,
  onCreateSubject,
  onRenameSubject,
  onDeleteSubject,
  onMoveNote,
  onNewBlank,
  onNewGenerate,
  onImport,
  onOpenSettings
}: {
  notes: Note[];
  subjects: RailSubject[];
  selectedNoteId: string;
  focusedSubject: string | null;
  isSettingsOpen: boolean;
  noteSearch: string;
  searchResults: Note[];
  saveState: SaveState;
  isImporting: boolean;
  expandedSubjects: Set<string>;
  onSearchChange: (value: string) => void;
  onToggleSubject: (name: string) => void;
  onSelectNote: (noteId: string, subject: string) => void;
  onCreateSubject: (name: string) => void;
  onRenameSubject: (id: string, name: string) => void;
  onDeleteSubject: (subject: RailSubject) => void;
  onMoveNote: (
    draggedId: string,
    targetId: string | null,
    placement: NoteDropPlacement,
    targetTopic: string | undefined,
    targetSubject: string
  ) => void;
  onNewBlank: () => void;
  onNewGenerate: () => void;
  onImport: () => void;
  onOpenSettings: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const knownExpandableIds = useRef<Set<string>>(new Set());

  const isSearching = Boolean(noteSearch.trim());

  const notesBySubject = useMemo(() => {
    const map = new Map<string, Note[]>();
    notes.forEach((note) => {
      const subject = cleanSubjectName(note.subject);
      map.set(subject, [...(map.get(subject) || []), note]);
    });
    return map;
  }, [notes]);

  // Auto-expand newly-seen note groups so nested notes are visible by default.
  useEffect(() => {
    setExpandedIds((current) => {
      const next = new Set(current);
      notes.forEach((note) => {
        if (note.parentId && !knownExpandableIds.current.has(note.parentId)) {
          next.add(note.parentId);
          knownExpandableIds.current.add(note.parentId);
        }
      });
      return next;
    });
  }, [notes]);

  function toggleExpanded(noteId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  function submitCreate() {
    const name = newName.trim();
    if (!name) return;
    onCreateSubject(name);
    setNewName('');
    setCreating(false);
  }

  function submitRename(id: string) {
    const name = editingName.trim();
    if (name) onRenameSubject(id, name);
    setEditingId(null);
    setEditingName('');
  }

  function finishDrop() {
    if (!draggedId || !dropTarget) return;
    onMoveNote(draggedId, dropTarget.noteId, dropTarget.placement, dropTarget.topic, dropTarget.subject);
    if (dropTarget.placement === 'inside' && dropTarget.noteId) {
      setExpandedIds((current) => new Set(current).add(dropTarget.noteId || ''));
    }
    setDraggedId(null);
    setDropTarget(null);
  }

  const searchGroups = useMemo(() => {
    if (!isSearching) return [];
    const map = new Map<string, Note[]>();
    searchResults.forEach((note) => {
      const subject = cleanSubjectName(note.subject);
      map.set(subject, [...(map.get(subject) || []), note]);
    });
    return Array.from(map.entries());
  }, [isSearching, searchResults]);

  return (
    <aside className="rail">
      <div className="rail-head">
        <div className="rail-brand">
          <span className="rail-logo">
            <Sparkles size={16} />
          </span>
          <strong>LearnAgent</strong>
        </div>
        <div className="rail-new">
          <button className="primary-action compact" type="button" onClick={() => setMenuOpen((open) => !open)}>
            <Plus size={16} />
            新建
          </button>
          {menuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="rail-menu" role="menu">
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onNewBlank();
                  }}
                >
                  <FilePlus2 size={16} />
                  空白笔记
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onNewGenerate();
                  }}
                >
                  <Sparkles size={16} />
                  AI 生成笔记
                </button>
                <button
                  role="menuitem"
                  type="button"
                  disabled={isImporting}
                  onClick={() => {
                    setMenuOpen(false);
                    onImport();
                  }}
                >
                  {isImporting ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
                  导入 Markdown
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rail-search">
        <Search size={15} />
        <input
          value={noteSearch}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索所有笔记"
          aria-label="搜索所有笔记"
        />
        {isSearching && (
          <button className="rail-search-clear" onClick={() => onSearchChange('')} aria-label="清除搜索" title="清除搜索">
            <X size={14} />
          </button>
        )}
      </div>

      <nav className="rail-body">
        {isSearching ? (
          searchGroups.length ? (
            searchGroups.map(([subject, results]) => (
              <section className="rail-search-group" key={subject}>
                <div className="rail-search-group-title">{subject}</div>
                {results.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className={`note-row ${note.id === selectedNoteId ? 'active' : ''}`}
                    onClick={() => onSelectNote(note.id, cleanSubjectName(note.subject))}
                  >
                    <FileText size={14} className="note-row-icon" />
                    <span className="note-row-body">
                      <span className="note-row-title">{note.title || '无标题笔记'}</span>
                      {note.searchExcerpt && <span className="note-row-hit">{note.searchExcerpt}</span>}
                    </span>
                  </button>
                ))}
              </section>
            ))
          ) : (
            <p className="rail-empty">没有匹配「{noteSearch.trim()}」的笔记。</p>
          )
        ) : (
          <>
            {subjects.map((subject) => {
              const expanded = expandedSubjects.has(subject.name);
              const subjectNotes = notesBySubject.get(subject.name) || [];
              const topicGroups = buildTopicGroups(subjectNotes);
              const isRootDrop = dropTarget?.placement === 'root' && dropTarget.subject === subject.name;
              return (
                <section className="rail-subject" key={subject.id}>
                  {editingId === subject.id ? (
                    <form
                      className="subject-rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitRename(subject.id);
                      }}
                    >
                      <input
                        value={editingName}
                        autoFocus
                        onChange={(event) => setEditingName(event.target.value)}
                        aria-label="学科名称"
                      />
                      <button className="icon-button ghost" type="submit" aria-label="保存" title="保存">
                        <Check size={15} />
                      </button>
                      <button
                        className="icon-button ghost"
                        type="button"
                        onClick={() => setEditingId(null)}
                        aria-label="取消"
                        title="取消"
                      >
                        <X size={15} />
                      </button>
                    </form>
                  ) : (
                    <div
                      className={`subject-row ${focusedSubject === subject.name ? 'focused' : ''} ${
                        isRootDrop ? 'drop-inside' : ''
                      }`}
                      onDragOver={(event) => {
                        if (!draggedId) return;
                        event.preventDefault();
                        setDropTarget({ subject: subject.name, noteId: null, placement: 'root' });
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        finishDrop();
                      }}
                    >
                      <button
                        className="subject-toggle"
                        type="button"
                        onClick={() => onToggleSubject(subject.name)}
                        aria-expanded={expanded}
                      >
                        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        <Folder size={15} />
                        <span className="subject-name">{subject.name}</span>
                        <small>{subject.noteCount}</small>
                      </button>
                      <div className="subject-actions">
                        <button
                          className="icon-button ghost"
                          type="button"
                          onClick={() => {
                            setEditingId(subject.id);
                            setEditingName(subject.name);
                          }}
                          aria-label="重命名学科"
                          title="重命名"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="icon-button ghost danger"
                          type="button"
                          onClick={() => onDeleteSubject(subject)}
                          aria-label="删除学科"
                          title="删除学科"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}

                  {expanded && (
                    <div className="subject-tree">
                      {topicGroups.length ? (
                        topicGroups.map((group) => {
                          const isTopicDrop =
                            dropTarget?.placement === 'topic' &&
                            dropTarget.subject === subject.name &&
                            dropTarget.topic === group.topic;
                          return (
                            <div className="topic-group" key={group.topic}>
                              <div
                                className={`topic-row ${isTopicDrop ? 'drop-inside' : ''}`}
                                onDragOver={(event) => {
                                  if (!draggedId) return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setDropTarget({
                                    subject: subject.name,
                                    noteId: null,
                                    placement: 'topic',
                                    topic: group.topic
                                  });
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (draggedId) {
                                    onMoveNote(draggedId, null, 'topic', group.topic, subject.name);
                                    setDraggedId(null);
                                    setDropTarget(null);
                                  }
                                }}
                              >
                                <Folder size={13} />
                                <span>{group.topic}</span>
                                <small>{group.noteCount}</small>
                              </div>
                              <div className="topic-notes">
                                {group.nodes.map((node) => (
                                  <NoteTreeItem
                                    key={node.note.id}
                                    node={node}
                                    depth={0}
                                    subject={subject.name}
                                    selectedNoteId={selectedNoteId}
                                    expandedIds={expandedIds}
                                    draggedId={draggedId}
                                    dropTarget={dropTarget}
                                    onSelectNote={onSelectNote}
                                    onToggleExpanded={toggleExpanded}
                                    onDragStart={setDraggedId}
                                    onDragEnd={() => {
                                      setDraggedId(null);
                                      setDropTarget(null);
                                    }}
                                    onDropTargetChange={setDropTarget}
                                    onFinishDrop={finishDrop}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="subject-empty-note">还没有笔记</p>
                      )}
                    </div>
                  )}
                </section>
              );
            })}

            {creating ? (
              <form
                className="subject-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCreate();
                }}
              >
                <input
                  value={newName}
                  autoFocus
                  onChange={(event) => setNewName(event.target.value)}
                  onBlur={() => !newName.trim() && setCreating(false)}
                  placeholder="学科名称"
                  aria-label="新学科名称"
                />
                <button className="icon-button ghost" type="submit" aria-label="创建" title="创建">
                  <Check size={15} />
                </button>
              </form>
            ) : (
              <button className="subject-add" type="button" onClick={() => setCreating(true)}>
                <Plus size={15} />
                新学科
              </button>
            )}
          </>
        )}
      </nav>

      <div className="rail-foot">
        <button
          className={`rail-foot-btn ${isSettingsOpen ? 'active' : ''}`}
          type="button"
          onClick={onOpenSettings}
        >
          <Settings size={16} />
          设置
        </button>
        <span className={`save-dot ${saveState}`} title={saveStateLabel(saveState)}>
          {saveState === 'saving' ? <Loader2 className="spin" size={13} /> : null}
          {saveStateLabel(saveState)}
        </span>
      </div>
    </aside>
  );
}

function saveStateLabel(state: SaveState) {
  if (state === 'saving') return '保存中';
  if (state === 'saved') return '已保存';
  if (state === 'error') return '保存失败';
  return '已同步';
}

function NoteTreeItem({
  node,
  depth,
  subject,
  selectedNoteId,
  expandedIds,
  draggedId,
  dropTarget,
  onSelectNote,
  onToggleExpanded,
  onDragStart,
  onDragEnd,
  onDropTargetChange,
  onFinishDrop
}: {
  node: NoteTreeNode;
  depth: number;
  subject: string;
  selectedNoteId: string;
  expandedIds: Set<string>;
  draggedId: string | null;
  dropTarget: DropTarget;
  onSelectNote: (noteId: string, subject: string) => void;
  onToggleExpanded: (noteId: string) => void;
  onDragStart: (noteId: string) => void;
  onDragEnd: () => void;
  onDropTargetChange: (target: DropTarget) => void;
  onFinishDrop: () => void;
}) {
  const { note, children } = node;
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(note.id);
  const activeDrop = dropTarget?.noteId === note.id ? dropTarget.placement : null;

  function placementFromEvent(event: DragEvent<HTMLElement>): NoteDropPlacement {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    if (ratio < 0.26) return 'before';
    if (ratio > 0.74) return 'after';
    return 'inside';
  }

  return (
    <div className="note-tree-node">
      <div className={`note-drop-line ${activeDrop === 'before' ? 'active' : ''}`} style={{ marginLeft: `${depth * 14 + 26}px` }} />
      <div
        className={[
          'note-row',
          'tree',
          note.id === selectedNoteId ? 'active' : '',
          draggedId === note.id ? 'dragging' : '',
          activeDrop === 'inside' ? 'drop-inside' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', note.id);
          onDragStart(note.id);
        }}
        onDragEnd={onDragEnd}
        onDragOver={(event) => {
          if (!draggedId || draggedId === note.id) return;
          event.preventDefault();
          event.stopPropagation();
          onDropTargetChange({ subject, noteId: note.id, placement: placementFromEvent(event) });
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onFinishDrop();
        }}
      >
        <button
          className="tree-toggle"
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggleExpanded(note.id);
          }}
          disabled={!hasChildren}
          aria-label={isExpanded ? '折叠' : '展开'}
          type="button"
        >
          {hasChildren ? isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span />}
        </button>
        <button className="note-row-main" onClick={() => onSelectNote(note.id, subject)} type="button">
          <span className="note-row-title">{note.title || '无标题笔记'}</span>
          <span className="note-row-meta">{formatDate(note.updatedAt)}</span>
        </button>
        <GripVertical className="drag-handle" size={14} />
      </div>
      <div className={`note-drop-line ${activeDrop === 'after' ? 'active' : ''}`} style={{ marginLeft: `${depth * 14 + 26}px` }} />

      {hasChildren && isExpanded && (
        <div className="note-tree-children">
          {children.map((child) => (
            <NoteTreeItem
              key={child.note.id}
              node={child}
              depth={depth + 1}
              subject={subject}
              selectedNoteId={selectedNoteId}
              expandedIds={expandedIds}
              draggedId={draggedId}
              dropTarget={dropTarget}
              onSelectNote={onSelectNote}
              onToggleExpanded={onToggleExpanded}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropTargetChange={onDropTargetChange}
              onFinishDrop={onFinishDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}
