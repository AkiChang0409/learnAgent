import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  FileText,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Plus,
  Save,
  Search,
  Settings,
  Trash2
} from 'lucide-react';
import type { AiProvider, AppData, ChatMessage, Note, NoteSection } from './types';
import { retrieveContext } from './services/rag';
import { createId, draftToNote, emptyData, formatDate, nowIso } from './services/notes';

type ListField = 'cases' | 'pitfalls' | 'interviewQuestions';

export default function App() {
  const [data, setData] = useState<AppData>(emptyData);
  const [selectedNoteId, setSelectedNoteId] = useState<string>('');
  const [composer, setComposer] = useState('');
  const [noteSearch, setNoteSearch] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [dataPath, setDataPath] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const recognitionRef = useRef<import('./types').SpeechRecognition | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([window.learnAgent.loadData(), window.learnAgent.getDataFilePath()])
      .then(([loaded, filePath]) => {
        if (!mounted) return;
        const merged = {
          ...emptyData,
          ...loaded,
          settings: { ...emptyData.settings, ...loaded.settings }
        };
        setData(merged);
        setSelectedNoteId(merged.notes[0]?.id || '');
        setDataPath(filePath);
        setIsReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        setData(emptyData);
        setIsReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isReady) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setSaveState('saving');
      window.learnAgent.saveData(data).then(() => {
        setSaveState('saved');
        window.setTimeout(() => setSaveState('idle'), 1400);
      });
    }, 450);
    return () => window.clearTimeout(saveTimer.current);
  }, [data, isReady]);

  const selectedNote = useMemo(
    () => data.notes.find((note) => note.id === selectedNoteId) || null,
    [data.notes, selectedNoteId]
  );

  const selectedConversation = useMemo(
    () => data.conversations.find((conversation) => conversation.noteId === selectedNoteId) || null,
    [data.conversations, selectedNoteId]
  );

  const filteredNotes = useMemo(() => {
    const query = noteSearch.trim().toLowerCase();
    if (!query) return data.notes;
    return data.notes.filter((note) =>
      [note.title, note.subject, note.topic, note.summary, note.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [data.notes, noteSearch]);

  function updateSelectedNote(mutator: (note: Note) => Note) {
    if (!selectedNoteId) return;
    setData((current) => ({
      ...current,
      notes: current.notes.map((note) =>
        note.id === selectedNoteId ? { ...mutator(note), updatedAt: nowIso() } : note
      )
    }));
  }

  async function generateNote() {
    const input = composer.trim();
    if (!input || isGenerating) return;
    setIsGenerating(true);
    try {
      const draft = await window.learnAgent.generateNote({ input, settings: data.settings });
      const note = draftToNote(draft);
      const conversation = {
        id: createId('conversation'),
        noteId: note.id,
        title: note.title,
        messages: [],
        updatedAt: nowIso()
      };
      setData((current) => ({
        ...current,
        notes: [note, ...current.notes],
        conversations: [conversation, ...current.conversations]
      }));
      setSelectedNoteId(note.id);
      setComposer('');
    } finally {
      setIsGenerating(false);
    }
  }

  function createBlankNote() {
    const now = nowIso();
    const note: Note = {
      id: createId('note'),
      title: '新学习笔记',
      subject: '通用学习',
      topic: '未命名主题',
      tags: [],
      summary: '',
      sections: [{ id: createId('section'), heading: '核心知识点', content: '' }],
      cases: [],
      pitfalls: [],
      interviewQuestions: [],
      createdAt: now,
      updatedAt: now
    };
    setData((current) => ({
      ...current,
      notes: [note, ...current.notes],
      conversations: [
        { id: createId('conversation'), noteId: note.id, title: note.title, messages: [], updatedAt: now },
        ...current.conversations
      ]
    }));
    setSelectedNoteId(note.id);
  }

  function deleteSelectedNote() {
    if (!selectedNote) return;
    const remaining = data.notes.filter((note) => note.id !== selectedNote.id);
    setData((current) => ({
      ...current,
      notes: current.notes.filter((note) => note.id !== selectedNote.id),
      conversations: current.conversations.filter((conversation) => conversation.noteId !== selectedNote.id)
    }));
    setSelectedNoteId(remaining[0]?.id || '');
  }

  function updateSection(sectionId: string, patch: Partial<NoteSection>) {
    updateSelectedNote((note) => ({
      ...note,
      sections: note.sections.map((section) =>
        section.id === sectionId ? { ...section, ...patch } : section
      )
    }));
  }

  function addSection() {
    updateSelectedNote((note) => ({
      ...note,
      sections: [...note.sections, { id: createId('section'), heading: '新小节', content: '' }]
    }));
  }

  function removeSection(sectionId: string) {
    updateSelectedNote((note) => ({
      ...note,
      sections: note.sections.filter((section) => section.id !== sectionId)
    }));
  }

  function moveSection(sectionId: string, direction: -1 | 1) {
    updateSelectedNote((note) => {
      const index = note.sections.findIndex((section) => section.id === sectionId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= note.sections.length) return note;
      const sections = [...note.sections];
      const [section] = sections.splice(index, 1);
      sections.splice(nextIndex, 0, section);
      return { ...note, sections };
    });
  }

  function updateList(field: ListField, values: string[]) {
    updateSelectedNote((note) => ({ ...note, [field]: values }));
  }

  function updateConversationMessages(noteId: string, updater: (messages: ChatMessage[]) => ChatMessage[]) {
    setData((current) => {
      const existing = current.conversations.find((conversation) => conversation.noteId === noteId);
      if (!existing) {
        return {
          ...current,
          conversations: [
            {
              id: createId('conversation'),
              noteId,
              title: selectedNote?.title || '学习对话',
              messages: updater([]),
              updatedAt: nowIso()
            },
            ...current.conversations
          ]
        };
      }
      return {
        ...current,
        conversations: current.conversations.map((conversation) =>
          conversation.noteId === noteId
            ? { ...conversation, messages: updater(conversation.messages), updatedAt: nowIso() }
            : conversation
        )
      };
    });
  }

  async function askBot() {
    if (!selectedNote || !chatInput.trim() || isAsking) return;
    const question = chatInput.trim();
    const { context, sources } = retrieveContext(question, selectedNote, data.notes);
    const userMessage: ChatMessage = {
      id: createId('message'),
      role: 'user',
      content: question,
      createdAt: nowIso()
    };
    const history = selectedConversation?.messages || [];
    updateConversationMessages(selectedNote.id, (messages) => [...messages, userMessage]);
    setChatInput('');
    setIsAsking(true);
    try {
      const answer = await window.learnAgent.chatWithNote({
        question,
        note: selectedNote,
        context,
        sources,
        history,
        settings: data.settings
      });
      const assistantMessage: ChatMessage = {
        id: createId('message'),
        role: 'assistant',
        content: answer,
        createdAt: nowIso(),
        sources
      };
      updateConversationMessages(selectedNote.id, (messages) => [...messages, assistantMessage]);
    } finally {
      setIsAsking(false);
    }
  }

  function toggleListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError('当前运行环境不支持语音识别');
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => {
      setVoiceError('');
      setIsListening(true);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = (event) => {
      setVoiceError(event.error || '语音识别失败');
      setIsListening(false);
    };
    recognition.onresult = (event) => {
      let finalText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
      }
      if (finalText) {
        setComposer((current) => `${current}${current ? ' ' : ''}${finalText}`.trim());
      }
    };
    recognition.start();
  }

  if (!isReady) {
    return (
      <main className="loading-screen">
        <Loader2 className="spin" size={24} />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div>
            <h1>LearnAgent</h1>
            <span>{data.notes.length} 篇笔记</span>
          </div>
          <button className="icon-button" title="设置" aria-label="设置" onClick={() => setShowSettings(true)}>
            <Settings size={18} />
          </button>
        </div>

        <div className="search-box">
          <Search size={16} />
          <input value={noteSearch} onChange={(event) => setNoteSearch(event.target.value)} placeholder="搜索笔记" />
        </div>

        <button className="primary-wide" onClick={createBlankNote}>
          <Plus size={17} />
          新笔记
        </button>

        <div className="note-list">
          {filteredNotes.map((note) => (
            <button
              key={note.id}
              className={`note-list-item ${note.id === selectedNoteId ? 'active' : ''}`}
              onClick={() => setSelectedNoteId(note.id)}
            >
              <span className="note-title">{note.title}</span>
              <span className="note-meta">
                {note.subject} · {formatDate(note.updatedAt)}
              </span>
            </button>
          ))}
          {!filteredNotes.length && <p className="empty-copy">暂无笔记</p>}
        </div>

        <div className="save-status">
          {saveState === 'saving' && <Loader2 className="spin" size={14} />}
          {saveState === 'saved' && <Check size={14} />}
          <span>{saveState === 'saving' ? '保存中' : saveState === 'saved' ? '已保存' : '本地存储'}</span>
        </div>
      </aside>

      <section className="workspace">
        <section className="composer-panel">
          <textarea
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            placeholder="输入今天学习的主题，例如：今天学了操作系统里的虚拟内存和页面置换算法"
          />
          <div className="composer-actions">
            <button className={`icon-button ${isListening ? 'danger' : ''}`} title="语音输入" aria-label="语音输入" onClick={toggleListening}>
              {isListening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            {voiceError && <span className="voice-error">{voiceError}</span>}
            <button className="primary-action" onClick={generateNote} disabled={!composer.trim() || isGenerating}>
              {isGenerating ? <Loader2 className="spin" size={18} /> : <FileText size={18} />}
              生成知识总结
            </button>
          </div>
        </section>

        {selectedNote ? (
          <NoteEditor
            note={selectedNote}
            onChange={(patch) => updateSelectedNote((note) => ({ ...note, ...patch }))}
            onDelete={deleteSelectedNote}
            onAddSection={addSection}
            onUpdateSection={updateSection}
            onRemoveSection={removeSection}
            onMoveSection={moveSection}
            onUpdateList={updateList}
          />
        ) : (
          <section className="empty-note">
            <FileText size={34} />
            <h2>还没有笔记</h2>
          </section>
        )}
      </section>

      <aside className="chat-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">RAG Bot</span>
            <h2>当前笔记对话</h2>
          </div>
          <Bot size={22} />
        </div>

        <div className="message-list">
          {(selectedConversation?.messages || []).map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <div className="message-content">{message.content}</div>
              {message.sources?.length ? (
                <details>
                  <summary>引用片段</summary>
                  {message.sources.slice(0, 3).map((source) => (
                    <p key={`${source.noteId}-${source.section}-${source.score}`}>
                      {source.title} / {source.section}: {source.excerpt}
                    </p>
                  ))}
                </details>
              ) : null}
            </article>
          ))}
          {isAsking && (
            <article className="message assistant pending">
              <Loader2 className="spin" size={16} />
              <span>思考中</span>
            </article>
          )}
          {!selectedConversation?.messages.length && (
            <div className="chat-empty">
              <MessageSquare size={28} />
            </div>
          )}
        </div>

        <div className="chat-input">
          <textarea
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                askBot();
              }
            }}
            placeholder="问当前笔记"
            disabled={!selectedNote}
          />
          <button className="primary-action compact" onClick={askBot} disabled={!selectedNote || !chatInput.trim() || isAsking}>
            <MessageSquare size={17} />
            发送
          </button>
        </div>
      </aside>

      {showSettings && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowSettings(false)}>
          <section className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Settings</span>
                <h2>模型与存储</h2>
              </div>
              <button className="icon-button" onClick={() => setShowSettings(false)} aria-label="关闭设置" title="关闭设置">
                <Check size={18} />
              </button>
            </div>

            <label>
              <span>AI Provider</span>
              <select
                value={data.settings.provider}
                onChange={(event) =>
                  setData((current) => ({
                    ...current,
                    settings: { ...current.settings, provider: event.target.value as AiProvider }
                  }))
                }
              >
                <option value="local">Local fallback</option>
                <option value="openai-compatible">OpenAI-compatible</option>
                <option value="ollama">Ollama</option>
              </select>
            </label>

            <label>
              <span>Endpoint</span>
              <input
                value={data.settings.endpoint}
                onChange={(event) =>
                  setData((current) => ({
                    ...current,
                    settings: { ...current.settings, endpoint: event.target.value }
                  }))
                }
              />
            </label>

            <label>
              <span>Model</span>
              <input
                value={data.settings.model}
                onChange={(event) =>
                  setData((current) => ({
                    ...current,
                    settings: { ...current.settings, model: event.target.value }
                  }))
                }
              />
            </label>

            <label>
              <span>API Key</span>
              <input
                type="password"
                value={data.settings.apiKey}
                onChange={(event) =>
                  setData((current) => ({
                    ...current,
                    settings: { ...current.settings, apiKey: event.target.value }
                  }))
                }
              />
            </label>

            <div className="data-path">
              <Save size={16} />
              <span>{dataPath}</span>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function NoteEditor({
  note,
  onChange,
  onDelete,
  onAddSection,
  onUpdateSection,
  onRemoveSection,
  onMoveSection,
  onUpdateList
}: {
  note: Note;
  onChange: (patch: Partial<Note>) => void;
  onDelete: () => void;
  onAddSection: () => void;
  onUpdateSection: (sectionId: string, patch: Partial<NoteSection>) => void;
  onRemoveSection: (sectionId: string) => void;
  onMoveSection: (sectionId: string, direction: -1 | 1) => void;
  onUpdateList: (field: ListField, values: string[]) => void;
}) {
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
