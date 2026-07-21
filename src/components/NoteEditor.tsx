import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Edit3, Eye, FileText, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { Note, NoteSection } from '../types';

export type ListField = 'cases' | 'pitfalls' | 'interviewQuestions';
type NoteMode = 'read' | 'write' | 'structure';

export function NoteEditor({
  note,
  onChange,
  onDelete,
  onAddSection,
  onUpdateSection,
  onRemoveSection,
  onMoveSection,
  onUpdateList
}: {
  note: Note | null;
  onChange: (patch: Partial<Note>) => void;
  onDelete: () => void;
  onAddSection: () => void;
  onUpdateSection: (sectionId: string, patch: Partial<NoteSection>) => void;
  onRemoveSection: (sectionId: string) => void;
  onMoveSection: (sectionId: string, direction: -1 | 1) => void;
  onUpdateList: (field: ListField, values: string[]) => void;
}) {
  const [mode, setMode] = useState<NoteMode>('read');

  useEffect(() => {
    setMode('read');
  }, [note?.id]);

  if (!note) {
    return (
      <section className="empty-note">
        <FileText size={34} />
        <h2>还没有笔记</h2>
        <p>输入今天学习的主题，生成第一篇知识总结。</p>
      </section>
    );
  }

  return (
    <article className="note-page">
      <div className="note-toolbar">
        <div className="subject-pill">{note.subject}</div>
        <div className="note-toolbar-actions">
          <div className="mode-switch" aria-label="笔记模式">
            <button className={mode === 'read' ? 'active' : ''} onClick={() => setMode('read')} title="阅读" aria-label="阅读">
              <Eye size={16} />
              阅读
            </button>
            <button className={mode === 'write' ? 'active' : ''} onClick={() => setMode('write')} title="写作" aria-label="写作">
              <Edit3 size={16} />
              写作
            </button>
            <button className={mode === 'structure' ? 'active' : ''} onClick={() => setMode('structure')} title="结构" aria-label="结构">
              <SlidersHorizontal size={16} />
              结构
            </button>
          </div>
          <button className="icon-button danger" onClick={onDelete} title="删除笔记" aria-label="删除笔记">
            <Trash2 size={17} />
          </button>
        </div>
      </div>

      {mode === 'read' && <ReadView note={note} />}
      {mode === 'write' && (
        <WritingView
          note={note}
          onChange={onChange}
          onAddSection={onAddSection}
          onUpdateSection={onUpdateSection}
        />
      )}
      {mode === 'structure' && (
        <StructureView
          note={note}
          onChange={onChange}
          onAddSection={onAddSection}
          onUpdateSection={onUpdateSection}
          onRemoveSection={onRemoveSection}
          onMoveSection={onMoveSection}
          onUpdateList={onUpdateList}
        />
      )}
    </article>
  );
}

