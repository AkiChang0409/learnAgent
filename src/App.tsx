import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, ChevronRight, Edit3, Loader2, Plus, Settings, Trash2, Upload, X } from 'lucide-react';
import type {
  AiSettings,
  ChatMessage,
  Conversation,
  Note,
  NoteDistillationPatch,
  NoteSection,
  Subject,
  TokenUsageRecord
} from './types';
import { ChatPanel } from './components/ChatPanel';
import { ComposerPanel } from './components/ComposerPanel';
import { ImportProgressPanel } from './components/ImportProgressPanel';
import { NoteEditor, type ListField } from './components/NoteEditor';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { ToastHost, type ToastMessage } from './components/ToastHost';
import { useAppData } from './hooks/useAppData';
import { useAutosave } from './hooks/useAutosave';
import { useKnowledgeImport } from './hooks/useKnowledgeImport';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { cleanSubjectName, createId, draftToNote, ensureSubjects, formatDate, nowIso } from './services/notes';
import { retrieveContext } from './services/rag';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

const MEMORY_SUMMARY_TRIGGER_MESSAGES = 6;
const MEMORY_SUMMARY_BATCH_SIZE = 12;
const RECENT_HISTORY_MESSAGE_LIMIT = 6;

type NoteDropPlacement = 'before' | 'inside' | 'after' | 'root' | 'topic';

interface SubjectSummary {
  id: string;
  name: string;
  description: string;
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
  const [isAsking, setIsAsking] = useState(false);
  const [isDistilling, setIsDistilling] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [editingSubjectName, setEditingSubjectName] = useState('');
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
    const subjects = ensureSubjects({ subjects: data.subjects || [], notes: data.notes || [] });
    const groups = new Map<string, Note[]>();
    data.notes.forEach((note) => {
      const subject = cleanSubjectName(note.subject);
      groups.set(subject, [...(groups.get(subject) || []), note]);
    });

