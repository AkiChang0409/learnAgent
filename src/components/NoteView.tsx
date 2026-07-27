import { lazy, Suspense } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Loader2, Plus, ScanText, Sparkles, Trash2, X } from 'lucide-react';
import type { Note, NoteSection } from '../types';
import { AutoTextarea } from './AutoTextarea';

const RichTextEditor = lazy(() => import('./RichTextEditor').then((module) => ({ default: module.RichTextEditor })));

function RichEditorFallback({ text }: { text: string }) {
  return <div className="rich-editor-loading">{text}</div>;
}

export type ListField = 'cases' | 'pitfalls' | 'interviewQuestions';

const INSIGHT_FIELDS: Array<{ field: ListField; title: string; placeholder: string }> = [
  { field: 'cases', title: '案例', placeholder: '记录一个具体例子…' },
  { field: 'pitfalls', title: '易错点', placeholder: '容易踩的坑…' },
  { field: 'interviewQuestions', title: '面试问题', placeholder: '可能被问到的问题…' }
];

export function NoteView({
  note,
  subjectOptions,
  assistantOpen,
  conversationCount,
  onChange,
  onDelete,
  onAddSection,
  onUpdateSection,
  onRemoveSection,
  onMoveSection,
  onUpdateList,
  onToggleAssistant,
  onNavigateSubject,
  onAnalyzeEmphasis,
  isAnalyzingEmphasis,
  subjectNoteCount
}: {
  note: Note;
  subjectOptions: string[];
  assistantOpen: boolean;
  conversationCount: number;
  onChange: (patch: Partial<Note>) => void;
  onDelete: () => void;
  onAddSection: () => void;
  onUpdateSection: (sectionId: string, patch: Partial<NoteSection>) => void;
  onRemoveSection: (sectionId: string) => void;
  onMoveSection: (sectionId: string, direction: -1 | 1) => void;
  onUpdateList: (field: ListField, values: string[]) => void;
  onToggleAssistant: () => void;
  onNavigateSubject: (subject: string) => void;
  onAnalyzeEmphasis: () => void;
  isAnalyzingEmphasis: boolean;
  subjectNoteCount: number;
}) {
  return (
    <article className="note-view">
      <header className="note-topbar">
        <nav className="crumbs" aria-label="位置">
          <button type="button" className="crumb-link" onClick={() => onNavigateSubject(note.subject)}>
            {note.subject}
          </button>
          <ChevronRight size={14} />
          <span className="crumb-current">{note.topic?.trim() || '未命名主题'}</span>
        </nav>
        <div className="note-topbar-actions">
          <button
            type="button"
            className="assistant-toggle emphasis-analyze-button"
            onClick={onAnalyzeEmphasis}
            disabled={isAnalyzingEmphasis}
            title={`分析“${note.subject}”下的 ${subjectNoteCount} 篇笔记，只添加重点样式，不改写正文`}
          >
            {isAnalyzingEmphasis ? <Loader2 className="spin" size={16} /> : <ScanText size={16} />}
            {isAnalyzingEmphasis ? '分析中' : '分析重点'}
          </button>
          <button
            type="button"
            className={`assistant-toggle ${assistantOpen ? 'active' : ''}`}
            onClick={onToggleAssistant}
            aria-pressed={assistantOpen}
            title="围绕这篇笔记向 AI 提问"
          >
            <Sparkles size={16} />
            问 AI
            {conversationCount > 0 && <span className="assistant-count">{conversationCount}</span>}
          </button>
          <button className="icon-button danger" onClick={onDelete} title="删除笔记" aria-label="删除笔记">
            <Trash2 size={17} />
          </button>
        </div>
      </header>

      <div className="doc" key={note.id}>
        <AutoTextarea
          className="doc-title"
          value={note.title}
          onChange={(value) => onChange({ title: value })}
          placeholder="无标题笔记"
          ariaLabel="笔记标题"
        />

        <div className="doc-meta">
          <select
            className="meta-subject"
            value={note.subject}
            onChange={(event) => onChange({ subject: event.target.value })}
            aria-label="学科"
          >
            {subjectOptions.map((subject) => (
              <option key={subject} value={subject}>
                {subject}
              </option>
            ))}
          </select>
          <span className="meta-sep">·</span>
          <input
            className="meta-topic"
            value={note.topic}
            onChange={(event) => onChange({ topic: event.target.value })}
            placeholder="未命名主题"
            aria-label="主题"
          />
          <input
            className="meta-tags"
            value={note.tags.join(' ')}
            onChange={(event) =>
              onChange({
                tags: event.target.value
                  .split(/[\s，,、]+/)
                  .map((tag) => tag.trim())
                  .filter(Boolean)
              })
            }
            placeholder="# 标签（空格分隔）"
            aria-label="标签"
          />
        </div>

        <section className="doc-summary">
          <span className="doc-label">知识总结</span>
          <Suspense fallback={<RichEditorFallback text={note.summary} />}>
            <RichTextEditor
              value={note.summaryRich}
              fallbackText={note.summary}
              allowTables={false}
              onChange={(summaryRich, summary) => onChange({ summary, summaryRich })}
              placeholder="一句话概括这页笔记的核心…"
              ariaLabel="知识总结"
            />
          </Suspense>
        </section>

        <div className="doc-sections">
          {note.sections.map((section, index) => (
            <section className="doc-section" key={section.id}>
              <div className="doc-section-head">
                <AutoTextarea
                  className="doc-h2"
                  value={section.heading}
                  onChange={(value) => onUpdateSection(section.id, { heading: value })}
                  placeholder="小节标题"
                  ariaLabel="小节标题"
                />
                <div className="doc-section-tools">
                  <button
                    className="icon-button ghost"
                    onClick={() => onMoveSection(section.id, -1)}
                    disabled={index === 0}
                    aria-label="上移小节"
                    title="上移"
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="icon-button ghost"
                    onClick={() => onMoveSection(section.id, 1)}
                    disabled={index === note.sections.length - 1}
                    aria-label="下移小节"
                    title="下移"
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    className="icon-button ghost danger"
                    onClick={() => onRemoveSection(section.id)}
                    aria-label="删除小节"
                    title="删除小节"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
              <Suspense fallback={<RichEditorFallback text={section.content} />}>
                <RichTextEditor
                  value={section.contentRich}
                  fallbackText={section.content}
                  onChange={(contentRich, content) => onUpdateSection(section.id, { content, contentRich })}
                  placeholder="开始写这一节…"
                  ariaLabel="小节正文"
                />
              </Suspense>
            </section>
          ))}
        </div>

        <button className="add-block" onClick={onAddSection} type="button">
          <Plus size={16} />
          添加小节
        </button>

        <div className="doc-insights">
          {INSIGHT_FIELDS.map(({ field, title, placeholder }) => (
            <InlineList
              key={field}
              title={title}
              placeholder={placeholder}
              values={note[field]}
              onChange={(values) => onUpdateList(field, values)}
            />
          ))}
        </div>
      </div>
    </article>
  );
}

function InlineList({
  title,
  values,
  placeholder,
  onChange
}: {
  title: string;
  values: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  return (
    <section className="inline-list">
      <div className="inline-list-head">
        <span className="doc-label">{title}</span>
        <button
          className="icon-button ghost"
          onClick={() => onChange([...values, ''])}
          title={`添加${title}`}
          aria-label={`添加${title}`}
        >
          <Plus size={15} />
        </button>
      </div>
      {values.length ? (
        <ul className="inline-list-items">
          {values.map((value, index) => (
            <li key={`${title}-${index}`}>
              <AutoTextarea
                className="inline-item-input"
                value={value}
                onChange={(next) => {
                  const copy = [...values];
                  copy[index] = next;
                  onChange(copy);
                }}
                placeholder={placeholder}
                ariaLabel={`${title} ${index + 1}`}
              />
              <button
                className="icon-button ghost danger"
                onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
                aria-label="删除"
                title="删除"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <button className="inline-list-empty" onClick={() => onChange([''])} type="button">
          <Plus size={14} />
          {placeholder}
        </button>
      )}
    </section>
  );
}
