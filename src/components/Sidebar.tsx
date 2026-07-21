import { Check, Loader2, Plus, Search, Settings } from 'lucide-react';
import type { Note } from '../types';
import type { SaveState } from '../hooks/useAutosave';
import { formatDate } from '../services/notes';

export function Sidebar({
  notes,
  filteredNotes,
  selectedNoteId,
  noteSearch,
  saveState,
  onSearchChange,
  onSelectNote,
  onCreateBlankNote,
  onOpenSettings
}: {
  notes: Note[];
  filteredNotes: Note[];
  selectedNoteId: string;
  noteSearch: string;
  saveState: SaveState;
  onSearchChange: (value: string) => void;
  onSelectNote: (noteId: string) => void;
  onCreateBlankNote: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div>
          <h1>LearnAgent</h1>
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

      <div className="note-list">
        {filteredNotes.map((note) => (
          <button
            key={note.id}
            className={`note-list-item ${note.id === selectedNoteId ? 'active' : ''}`}
            onClick={() => onSelectNote(note.id)}
          >
            <span className="note-title">{note.title}</span>
            <span className="note-meta">
              {note.subject} · {formatDate(note.updatedAt)}
            </span>
          </button>
        ))}
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
