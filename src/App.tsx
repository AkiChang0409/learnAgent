import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronRight, FileText, Loader2, Settings, Upload } from 'lucide-react';
import type {
  AiSettings,
  ChatMessage,
  Conversation,
  Note,
  NoteDistillationPatch,
  NoteSection,
  TokenUsageRecord
} from './types';
import { ChatPanel } from './components/ChatPanel';
import { ComposerPanel } from './components/ComposerPanel';
import { NoteEditor, type ListField } from './components/NoteEditor';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { ToastHost, type ToastMessage } from './components/ToastHost';
import { useAppData } from './hooks/useAppData';
import { useAutosave } from './hooks/useAutosave';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { createId, draftToNote, formatDate, markdownDraftToNotes, nowIso } from './services/notes';
import { retrieveContext } from './services/rag';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

const MEMORY_SUMMARY_TRIGGER_MESSAGES = 6;
const MEMORY_SUMMARY_BATCH_SIZE = 12;
const RECENT_HISTORY_MESSAGE_LIMIT = 6;

type NoteDropPlacement = 'before' | 'inside' | 'after' | 'root' | 'topic';

interface SubjectSummary {
  subject: string;
  noteCount: number;
  topicCount: number;
  latestUpdatedAt: string;
  sampleTopics: string[];
}