    return subjects
      .map((subject): SubjectSummary => {
        const notes = groups.get(subject.name) || [];
        const latestUpdatedAt = notes
          .map((note) => note.updatedAt)
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || subject.updatedAt;
        const topics = Array.from(new Set(notes.map((note) => note.topic.trim() || '未命名主题')));
        return {
          id: subject.id,
          name: subject.name,
          description: subject.description || '',
          noteCount: notes.length,
          topicCount: topics.length,
          latestUpdatedAt,
          sampleTopics: topics.slice(0, 4)
        };
      })
      .sort((a, b) => new Date(b.latestUpdatedAt).getTime() - new Date(a.latestUpdatedAt).getTime());
  }, [data.notes, data.subjects]);

  const subjectOptions = useMemo(() => subjectSummaries.map((subject) => subject.name), [subjectSummaries]);

  const selectedSubjectNotes = useMemo(
    () => selectedSubject ? data.notes.filter((note) => cleanSubjectName(note.subject) === selectedSubject) : [],
    [data.notes, selectedSubject]
  );

  useEffect(() => {
    if (!selectedSubject) return;
    const notes = data.notes.filter((note) => cleanSubjectName(note.subject) === selectedSubject);
    const subjectExists = subjectSummaries.some((subject) => subject.name === selectedSubject);
    if (!subjectExists && !notes.length) {
      setSelectedSubject(null);
      setSelectedNoteId('');
      return;
    }
    if (!notes.length) {
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
    return searchResults.filter((note) => cleanSubjectName(note.subject) === selectedSubject);
  }, [noteSearch, searchResults, selectedSubject, selectedSubjectNotes]);

  const { importMarkdown, isImportingMarkdown, importProgress } = useKnowledgeImport({
    data,
    setData,
    selectedSubject,
    isGenerating,
    setSelectedSubject,
    setSelectedNoteId,
    pushToast
  });

  function appendUsageRecord(record?: TokenUsageRecord | null) {
    if (!record) return;
    setData((current) => ({
      ...current,
      usageRecords: [...(current.usageRecords || []), record].slice(-1000)
    }));
  }

  function subjectExists(name: string, excludeId = '') {
    const cleanName = cleanSubjectName(name).toLowerCase();
    return (data.subjects || []).some(
      (subject) => subject.id !== excludeId && cleanSubjectName(subject.name).toLowerCase() === cleanName
    );
  }

  function upsertSubject(subjects: Subject[], name: string, updatedAt = nowIso()) {
    const cleanName = cleanSubjectName(name);
    const existing = subjects.find((subject) => cleanSubjectName(subject.name).toLowerCase() === cleanName.toLowerCase());
    if (existing) {
      return subjects.map((subject) =>
        subject.id === existing.id
          ? { ...subject, name: cleanName, updatedAt: subject.updatedAt || updatedAt }
          : subject
      );
    }
    return [
      {
        id: createId('subject'),
        name: cleanName,
        description: '',
        createdAt: updatedAt,
        updatedAt
      },
      ...subjects
    ];
  }

  function createSubject() {
    const name = newSubjectName.trim();
    if (!name) {
      pushToast('error', '请输入学科名称');
      return;
    }
    if (subjectExists(name)) {
      pushToast('error', '这个学科已经存在');
      return;
    }
    const now = nowIso();
    const cleanName = cleanSubjectName(name);
    setData((current) => ({
      ...current,
      subjects: [
        {
          id: createId('subject'),
          name: cleanName,
          description: '',
          createdAt: now,
          updatedAt: now
        },
        ...(current.subjects || [])
      ]
    }));
    setNewSubjectName('');
    setSelectedSubject(cleanName);
    setSelectedNoteId('');
    setNoteSearch('');
    pushToast('success', '已创建学科');
  }

  function startRenamingSubject(subject: SubjectSummary) {
    setEditingSubjectId(subject.id);
    setEditingSubjectName(subject.name);
  }

  function cancelRenamingSubject() {
    setEditingSubjectId(null);
    setEditingSubjectName('');
  }

  function renameSubject(subject: SubjectSummary) {
    const nextName = editingSubjectName.trim();
    if (!nextName) {
      pushToast('error', '请输入学科名称');
      return;
    }
    if (subjectExists(nextName, subject.id)) {
      pushToast('error', '这个学科已经存在');
      return;
    }
    const cleanName = cleanSubjectName(nextName);
    const renamedAt = nowIso();
    setData((current) => ({
      ...current,
      subjects: (current.subjects || []).map((item) =>
        item.id === subject.id ? { ...item, name: cleanName, updatedAt: renamedAt } : item
      ),
      notes: current.notes.map((note) =>
        cleanSubjectName(note.subject) === subject.name
          ? { ...note, subject: cleanName, updatedAt: renamedAt }
          : note
      )
    }));
    if (selectedSubject === subject.name) setSelectedSubject(cleanName);
    cancelRenamingSubject();
    pushToast('success', '学科已重命名');
  }

  function deleteSubject(subject: SubjectSummary) {
    if (subject.noteCount > 0) {
      const confirmed = window.confirm(`删除“${subject.name}”会同时删除 ${subject.noteCount} 篇笔记及相关对话。确定继续？`);
      if (!confirmed) return;
    }
    const noteIds = new Set(data.notes.filter((note) => cleanSubjectName(note.subject) === subject.name).map((note) => note.id));
    setData((current) => ({
      ...current,
      subjects: (current.subjects || []).filter((item) => item.id !== subject.id),
      notes: current.notes.filter((note) => cleanSubjectName(note.subject) !== subject.name),
      conversations: current.conversations.filter((conversation) => !noteIds.has(conversation.noteId))
    }));
    if (selectedSubject === subject.name) {
      setSelectedSubject(null);
      setSelectedNoteId('');
      setNoteSearch('');
    }
    if (editingSubjectId === subject.id) cancelRenamingSubject();
    pushToast('info', subject.noteCount > 0 ? '学科和笔记已删除' : '学科已删除');
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

  function updateSelectedNotePatch(patch: Partial<Note>) {
    if (!selectedNoteId) return;
    const nextSubject = patch.subject === undefined ? null : cleanSubjectName(patch.subject);
    const updatedAt = nowIso();
    setData((current) => ({
      ...current,
      subjects: nextSubject ? upsertSubject(current.subjects || [], nextSubject, updatedAt) : current.subjects,
      notes: current.notes.map((note) =>
        note.id === selectedNoteId
          ? {
              ...note,
              ...patch,
              subject: nextSubject || note.subject,
              updatedAt
            }
          : note
      )
    }));
    if (nextSubject) {
      setSelectedSubject(nextSubject);
      setNoteSearch('');
    }
  }

  async function generateNote() {
    const input = composer.trim();
    if (!input || isGenerating) return;
    setIsGenerating(true);
    try {
      const result = await window.learnAgent.generateNote({ input, settings: data.settings });
      const draftNote = draftToNote(result.draft);
      const subject = cleanSubjectName(selectedSubject || draftNote.subject);
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
        subjects: upsertSubject(current.subjects || [], subject, note.updatedAt),
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

  function createBlankNote() {
    const now = nowIso();
    const subject = cleanSubjectName(selectedSubject);
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
      subjects: upsertSubject(current.subjects || [], subject, now),
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
    const remainingInSubject = remaining.filter((note) => cleanSubjectName(note.subject) === cleanSubjectName(selectedNote.subject));
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
    setSelectedNoteId(remainingInSubject[0]?.id || '');
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
      setData({
        ...result.data,
        subjects: ensureSubjects({
          subjects: result.data.subjects || [],
          notes: result.data.notes || []
        })
      });
      setSelectedSubject(null);
      setSelectedNoteId('');
      setNoteSearch('');
      const summary = result.summary;
      pushToast(
        'success',
        summary
          ? `已合并：新增 ${summary.subjectsAdded} 个学科、${summary.notesAdded} 篇笔记`
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
    const notes = data.notes.filter((note) => cleanSubjectName(note.subject) === subject);
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
            <p>{subjectSummaries.length ? `${subjectSummaries.length} 个学科 · ${data.notes.length} 篇笔记` : '先创建学科，再导入资料或生成笔记。'}</p>
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
          </div>
        </header>
        <ImportProgressPanel progress={importProgress} />

        <form
          className="subject-create-panel"
          onSubmit={(event) => {
            event.preventDefault();
            createSubject();
          }}
        >
          <div>
            <span className="eyebrow">New Subject</span>
            <strong>初始化学科空间</strong>
          </div>
          <input
            value={newSubjectName}
            onChange={(event) => setNewSubjectName(event.target.value)}
            placeholder="输入学科名称，例如：操作系统、数据结构、项目复盘"
          />
          <button className="primary-action" type="submit" disabled={!newSubjectName.trim()}>
            <Plus size={16} />
            新建学科
          </button>
        </form>

        {subjectSummaries.length ? (
          <section className="subject-card-grid" aria-label="学科列表">
            {subjectSummaries.map((subject) => (
              <article className="subject-card" key={subject.id}>
                {editingSubjectId === subject.id ? (
                  <form
                    className="subject-edit-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      renameSubject(subject);
                    }}
                  >
                    <input
                      value={editingSubjectName}
                      onChange={(event) => setEditingSubjectName(event.target.value)}
                      aria-label="学科名称"
                    />
                    <div className="subject-edit-actions">
                      <button className="icon-button" type="submit" title="保存" aria-label="保存">
                        <Check size={16} />
                      </button>
                      <button className="icon-button" type="button" onClick={cancelRenamingSubject} title="取消" aria-label="取消">
                        <X size={16} />
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <button className="subject-card-main" onClick={() => enterSubject(subject.name)} type="button">
                      <div className="subject-card-icon">
                        <BookOpen size={22} />
                      </div>
                      <div>
                        <h2>{subject.name}</h2>
                        <p>{subject.topicCount} 个主题 · {subject.noteCount} 篇笔记</p>
                      </div>
                      <div className="subject-topic-preview">
                        {subject.sampleTopics.length ? (
                          subject.sampleTopics.map((topic) => (
                            <span key={topic}>{topic}</span>
                          ))
                        ) : (
                          <span>待添加主题</span>
                        )}
                      </div>
                      <div className="subject-card-footer">
                        <span>{subject.noteCount ? `最近更新 ${formatDate(subject.latestUpdatedAt)}` : '空学科'}</span>
                        <ChevronRight size={18} />
                      </div>
                    </button>
                    <div className="subject-card-actions">
                      <button className="icon-button" onClick={() => startRenamingSubject(subject)} type="button" title="重命名学科" aria-label="重命名学科">
                        <Edit3 size={16} />
                      </button>
                      <button className="icon-button danger" onClick={() => deleteSubject(subject)} type="button" title="删除学科" aria-label="删除学科">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </section>
        ) : (
          <section className="subject-empty">
            <BookOpen size={34} />
            <h2>暂无学科</h2>
            <p>创建学科后，可以在学科内继续创建笔记、导入 Markdown 或生成知识总结。</p>
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
        <ImportProgressPanel progress={importProgress} />

        <NoteEditor
          note={selectedNote}
          subjectOptions={subjectOptions}
          onChange={updateSelectedNotePatch}
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