function ReadView({ note }: { note: Note }) {
  return (
    <div className="note-reader">
      <header className="reader-header">
        <h1>{note.title}</h1>
        <div className="reader-meta">
          <span>{note.subject}</span>
          <span>{note.topic}</span>
        </div>
        {note.tags.length ? (
          <div className="tag-row">
            {note.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
      </header>

      {note.summary && (
        <section className="summary-block">
          <span>知识总结</span>
          {splitParagraphs(note.summary).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </section>
      )}

      <div className="reader-sections">
        {note.sections.map((section) => (
          <section key={section.id} className="reader-section">
            <h2>{section.heading}</h2>
            {splitParagraphs(section.content).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </section>
        ))}
      </div>

      <div className="reader-insights">
        <ReadList title="案例" values={note.cases} />
        <ReadList title="易错" values={note.pitfalls} />
        <ReadList title="面试问题" values={note.interviewQuestions} />
      </div>
    </div>
  );
}

function ReadList({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {values.map((value, index) => (
          <li key={`${title}-${index}`}>{value}</li>
        ))}
      </ul>
    </section>
  );
}

function WritingView({
  note,
  onChange,
  onAddSection,
  onUpdateSection
}: {
  note: Note;
  onChange: (patch: Partial<Note>) => void;
  onAddSection: () => void;
  onUpdateSection: (sectionId: string, patch: Partial<NoteSection>) => void;
}) {
  return (
    <div className="writing-view">
      <input className="title-input writing-title" value={note.title} onChange={(event) => onChange({ title: event.target.value })} />
      <div className="writing-meta">
        <input value={note.subject} onChange={(event) => onChange({ subject: event.target.value })} placeholder="学科" />
        <input value={note.topic} onChange={(event) => onChange({ topic: event.target.value })} placeholder="主题" />
      </div>
      <input
        className="tag-input-soft"
        value={note.tags.join('，')}
        onChange={(event) =>
          onChange({
            tags: event.target.value
              .split(/[，,、]/)
              .map((tag) => tag.trim())
              .filter(Boolean)
          })
        }
        placeholder="标签，用逗号分隔"
      />
      <textarea
        className="summary-editor"
        value={note.summary}
        onChange={(event) => onChange({ summary: event.target.value })}
        placeholder="写下这一页笔记的核心总结"
      />

      <div className="section-heading writing-heading">
        <h3>正文</h3>
        <button className="secondary-action" onClick={onAddSection}>
          <Plus size={16} />
          小节
        </button>
      </div>

      <div className="writing-sections">
        {note.sections.map((section) => (
          <section className="writing-section" key={section.id}>
            <input value={section.heading} onChange={(event) => onUpdateSection(section.id, { heading: event.target.value })} />
            <textarea value={section.content} onChange={(event) => onUpdateSection(section.id, { content: event.target.value })} />
          </section>
        ))}
      </div>
    </div>
  );
}

function StructureView({
  note,
  onChange,
  onAddSection,
  onUpdateSection,
  onRemoveSection,
  onMoveSection,
  onUpdateList
}: {
  note: Note;
  onChange: (patch: Partial<Note>) => void;
  onAddSection: () => void;
  onUpdateSection: (sectionId: string, patch: Partial<NoteSection>) => void;
  onRemoveSection: (sectionId: string) => void;
  onMoveSection: (sectionId: string, direction: -1 | 1) => void;
  onUpdateList: (field: ListField, values: string[]) => void;
}) {
  return (
    <div className="structure-view">
      <input className="title-input" value={note.title} onChange={(event) => onChange({ title: event.target.value })} />

      <div className="field-grid">
        <label>
          <span>学科</span>
          <input value={note.subject} onChange={(event) => onChange({ subject: event.target.value })} />
        </label>
        <label>
          <span>主题</span>
          <input value={note.topic} onChange={(event) => onChange({ topic: event.target.value })} />
        </label>
      </div>

      <label className="full-field">
        <span>标签</span>
        <input
          value={note.tags.join('，')}
          onChange={(event) =>
            onChange({
              tags: event.target.value
                .split(/[，,、]/)
                .map((tag) => tag.trim())
                .filter(Boolean)
            })
          }
        />
      </label>

      <label className="full-field">
        <span>知识总结</span>
        <textarea value={note.summary} onChange={(event) => onChange({ summary: event.target.value })} />
      </label>

      <div className="section-heading">
        <h3>主题编排</h3>
        <button className="secondary-action" onClick={onAddSection}>
          <Plus size={16} />
          小节
        </button>
      </div>

      <div className="sections">
        {note.sections.map((section, index) => (
          <section className="note-section" key={section.id}>
            <div className="section-controls">
              <input value={section.heading} onChange={(event) => onUpdateSection(section.id, { heading: event.target.value })} />
              <button className="icon-button" onClick={() => onMoveSection(section.id, -1)} disabled={index === 0} aria-label="上移小节" title="上移小节">
                <ArrowUp size={16} />
              </button>
              <button className="icon-button" onClick={() => onMoveSection(section.id, 1)} disabled={index === note.sections.length - 1} aria-label="下移小节" title="下移小节">
                <ArrowDown size={16} />
              </button>
              <button className="icon-button danger" onClick={() => onRemoveSection(section.id)} aria-label="删除小节" title="删除小节">
                <Trash2 size={16} />
              </button>
            </div>
            <textarea value={section.content} onChange={(event) => onUpdateSection(section.id, { content: event.target.value })} />
          </section>
        ))}
      </div>

      <div className="insight-grid">
        <EditableList title="案例" values={note.cases} onChange={(values) => onUpdateList('cases', values)} placeholder="添加案例" />
        <EditableList title="易错" values={note.pitfalls} onChange={(values) => onUpdateList('pitfalls', values)} placeholder="添加易错点" />
        <EditableList
          title="面试问题"
          values={note.interviewQuestions}
          onChange={(values) => onUpdateList('interviewQuestions', values)}
          placeholder="添加问题"
        />
      </div>
    </div>
  );
}

function EditableList({
  title,
  values,
  onChange,
  placeholder
}: {
  title: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  return (
    <section className="list-editor">
      <div className="section-heading compact-heading">
        <h3>{title}</h3>
        <button className="icon-button" onClick={() => onChange([...values, ''])} title={placeholder} aria-label={placeholder}>
          <Plus size={16} />
        </button>
      </div>
      {values.map((value, index) => (
        <div className="list-row" key={`${title}-${index}`}>
          <textarea
            value={value}
            onChange={(event) => {
              const next = [...values];
              next[index] = event.target.value;
              onChange(next);
            }}
            placeholder={placeholder}
          />
          <button className="icon-button danger" onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))} title="删除" aria-label="删除">
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {!values.length && <p className="empty-copy">暂无内容</p>}
    </section>
  );
}

function splitParagraphs(value: string) {
  return value
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}
