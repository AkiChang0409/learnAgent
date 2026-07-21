import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { AiSettings, ChatMessage, Note, NoteSection } from './types';
import { ChatPanel } from './components/ChatPanel';
import { ComposerPanel } from './components/ComposerPanel';
import { NoteEditor, type ListField } from './components/NoteEditor';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { ToastHost, type ToastMessage } from './components/ToastHost';
import { useAppData } from './hooks/useAppData';
import { useAutosave } from './hooks/useAutosave';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { createId, draftToNote, nowIso } from './services/notes';
import { retrieveContext } from './services/rag';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

export default function App() {
  const { data, setData, selectedNoteId, setSelectedNoteId, dataPath, isReady, loadError } = useAppData();
  const [composer, setComposer] = useState('');
  const [noteSearch, setNoteSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Note[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback((type: ToastMessage['type'], message: string) => {
    const id = createId('toast');
    setToasts((current) => [...current, { id, type, message }].slice(-4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5200);
  }, []);

  useEffect(() => {
    if (loadError) pushToast('error', loadError);
  }, [loadError, pushToast]);

  const saveState = useAutosave(data, isReady, (message) => pushToast('error', message));

  const { isListening, voiceError, toggleListening } = useSpeechRecognition((text) => {
    setComposer((current) => `${current}${current ? ' ' : ''}${text}`.trim());
  });

  const selectedNote = useMemo(
    () => data.notes.find((note) => note.id === selectedNoteId) || null,
    [data.notes, selectedNoteId]
  );

  const selectedConversation = useMemo(
    () => data.conversations.find((conversation) => conversation.noteId === selectedNoteId) || null,
    [data.conversations, selectedNoteId]
  );

  useEffect(() => {
    const query = noteSearch.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }

    const timer = window.setTimeout(() => {
      window.learnAgent
        .searchNotes(query)
        .then(setSearchResults)
        .catch((error) => {
          pushToast('error', `搜索失败，已使用本地过滤：${errorMessage(error)}`);
          const fallback = data.notes.filter((note) =>
            [note.title, note.subject, note.topic, note.summary, note.tags.join(' ')]
              .join(' ')
              .toLowerCase()
              .includes(query.toLowerCase())
          );
          setSearchResults(fallback);
        });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [data.notes, noteSearch, pushToast]);

  const filteredNotes = useMemo(() => {
    const query = noteSearch.trim().toLowerCase();
    if (!query) return data.notes;
    return searchResults;
  }, [data.notes, noteSearch, searchResults]);

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
      const result = await window.learnAgent.generateNote({ input, settings: data.settings });
      const note = draftToNote(result.draft);
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
      pushToast(result.usedFallback ? 'info' : 'success', result.message || '已生成知识总结');
    } catch (error) {
      pushToast('error', `生成失败：${errorMessage(error)}`);
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
    pushToast('success', '已创建空白笔记');
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
    pushToast('info', '笔记已删除');
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
      const result = await window.learnAgent.chatWithNote({
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
        content: result.content,
        createdAt: nowIso(),
        sources
      };
      updateConversationMessages(selectedNote.id, (messages) => [...messages, assistantMessage]);
      if (result.usedFallback) pushToast('info', result.message);
    } catch (error) {
      pushToast('error', `对话失败：${errorMessage(error)}`);
    } finally {
      setIsAsking(false);
    }
  }

  function updateSettings(settings: AiSettings) {
    setData((current) => ({ ...current, settings }));
  }

  async function testConnection() {
    if (isTestingConnection) return;
    setIsTestingConnection(true);
    try {
      const result = await window.learnAgent.testConnection({ settings: data.settings });
      const nextSettings: AiSettings = {
        ...data.settings,
        lastTestedAt: result.testedAt,
        lastTestStatus: result.ok ? 'success' : 'error',
        lastTestMessage: result.message
      };
      updateSettings(nextSettings);
      pushToast(result.ok ? 'success' : 'error', result.message);
    } catch (error) {
      const testedAt = nowIso();
      const message = `连接测试失败：${errorMessage(error)}`;
      updateSettings({
        ...data.settings,
        lastTestedAt: testedAt,
        lastTestStatus: 'error',
        lastTestMessage: message
      });
      pushToast('error', message);
    } finally {
      setIsTestingConnection(false);
    }
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
      <Sidebar
        notes={data.notes}
        filteredNotes={filteredNotes}
        selectedNoteId={selectedNoteId}
        noteSearch={noteSearch}
        saveState={saveState}
        onSearchChange={setNoteSearch}
        onSelectNote={setSelectedNoteId}
        onCreateBlankNote={createBlankNote}
        onOpenSettings={() => setShowSettings(true)}
      />

      <section className="workspace">
        <ComposerPanel
          composer={composer}
          isGenerating={isGenerating}
          isListening={isListening}
          voiceError={voiceError}
          onComposerChange={setComposer}
          onGenerate={generateNote}
          onToggleListening={toggleListening}
        />

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
      </section>

      <ChatPanel
        selectedNote={selectedNote}
        conversation={selectedConversation}
        chatInput={chatInput}
        isAsking={isAsking}
        settings={data.settings}
        onChatInputChange={setChatInput}
        onAsk={askBot}
      />

      {showSettings && (
        <SettingsModal
          settings={data.settings}
          dataPath={dataPath}
          isTesting={isTestingConnection}
          onClose={() => setShowSettings(false)}
          onChange={updateSettings}
          onTestConnection={testConnection}
        />
      )}

      <ToastHost
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
      />
    </main>
  );
}
