import { ArrowLeft, Check, ChevronDown, ChevronRight, Folder, GripVertical, Loader2, Plus, Search, Settings } from 'lucide-react';
import type { DragEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from '../types';
import type { SaveState } from '../hooks/useAutosave';
import { formatDate } from '../services/notes';

type NoteDropPlacement = 'before' | 'inside' | 'after' | 'root' | 'topic';
type DropTarget = { noteId: string | null; placement: NoteDropPlacement; topic?: string } | null;

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
  return [...notes].sort((a, b) => noteSortValue(a) - noteSortValue(b) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
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
    node.children = sortNotes(node.children.map((child) => child.note)).map((childNote) => nodes.get(childNote.id)).filter(Boolean) as NoteTreeNode[];
  });

  return roots;
}

function collectExpandableIds(nodes: NoteTreeNode[]) {
  const ids: string[] = [];
  const visit = (node: NoteTreeNode) => {
    if (node.children.length) ids.push(node.note.id);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return ids;
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
      latestUpdatedAt: topicNotes
        .map((note) => note.updatedAt)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || ''
    }))
    .sort((a, b) => new Date(b.latestUpdatedAt).getTime() - new Date(a.latestUpdatedAt).getTime());
}

export function Sidebar({
  notes,
  filteredNotes,
  selectedSubject,
  selectedNoteId,
  noteSearch,
  saveState,
  onSearchChange,
  onSelectNote,
  onCreateBlankNote,
  onMoveNote,
  onBackToSubjects,
  onOpenSettings
}: {
  notes: Note[];
  filteredNotes: Note[];
  selectedSubject: string;
  selectedNoteId: string;
  noteSearch: string;
  saveState: SaveState;
  onSearchChange: (value: string) => void;
  onSelectNote: (noteId: string) => void;
  onCreateBlankNote: () => void;
  onMoveNote: (draggedId: string, targetId: string | null, placement: NoteDropPlacement, targetTopic?: string) => void;
  onBackToSubjects: () => void;
  onOpenSettings: () => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [expandedTopicIds, setExpandedTopicIds] = useState<Set<string>>(() => new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const knownExpandableIds = useRef<Set<string>>(new Set());
  const knownTopicIds = useRef<Set<string>>(new Set());
  const isSearching = Boolean(noteSearch.trim());
  const topicGroups = useMemo(() => buildTopicGroups(filteredNotes), [filteredNotes]);
  const tree = useMemo(() => topicGroups.flatMap((group) => group.nodes), [topicGroups]);

  useEffect(() => {
    setExpandedIds((current) => {
      const next = new Set(current);
      collectExpandableIds(tree).forEach((id) => {
        if (!knownExpandableIds.current.has(id)) {
          next.add(id);
          knownExpandableIds.current.add(id);
        }
      });
      return next;
    });
  }, [tree]);

  useEffect(() => {
    setExpandedTopicIds((current) => {
      const next = new Set(current);
      topicGroups.forEach((group) => {
        if (!knownTopicIds.current.has(group.topic)) {
          next.add(group.topic);
          knownTopicIds.current.add(group.topic);
        }
      });
      return next;
    });
  }, [topicGroups]);

  function toggleExpanded(noteId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  function toggleTopic(topic: string) {
    setExpandedTopicIds((current) => {
      const next = new Set(current);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  }

  function finishDrop() {
    if (!draggedId || !dropTarget) return;
    onMoveNote(draggedId, dropTarget.noteId, dropTarget.placement, dropTarget.topic);
    if (dropTarget.placement === 'inside' && dropTarget.noteId) {
      setExpandedIds((current) => new Set(current).add(dropTarget.noteId || ''));
    }
    setDraggedId(null);
    setDropTarget(null);
  }

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <button className="icon-button" title="返回学科" aria-label="返回学科" onClick={onBackToSubjects}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1>{selectedSubject}</h1>
          <span>{notes.length} 篇笔记</span>
        </div>
        <button className="icon-button" title="设置" aria-label="设置" onClick={onOpenSettings}>
          <Settings size={18} />
        </button>
      </div>

      <div className="search-box">
        <Search size={16} />
        <input value={noteSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索笔记" />
      </div>

      <button className="primary-wide" onClick={onCreateBlankNote}>
        <Plus size={17} />
        新笔记
      </button>

      <div
        className={`note-list ${dropTarget?.placement === 'root' ? 'drop-root' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (draggedId) setDropTarget({ noteId: null, placement: 'root' });
        }}
        onDrop={(event) => {
          event.preventDefault();
          finishDrop();
        }}
      >
        {topicGroups.map((group) => {
          const isTopicExpanded = expandedTopicIds.has(group.topic) || isSearching;
          const isTopicDrop = dropTarget?.placement === 'topic' && dropTarget.topic === group.topic;
          return (
            <section className="topic-group" key={group.topic}>
              <button
                className={`topic-row ${isTopicDrop ? 'drop-inside' : ''}`}
                type="button"
                onClick={() => toggleTopic(group.topic)}
                onDragOver={(event) => {
                  if (!draggedId) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setDropTarget({ noteId: null, placement: 'topic', topic: group.topic });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (draggedId) {
                    onMoveNote(draggedId, null, 'topic', group.topic);
                    setDraggedId(null);
                    setDropTarget(null);
                  }
                }}
              >
                {isTopicExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <Folder size={15} />
                <span>{group.topic}</span>
                <small>{group.noteCount}</small>
              </button>
              {isTopicExpanded && (
                <div className="topic-note-tree">
                  {group.nodes.map((node) => (
                    <NoteTreeItem
                      key={node.note.id}
                      node={node}
                      depth={0}
                      selectedNoteId={selectedNoteId}
                      expandedIds={expandedIds}
                      draggedId={draggedId}
                      dropTarget={dropTarget}
                      isSearching={isSearching}
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
              )}
            </section>
          );
        })}
        {!filteredNotes.length && <p className="empty-copy">暂无笔记，先输入学习主题生成一篇。</p>}
      </div>

      <div className={`save-status ${saveState === 'error' ? 'error' : ''}`}>
        {saveState === 'saving' && <Loader2 className="spin" size={14} />}
        {saveState === 'saved' && <Check size={14} />}
        <span>
          {saveState === 'saving'
            ? '保存中'
            : saveState === 'saved'
              ? '已保存'
              : saveState === 'error'
                ? '保存失败'
                : '本地存储'}
        </span>
      </div>
    </aside>
  );
}

function NoteTreeItem({
  node,
  depth,
  selectedNoteId,
  expandedIds,
  draggedId,
  dropTarget,
  isSearching,
  onSelectNote,
  onToggleExpanded,
  onDragStart,
  onDragEnd,
  onDropTargetChange,
  onFinishDrop
}: {
  node: NoteTreeNode;
  depth: number;
  selectedNoteId: string;
  expandedIds: Set<string>;
  draggedId: string | null;
  dropTarget: DropTarget;
  isSearching: boolean;
  onSelectNote: (noteId: string) => void;
  onToggleExpanded: (noteId: string) => void;
  onDragStart: (noteId: string) => void;
  onDragEnd: () => void;
  onDropTargetChange: (target: DropTarget) => void;
  onFinishDrop: () => void;
}) {
  const { note, children } = node;
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(note.id) || isSearching;
  const activeDrop = dropTarget?.noteId === note.id ? dropTarget.placement : null;

  function placementFromEvent(event: DragEvent<HTMLElement>): NoteDropPlacement {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    if (ratio < 0.24) return 'before';
    if (ratio > 0.76) return 'after';
    return 'inside';
  }

  return (
    <div className="note-tree-node">
      <div className={`note-drop-line before ${activeDrop === 'before' ? 'active' : ''}`} style={{ marginLeft: `${depth * 14}px` }} />
      <div
        className={[
          'note-tree-row',
          note.id === selectedNoteId ? 'active' : '',
          draggedId === note.id ? 'dragging' : '',
          activeDrop === 'inside' ? 'drop-inside' : ''
        ].filter(Boolean).join(' ')}
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
          onDropTargetChange({ noteId: note.id, placement: placementFromEvent(event) });
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
          aria-label={isExpanded ? '折叠笔记组' : '展开笔记组'}
          title={isExpanded ? '折叠' : '展开'}
          type="button"
        >
          {hasChildren ? (isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : <span />}
        </button>
        <button className="note-list-item" onClick={() => onSelectNote(note.id)} type="button">
          <span className="note-title">{note.title}</span>
          <span className="note-meta">
            {note.subject} · {formatDate(note.updatedAt)}
          </span>
          {note.searchExcerpt && (
            <span className="note-search-hit">
              {note.searchSection ? `${note.searchSection} · ` : ''}
              {note.searchExcerpt}
            </span>
          )}
        </button>
        <GripVertical className="drag-handle" size={15} />
      </div>
      <div className={`note-drop-line after ${activeDrop === 'after' ? 'active' : ''}`} style={{ marginLeft: `${depth * 14}px` }} />

      {hasChildren && isExpanded && (
        <div className="note-tree-children">
          {children.map((child) => (
            <NoteTreeItem
              key={child.note.id}
              node={child}
              depth={depth + 1}
              selectedNoteId={selectedNoteId}
              expandedIds={expandedIds}
              draggedId={draggedId}
              dropTarget={dropTarget}
              isSearching={isSearching}
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