export default function App() {
  const { data, setData, selectedNoteId, setSelectedNoteId, dataPath, isReady, loadError } = useAppData();
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [composer, setComposer] = useState('');
  const [noteSearch, setNoteSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Note[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isImportingMarkdown, setIsImportingMarkdown] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [isDistilling, setIsDistilling] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
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

  const subjectSummaries = useMemo(() => {
    const groups = new Map<string, Note[]>();
    data.notes.forEach((note) => {
      const subject = note.subject.trim() || '通用学习';
      groups.set(subject, [...(groups.get(subject) || []), note]);
    });

    return Array.from(groups.entries())
      .map(([subject, notes]): SubjectSummary => {
        const latestUpdatedAt = notes
          .map((note) => note.updatedAt)
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || nowIso();
        const topics = Array.from(new Set(notes.map((note) => note.topic.trim() || '未命名主题')));
        return {
          subject,
          noteCount: notes.length,
          topicCount: topics.length,
          latestUpdatedAt,
          sampleTopics: topics.slice(0, 4)
        };
      })
      .sort((a, b) => new Date(b.latestUpdatedAt).getTime() - new Date(a.latestUpdatedAt).getTime());
  }, [data.notes]);

  const selectedSubjectNotes = useMemo(
    () => selectedSubject ? data.notes.filter((note) => (note.subject.trim() || '通用学习') === selectedSubject) : [],
    [data.notes, selectedSubject]
  );

  useEffect(() => {
    if (!selectedSubject) return;
    const notes = data.notes.filter((note) => (note.subject.trim() || '通用学习') === selectedSubject);
    if (!notes.length) {
      setSelectedSubject(null);
      setSelectedNoteId('');
      return;
    }
    if (!notes.some((note) => note.id === selectedNoteId)) {
      setSelectedNoteId(notes[0]?.id || '');
    }
  }, [data.notes, selectedNoteId, selectedSubject, setSelectedNoteId]);

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
          const fallback = selectedSubjectNotes.filter((note) =>
            [note.title, note.subject, note.topic, note.summary, note.tags.join(' ')]
              .join(' ')
              .toLowerCase()
              .includes(query.toLowerCase())
          );
          setSearchResults(fallback);
        });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [noteSearch, pushToast, selectedSubjectNotes]);

  const filteredNotes = useMemo(() => {
    const query = noteSearch.trim().toLowerCase();
    if (!selectedSubject) return [];
    if (!query) return selectedSubjectNotes;
    return searchResults.filter((note) => (note.subject.trim() || '通用学习') === selectedSubject);
  }, [noteSearch, searchResults, selectedSubject, selectedSubjectNotes]);

  function appendUsageRecord(record?: TokenUsageRecord | null) {
    if (!record) return;
    setData((current) => ({
      ...current,
      usageRecords: [...(current.usageRecords || []), record].slice(-1000)
    }));
  }

  function noteSortValue(note: Note) {
    return note.position ?? Number.MAX_SAFE_INTEGER;
  }

  function rootNotePosition(notes: Note[], subject: string, topic: string) {
    const rootNotes = notes.filter((note) => !note.parentId && note.subject === subject && note.topic === topic);
    return rootNotes.length ? Math.max(...rootNotes.map(noteSortValue)) + 1 : 0;
  }

  function hasDescendant(notes: Note[], parentId: string, childId: string): boolean {
    const children = notes.filter((note) => note.parentId === parentId);
    return children.some((child) => child.id === childId || hasDescendant(notes, child.id, childId));
  }

  function descendantIds(notes: Note[], parentId: string): Set<string> {
    const ids = new Set<string>();
    const visit = (noteId: string) => {
      notes
        .filter((note) => note.parentId === noteId)
        .forEach((child) => {
          ids.add(child.id);
          visit(child.id);
        });
    };
    visit(parentId);
    return ids;
  }

  function notePositionKey(note: Pick<Note, 'subject' | 'topic' | 'parentId'>) {
    return `${note.subject || '通用学习'}\u0000${note.topic || '未命名主题'}\u0000${note.parentId || ''}`;
  }

  function normalizeNotePositions(notes: Note[], preferredOrder?: { subject: string; topic: string; parentId: string; orderedIds: string[] }) {
    const preferred = preferredOrder
      ? new Map(preferredOrder.orderedIds.map((id, index) => [id, index]))
      : null;
    const preferredKey = preferredOrder
      ? notePositionKey({ subject: preferredOrder.subject, topic: preferredOrder.topic, parentId: preferredOrder.parentId })
      : '';
    const groups = new Map<string, Note[]>();
    notes.forEach((note) => {
      const key = notePositionKey(note);
      groups.set(key, [...(groups.get(key) || []), note]);
    });

    const positions = new Map<string, number>();
    groups.forEach((group, key) => {
      const sorted = [...group].sort((a, b) => {
        if (preferred && key === preferredKey) {
          return (preferred.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (preferred.get(b.id) ?? Number.MAX_SAFE_INTEGER);
        }
        return noteSortValue(a) - noteSortValue(b) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
      sorted.forEach((note, index) => positions.set(note.id, index));
    });

    return notes.map((note) => ({ ...note, position: positions.get(note.id) ?? note.position ?? 0 }));
  }

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
      const draftNote = draftToNote(result.draft);
      const subject = selectedSubject || draftNote.subject || '通用学习';
      const topic = draftNote.topic || '未命名主题';
      const note = { ...draftNote, subject, topic };
      const conversation = {
        id: createId('conversation'),
        noteId: note.id,
        title: note.title,
        messages: [],
        updatedAt: nowIso()
      };
      setData((current) => ({
        ...current,
        notes: [
          { ...note, position: rootNotePosition(current.notes, subject, topic) },
          ...current.notes
        ],
        conversations: [conversation, ...current.conversations]
      }));
      appendUsageRecord(result.usageRecord);
      setSelectedSubject(subject);
      setSelectedNoteId(note.id);
      setComposer('');
      pushToast(result.usedFallback ? 'info' : 'success', result.message || '已生成知识总结');
    } catch (error) {
      pushToast('error', `生成失败：${errorMessage(error)}`);
    } finally {
      setIsGenerating(false);
    }
  }

  async function importMarkdown() {
    if (isImportingMarkdown || isGenerating) return;
    setIsImportingMarkdown(true);
    try {
      const result = await window.learnAgent.importMarkdown({ settings: data.settings });
      if (result.canceled) return;
      if (!result.root) {
        pushToast('error', '导入失败：未生成有效笔记结构');
        return;
      }

      const importedNotes = markdownDraftToNotes(result.root);
      const rootNote = importedNotes[0];
      if (!rootNote) {
        pushToast('error', '导入失败：Markdown 内容为空或无法整理');
        return;
      }

      const subject = rootNote.subject || selectedSubject || '通用学习';
      const topic = rootNote.topic || rootNote.title || '未命名主题';
      const now = nowIso();
      const normalizedNotes = importedNotes.map((note, index) => {
        if (index === 0) {
          return {
            ...note,
            subject,
            topic,
            parentId: undefined,
            position: 0,
            updatedAt: now
          };
        }
        return {
          ...note,
          subject: note.subject || subject,
          topic,
          parentId: rootNote.id,
          position: index - 1,
          updatedAt: now
        };
      });
      const conversations: Conversation[] = normalizedNotes.map((note) => ({
        id: createId('conversation'),
        noteId: note.id,
        title: note.title,
        messages: [],
        updatedAt: now
      }));

      setData((current) => ({
        ...current,
        notes: [
          { ...normalizedNotes[0], position: rootNotePosition(current.notes, subject, topic) },
          ...normalizedNotes.slice(1),
          ...current.notes
        ],
        conversations: [...conversations, ...current.conversations],
        usageRecords: result.usageRecord
          ? [...(current.usageRecords || []), result.usageRecord].slice(-1000)
          : current.usageRecords
      }));
      setSelectedSubject(subject);
      setSelectedNoteId(rootNote.id);
      pushToast(
        result.usedFallback ? 'info' : 'success',
        `${result.message || '已从 Markdown 生成知识地图'}：${normalizedNotes.length} 篇笔记`
      );
    } catch (error) {
      pushToast('error', `导入 Markdown 失败：${errorMessage(error)}`);
    } finally {
      setIsImportingMarkdown(false);
    }
  }

  function createBlankNote() {
    const now = nowIso();
    const subject = selectedSubject || '通用学习';
    const topic = '未命名主题';
    const note: Note = {
      id: createId('note'),
      title: '新学习笔记',
      subject,
      topic,
      tags: [],
      summary: '',
      sections: [{ id: createId('section'), heading: '核心知识点', content: '' }],
      cases: [],
      pitfalls: [],
      interviewQuestions: [],
      createdAt: now,
      updatedAt: now,
      position: rootNotePosition(data.notes, subject, topic)
    };
    setData((current) => ({
      ...current,
      notes: [note, ...current.notes],
      conversations: [
        { id: createId('conversation'), noteId: note.id, title: note.title, messages: [], updatedAt: now },
        ...current.conversations
      ]
    }));
    setSelectedSubject(subject);
    setSelectedNoteId(note.id);
    pushToast('success', '已创建空白笔记');
  }

  function deleteSelectedNote() {
    if (!selectedNote) return;
    const remaining = data.notes.filter((note) => note.id !== selectedNote.id);
    const promotedParentId = selectedNote.parentId;
    setData((current) => ({
      ...current,
      notes: normalizeNotePositions(
        current.notes
          .filter((note) => note.id !== selectedNote.id)
          .map((note) => note.parentId === selectedNote.id ? { ...note, parentId: promotedParentId } : note)
      ),
      conversations: current.conversations.filter((conversation) => conversation.noteId !== selectedNote.id)
    }));
    setSelectedNoteId(remaining[0]?.id || '');
    pushToast('info', '笔记已删除');
  }

  function moveNote(draggedId: string, targetId: string | null, placement: NoteDropPlacement, targetTopic?: string) {
    setData((current) => {
      const dragged = current.notes.find((note) => note.id === draggedId);
      if (!dragged) return current;
      const target = targetId ? current.notes.find((note) => note.id === targetId) : null;
      if (targetId && !target) return current;
      if (targetId === draggedId) return current;
      if (targetId && hasDescendant(current.notes, draggedId, targetId)) return current;

      const nextSubject = selectedSubject || target?.subject || dragged.subject || '通用学习';
      const nextTopic = placement === 'root'
        ? dragged.topic
        : placement === 'topic'
          ? targetTopic || dragged.topic || '未命名主题'
          : target?.topic || dragged.topic || '未命名主题';
      const targetParentId = placement === 'root' || placement === 'topic'
        ? undefined
        : placement === 'inside'
          ? target?.id
          : target?.parentId;
      const parentId = targetParentId || undefined;
      const movedAt = nowIso();
      const childIds = descendantIds(current.notes, draggedId);
      const movedNotes = current.notes.map((note) =>
        note.id === draggedId
          ? { ...note, subject: nextSubject, topic: nextTopic, parentId, updatedAt: movedAt }
          : childIds.has(note.id)
            ? { ...note, subject: nextSubject, topic: nextTopic, updatedAt: movedAt }
            : note
      );
      const siblingIds = movedNotes
        .filter((note) =>
          note.subject === nextSubject &&
          note.topic === nextTopic &&
          (note.parentId || '') === (parentId || '') &&
          note.id !== draggedId
        )
        .sort((a, b) => noteSortValue(a) - noteSortValue(b) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .map((note) => note.id);

      let insertIndex = siblingIds.length;
      if ((placement === 'before' || placement === 'after') && target) {
        const targetIndex = siblingIds.indexOf(target.id);
        insertIndex = targetIndex < 0 ? siblingIds.length : targetIndex + (placement === 'after' ? 1 : 0);
      }
      const orderedIds = [...siblingIds];
      orderedIds.splice(insertIndex, 0, draggedId);

      return {
        ...current,
        notes: normalizeNotePositions(movedNotes, {
          subject: nextSubject,
          topic: nextTopic,
          parentId: parentId || '',
          orderedIds
        })
      };
    });
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

  function updateConversationMemory(noteId: string, memorySummary: string, summarizedMessageCount: number) {
    setData((current) => {
      const note = current.notes.find((item) => item.id === noteId);
      const existing = current.conversations.find((conversation) => conversation.noteId === noteId);
      const memoryUpdatedAt = nowIso();
      if (!existing) {
        return {
          ...current,
          conversations: [
            {
              id: createId('conversation'),
              noteId,
              title: note?.title || '学习对话',
              messages: [],
              memorySummary,
              memoryUpdatedAt,
              summarizedMessageCount,
              updatedAt: memoryUpdatedAt
            },
            ...current.conversations
          ]
        };
      }

      return {
        ...current,
        conversations: current.conversations.map((conversation) =>
          conversation.noteId === noteId
            ? {
                ...conversation,
                memorySummary,
                memoryUpdatedAt,
                summarizedMessageCount,
                updatedAt: memoryUpdatedAt
              }
            : conversation
        )
      };
    });
  }

  async function refreshConversationMemory(
    note: Note,
    messages: ChatMessage[],
    previousSummary: string,
    summarizedMessageCount: number
  ) {
    const result = await window.learnAgent.summarizeConversation({
      note,
      previousSummary,
      messages,
      settings: data.settings
    });
    updateConversationMemory(note.id, result.memorySummary, summarizedMessageCount);
    appendUsageRecord(result.usageRecord);
    return result.memorySummary;
  }

  async function ensureFullConversationMemory(note: Note, conversation: Conversation) {
    let memorySummary = conversation.memorySummary || '';
    let summarizedMessageCount = conversation.summarizedMessageCount || 0;

    while (summarizedMessageCount < conversation.messages.length) {
      const nextCount = Math.min(summarizedMessageCount + MEMORY_SUMMARY_BATCH_SIZE, conversation.messages.length);
      const chunk = conversation.messages.slice(summarizedMessageCount, nextCount);
      memorySummary = await refreshConversationMemory(note, chunk, memorySummary, nextCount);
      summarizedMessageCount = nextCount;
    }

    return memorySummary;
  }

  function mergeUnique(existing: string[], incoming: string[]) {
    const seen = new Set(existing.map((value) => value.trim().toLowerCase()));
    const merged = [...existing];
    incoming.forEach((value) => {
      const clean = value.trim();
      const key = clean.toLowerCase();
      if (clean && !seen.has(key)) {
        seen.add(key);
        merged.push(clean);
      }
    });
    return merged;
  }

  function mergeDistillationPatch(note: Note, patch: NoteDistillationPatch): Note {
    const stampedTitle = new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date());
    const summaryAppend = patch.summaryAppend.trim();
    const nextSections = [...note.sections];

    patch.sections.forEach((section) => {
      const heading = section.heading.trim() || '对话沉淀';
      const content = section.content.trim();
      if (!content) return;
      const existingIndex = nextSections.findIndex((item) => item.heading.trim() === heading);
      const block = `对话补充（${stampedTitle}）\n${content}`;
      if (existingIndex >= 0) {
        nextSections[existingIndex] = {
          ...nextSections[existingIndex],
          content: [nextSections[existingIndex].content.trim(), block].filter(Boolean).join('\n\n')
        };
      } else {
        nextSections.push({
          id: createId('section'),
          heading,
          content: block
        });
      }
    });

    return {
      ...note,
      summary: summaryAppend
        ? [note.summary.trim(), `对话补充（${stampedTitle}）\n${summaryAppend}`].filter(Boolean).join('\n\n')
        : note.summary,
      sections: nextSections,
      tags: mergeUnique(note.tags, patch.tags),
      cases: mergeUnique(note.cases, patch.cases),
      pitfalls: mergeUnique(note.pitfalls, patch.pitfalls),
      interviewQuestions: mergeUnique(note.interviewQuestions, patch.interviewQuestions)
    };
  }

  async function askBot() {
    if (!selectedNote || !chatInput.trim() || isAsking) return;
    const question = chatInput.trim();
    let ragResult = retrieveContext(question, selectedNote, data.notes);
    try {
      ragResult = await window.learnAgent.retrieveContext({ question, currentNote: selectedNote, limit: 8 });
    } catch (error) {
      pushToast('error', `RAG 检索失败，已使用本地内存召回：${errorMessage(error)}`);
    }
    const { context, sources } = ragResult;
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
        history: history.slice(-RECENT_HISTORY_MESSAGE_LIMIT),
        memorySummary: selectedConversation?.memorySummary || '',
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
      appendUsageRecord(result.usageRecord);
      const nextMessages = [...history, userMessage, assistantMessage];
      const summarizedMessageCount = selectedConversation?.summarizedMessageCount || 0;
      const unsummarizedMessages = nextMessages.slice(summarizedMessageCount);
      if (unsummarizedMessages.length >= MEMORY_SUMMARY_TRIGGER_MESSAGES) {
        refreshConversationMemory(
          selectedNote,
          unsummarizedMessages,
          selectedConversation?.memorySummary || '',
          nextMessages.length
        ).catch((error) => {
          pushToast('error', `阶段记忆更新失败：${errorMessage(error)}`);
        });
      }
      if (result.usedFallback) pushToast('info', result.message);
    } catch (error) {
      pushToast('error', `对话失败：${errorMessage(error)}`);
    } finally {
      setIsAsking(false);
    }
  }

  async function distillConversationToNote() {
    if (!selectedNote || !selectedConversation || isAsking || isDistilling) return;
    if (selectedConversation.messages.length < 2) return;
    setIsDistilling(true);
    try {
      const memorySummary = await ensureFullConversationMemory(selectedNote, selectedConversation);
      const result = await window.learnAgent.distillConversationToNote({
        note: selectedNote,
        memorySummary,
        messages: selectedConversation.messages.slice(-MEMORY_SUMMARY_BATCH_SIZE),
        settings: data.settings
      });
      updateSelectedNote((note) => mergeDistillationPatch(note, result.patch));
      updateConversationMemory(selectedNote.id, result.memorySummary || memorySummary, selectedConversation.messages.length);
      appendUsageRecord(result.usageRecord);
      pushToast(result.usedFallback ? 'info' : 'success', result.message || '已补充到当前笔记');
    } catch (error) {
      pushToast('error', `补充笔记失败：${errorMessage(error)}`);
    } finally {
      setIsDistilling(false);
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
      setData((current) => ({
        ...current,
        settings: nextSettings,
        usageRecords: result.usageRecord
          ? [...(current.usageRecords || []), result.usageRecord].slice(-1000)
          : current.usageRecords
      }));
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

  async function exportSyncPackage() {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await window.learnAgent.exportSyncPackage();
      if (result.canceled) return;
      if (!result.ok) {
        pushToast('error', '导出同步包失败');
        return;
      }
      const summary = result.summary;
      pushToast(
        'success',
        summary
          ? `已导出同步包：${summary.notes} 篇笔记，${summary.conversations} 个对话`
          : '已导出同步包'
      );
    } catch (error) {
      pushToast('error', `导出同步包失败：${errorMessage(error)}`);
    } finally {
      setIsSyncing(false);
    }
  }

  async function importSyncPackage() {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await window.learnAgent.importSyncPackage();
      if (result.canceled) return;
      if (!result.ok || !result.data) {
        pushToast('error', '导入同步包失败');
        return;
      }
      setData(result.data);
      setSelectedSubject(null);
      setSelectedNoteId('');
      setNoteSearch('');
      const summary = result.summary;
      pushToast(
        'success',
        summary
          ? `已合并：新增 ${summary.notesAdded} 篇，更新 ${summary.notesUpdated} 篇`
          : '已导入并合并同步包'
      );
    } catch (error) {
      pushToast('error', `导入同步包失败：${errorMessage(error)}`);
    } finally {
      setIsSyncing(false);
    }
  }

  if (!isReady) {
    return (
      <main className="loading-screen">
        <Loader2 className="spin" size={24} />
      </main>
    );
  }

  function enterSubject(subject: string) {
    const notes = data.notes.filter((note) => (note.subject.trim() || '通用学习') === subject);
    setSelectedSubject(subject);
    setNoteSearch('');
    setSelectedNoteId(notes[0]?.id || '');
  }

  if (!selectedSubject) {
    return (
      <main className="subject-home">
        <header className="subject-home-header">
          <div>
            <span className="eyebrow">LearnAgent</span>
            <h1>学科</h1>
            <p>{data.notes.length ? `${subjectSummaries.length} 个学科 · ${data.notes.length} 篇笔记` : '还没有笔记，先创建一个学科入口。'}</p>
          </div>
          <div className="subject-home-actions">
            <button className="secondary-action" onClick={() => setShowSettings(true)} type="button">
              <Settings size={16} />
              设置
            </button>
            <button className="secondary-action" onClick={importMarkdown} disabled={isImportingMarkdown} type="button">
              {isImportingMarkdown ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
              导入 MD
            </button>
            <button className="primary-action" onClick={createBlankNote} type="button">
              <FileText size={16} />
              新笔记
            </button>
          </div>
        </header>

        {subjectSummaries.length ? (
          <section className="subject-card-grid" aria-label="学科列表">
            {subjectSummaries.map((subject) => (
              <button className="subject-card" key={subject.subject} onClick={() => enterSubject(subject.subject)} type="button">
                <div className="subject-card-icon">
                  <BookOpen size={22} />
                </div>
                <div>
                  <h2>{subject.subject}</h2>
                  <p>{subject.topicCount} 个主题 · {subject.noteCount} 篇笔记</p>
                </div>
                <div className="subject-topic-preview">
                  {subject.sampleTopics.map((topic) => (
                    <span key={topic}>{topic}</span>
                  ))}
                </div>
                <div className="subject-card-footer">
                  <span>最近更新 {formatDate(subject.latestUpdatedAt)}</span>
                  <ChevronRight size={18} />
                </div>
              </button>
            ))}
          </section>
        ) : (
          <section className="subject-empty">
            <BookOpen size={34} />
            <h2>暂无学科</h2>
            <p>创建第一篇笔记后，会按“学科、主题、笔记”自动归档。</p>
          </section>
        )}

        {showSettings && (
          <SettingsModal
            settings={data.settings}
            usageRecords={data.usageRecords}
            dataPath={dataPath}
            isTesting={isTestingConnection}
            isSyncing={isSyncing}
            onClose={() => setShowSettings(false)}
            onChange={updateSettings}
            onTestConnection={testConnection}
            onExportSync={exportSyncPackage}
            onImportSync={importSyncPackage}
          />
        )}

        <ToastHost
          toasts={toasts}
          onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Sidebar
        notes={selectedSubjectNotes}
        filteredNotes={filteredNotes}
        selectedSubject={selectedSubject}
        selectedNoteId={selectedNoteId}
        noteSearch={noteSearch}
        saveState={saveState}
        onSearchChange={setNoteSearch}
        onSelectNote={setSelectedNoteId}
        onCreateBlankNote={createBlankNote}
        onMoveNote={moveNote}
        onBackToSubjects={() => {
          setSelectedSubject(null);
          setSelectedNoteId('');
          setNoteSearch('');
        }}
        onOpenSettings={() => setShowSettings(true)}
      />

      <section className="workspace">
        <ComposerPanel
          composer={composer}
          isGenerating={isGenerating}
          isImportingMarkdown={isImportingMarkdown}
          isListening={isListening}
          voiceError={voiceError}
          onComposerChange={setComposer}
          onGenerate={generateNote}
          onImportMarkdown={importMarkdown}
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
        isDistilling={isDistilling}
        settings={data.settings}
        onChatInputChange={setChatInput}
        onAsk={askBot}
        onDistillToNote={distillConversationToNote}
      />

      {showSettings && (
        <SettingsModal
          settings={data.settings}
          usageRecords={data.usageRecords}
          dataPath={dataPath}
          isTesting={isTestingConnection}
          isSyncing={isSyncing}
          onClose={() => setShowSettings(false)}
          onChange={updateSettings}
          onTestConnection={testConnection}
          onExportSync={exportSyncPackage}
          onImportSync={importSyncPackage}
        />
      )}

      <ToastHost
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
      />
    </main>
  );
}
