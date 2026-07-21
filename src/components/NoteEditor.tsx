import { ArrowDown, ArrowUp, FileText, Plus, Trash2 } from 'lucide-react';
import type { Note, NoteSection } from '../types';

export type ListField = 'cases' | 'pitfalls' | 'interviewQuestions';

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
        <button className="icon-button danger" onClick={onDelete} title="删除笔记" aria-label="删除笔记">
          <Trash2 size={17} />
        </button>
      </div>

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
    </article>
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
