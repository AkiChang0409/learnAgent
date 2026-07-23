import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilePlus2, Loader2, Sparkles, Upload } from 'lucide-react';
import type {
  AiSettings,
  ChatMessage,
  Conversation,
  Note,
  NoteDistillationPatch,
  NoteSection,
  Subject,
  ThemeId,
  TokenUsageRecord
} from './types';
import { AppRail, type NoteDropPlacement, type RailSubject } from './components/AppRail';
import { AssistantPanel } from './components/AssistantPanel';
import { ConfirmDialog, type ConfirmRequest } from './components/ConfirmDialog';
import { GenerateDialog } from './components/GenerateDialog';
import { ImportProgressPanel } from './components/ImportProgressPanel';
import { NoteView, type ListField } from './components/NoteView';
import { SettingsView } from './components/SettingsView';
import { ToastHost, type ToastMessage } from './components/ToastHost';
import { useAppData } from './hooks/useAppData';
import { useAutosave } from './hooks/useAutosave';
import { useKnowledgeImport } from './hooks/useKnowledgeImport';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { cleanSubjectName, createId, draftToNote, ensureSubjects, nowIso } from './services/notes';
import { retrieveContext } from './services/rag';
import { applyTheme, resolveTheme } from './theme';

const APP_VERSION = '0.2.0';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

const MEMORY_SUMMARY_TRIGGER_MESSAGES = 6;
const MEMORY_SUMMARY_BATCH_SIZE = 12;
const RECENT_HISTORY_MESSAGE_LIMIT = 6;

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
  const [view, setView] = useState<'note' | 'settings'>('note');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(() => new Set());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (
      type: ToastMessage['type'],
      message: string,
      options?: { action?: ToastMessage['action']; duration?: number }
    ) => {
      const id = createId('toast');
      setToasts((current) => [...current, { id, type, message, action: options?.action }].slice(-4));
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, options?.duration ?? (options?.action ? 8000 : 5200));
    },
    []
  );

  const theme = resolveTheme(data.settings.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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

  const railSubjects = useMemo<RailSubject[]>(
    () =>
      subjectSummaries.map((subject) => ({
        id: subject.id,
        name: subject.name,
        noteCount: subject.noteCount,
        topicCount: subject.topicCount
      })),
    [subjectSummaries]
  );

  // Focus the first subject on first load so "New note" has a sensible home.
  useEffect(() => {
    if (!isReady) return;
    setSelectedSubject((current) => current ?? subjectSummaries[0]?.name ?? null);
  }, [isReady, subjectSummaries]);

  // Keep the note's subject accordion open when a note becomes selected.
  useEffect(() => {
    if (!selectedNote) return;
    const subject = cleanSubjectName(selectedNote.subject);
    setExpandedSubjects((current) => (current.has(subject) ? current : new Set(current).add(subject)));
  }, [selectedNote]);

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
          const lowered = query.toLowerCase();
          const fallback = data.notes.filter((note) =>
            [note.title, note.subject, note.topic, note.summary, note.tags.join(' ')]
              .join(' ')
              .toLowerCase()
              .includes(lowered)
          );
          setSearchResults(fallback);
        });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [noteSearch, pushToast, data.notes]);

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

  function createSubject(rawName: string) {
    const name = rawName.trim();
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
    setSelectedSubject(cleanName);
    setExpandedSubjects((current) => new Set(current).add(cleanName));
    setNoteSearch('');
    pushToast('success', '已创建学科');
  }

  function renameSubject(id: string, rawName: string) {
    const target = subjectSummaries.find((subject) => subject.id === id);
    if (!target) return;
    const nextName = rawName.trim();
    if (!nextName) {
      pushToast('error', '请输入学科名称');
      return;
    }
    if (subjectExists(nextName, id)) {
      pushToast('error', '这个学科已经存在');
      return;
    }
    const cleanName = cleanSubjectName(nextName);
    const renamedAt = nowIso();
    setData((current) => ({
      ...current,
      subjects: (current.subjects || []).map((item) =>
        item.id === id ? { ...item, name: cleanName, updatedAt: renamedAt } : item
      ),
      notes: current.notes.map((note) =>
        cleanSubjectName(note.subject) === target.name
          ? { ...note, subject: cleanName, updatedAt: renamedAt }
          : note
      )
    }));
    if (selectedSubject === target.name) setSelectedSubject(cleanName);
    setExpandedSubjects((current) => {
      if (!current.has(target.name)) return current;
      const next = new Set(current);
      next.delete(target.name);
      next.add(cleanName);
      return next;
    });
    pushToast('success', '学科已重命名');
  }

  function performDeleteSubject(subject: RailSubject) {
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
    pushToast('info', subject.noteCount > 0 ? '学科和笔记已删除' : '学科已删除');
  }

  function deleteSubject(subject: RailSubject) {
    if (subject.noteCount > 0) {
      setConfirm({
        title: `删除学科「${subject.name}」`,
        message: `这会一并删除该学科下的 ${subject.noteCount} 篇笔记和相关对话，且无法撤销。`,
        confirmLabel: '删除学科',
        onConfirm: () => performDeleteSubject(subject)
      });
      return;
    }
    performDeleteSubject(subject);
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
      openNote(note.id, subject);
      setComposer('');
      setShowGenerate(false);
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
      title: '',
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
    openNote(note.id, subject);
    pushToast('success', '已创建空白笔记');
  }

  function deleteSelectedNote() {
    if (!selectedNote) return;
    const removed = selectedNote;
    const removedConversation = data.conversations.find((conversation) => conversation.noteId === removed.id) || null;
    const directChildIds = data.notes.filter((note) => note.parentId === removed.id).map((note) => note.id);
    const promotedParentId = removed.parentId;
    const childCount = directChildIds.length;
    const remainingInSubject = data.notes.filter(
      (note) => note.id !== removed.id && cleanSubjectName(note.subject) === cleanSubjectName(removed.subject)
    );

    setData((current) => ({
      ...current,
      notes: normalizeNotePositions(
        current.notes
          .filter((note) => note.id !== removed.id)
          .map((note) => (note.parentId === removed.id ? { ...note, parentId: promotedParentId } : note))
      ),
      conversations: current.conversations.filter((conversation) => conversation.noteId !== removed.id)
    }));
    setSelectedNoteId(remainingInSubject[0]?.id || '');

    const restore = () => {
      setData((current) => {
        if (current.notes.some((note) => note.id === removed.id)) return current;
        return {
          ...current,
          notes: normalizeNotePositions([
            ...current.notes.map((note) =>
              directChildIds.includes(note.id) ? { ...note, parentId: removed.id } : note
            ),
            removed
          ]),
          conversations:
            removedConversation && !current.conversations.some((conversation) => conversation.id === removedConversation.id)
              ? [removedConversation, ...current.conversations]
              : current.conversations
        };
      });
      setSelectedSubject(cleanSubjectName(removed.subject));
      setSelectedNoteId(removed.id);
    };

    const detail = childCount ? `已删除「${removed.title || '未命名笔记'}」，${childCount} 篇子笔记已上移` : `已删除「${removed.title || '未命名笔记'}」`;
    pushToast('info', detail, { action: { label: '撤销', onClick: restore }, duration: 8000 });
  }

  function moveNote(
    draggedId: string,
    targetId: string | null,
    placement: NoteDropPlacement,
    targetTopic?: string,
    targetSubject?: string
  ) {
    setData((current) => {
      const dragged = current.notes.find((note) => note.id === draggedId);
      if (!dragged) return current;
      const target = targetId ? current.notes.find((note) => note.id === targetId) : null;
      if (targetId && !target) return current;
      if (targetId === draggedId) return current;
      if (targetId && hasDescendant(current.notes, draggedId, targetId)) return current;

      const nextSubject = target?.subject || targetSubject || dragged.subject || '通用学习';
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

  function updateTheme(nextTheme: ThemeId) {
    setData((current) => ({ ...current, settings: { ...current.settings, theme: nextTheme } }));
  }

  function openNote(noteId: string, subject: string) {
    setSelectedNoteId(noteId);
    setSelectedSubject(cleanSubjectName(subject));
    setView('note');
  }

  function toggleSubject(name: string) {
    setSelectedSubject(name);
    setExpandedSubjects((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function focusSubjectInRail(name: string) {
    setSelectedSubject(name);
    setExpandedSubjects((current) => new Set(current).add(name));
  }

  function openGenerate() {
    setComposer('');
    setShowGenerate(true);
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

  const totalNotes = data.notes.length;

  return (
    <div className="app">
      <AppRail
        notes={data.notes}
        subjects={railSubjects}
        selectedNoteId={selectedNoteId}
        focusedSubject={selectedSubject}
        isSettingsOpen={view === 'settings'}
        noteSearch={noteSearch}
        searchResults={searchResults}
        saveState={saveState}
        isImporting={isImportingMarkdown}
        expandedSubjects={expandedSubjects}
        onSearchChange={setNoteSearch}
        onToggleSubject={toggleSubject}
        onSelectNote={openNote}
        onCreateSubject={createSubject}
        onRenameSubject={renameSubject}
        onDeleteSubject={deleteSubject}
        onMoveNote={moveNote}
        onNewBlank={createBlankNote}
        onNewGenerate={openGenerate}
        onImport={importMarkdown}
        onOpenSettings={() => setView((current) => (current === 'settings' ? 'note' : 'settings'))}
      />

      <main className="stage">
        {view === 'settings' ? (
          <SettingsView
            settings={data.settings}
            theme={theme}
            usageRecords={data.usageRecords}
            dataPath={dataPath}
            appVersion={APP_VERSION}
            isTesting={isTestingConnection}
            isSyncing={isSyncing}
            onBack={() => setView('note')}
            onChange={updateSettings}
            onThemeChange={updateTheme}
            onTestConnection={testConnection}
            onExportSync={exportSyncPackage}
            onImportSync={importSyncPackage}
          />
        ) : selectedNote ? (
          <NoteView
            note={selectedNote}
            subjectOptions={subjectOptions}
            assistantOpen={assistantOpen}
            conversationCount={selectedConversation?.messages.length || 0}
            onChange={updateSelectedNotePatch}
            onDelete={deleteSelectedNote}
            onAddSection={addSection}
            onUpdateSection={updateSection}
            onRemoveSection={removeSection}
            onMoveSection={moveSection}
            onUpdateList={updateList}
            onToggleAssistant={() => setAssistantOpen((open) => !open)}
            onNavigateSubject={focusSubjectInRail}
          />
        ) : (
          <div className="welcome">
            <span className="welcome-logo">
              <Sparkles size={26} />
            </span>
            <h1>{totalNotes ? '选一篇笔记开始' : '开始你的第一篇笔记'}</h1>
            <p>
              {totalNotes
                ? `已有 ${railSubjects.length} 个学科 · ${totalNotes} 篇笔记，从左侧选择，或新建一篇。`
                : '记录今天学到的东西，让 AI 帮你整理成结构化知识，并随时追问。'}
            </p>
            <div className="welcome-actions">
              <button className="primary-action" type="button" onClick={createBlankNote}>
                <FilePlus2 size={17} />
                空白笔记
              </button>
              <button className="secondary-action" type="button" onClick={openGenerate}>
                <Sparkles size={17} />
                AI 生成笔记
              </button>
              <button className="secondary-action" type="button" onClick={importMarkdown} disabled={isImportingMarkdown}>
                {isImportingMarkdown ? <Loader2 className="spin" size={17} /> : <Upload size={17} />}
                导入 Markdown
              </button>
            </div>
          </div>
        )}

        {importProgress && (
          <div className="stage-progress">
            <ImportProgressPanel progress={importProgress} />
          </div>
        )}
      </main>

      {view === 'note' && selectedNote && (
        <AssistantPanel
          open={assistantOpen}
          selectedNote={selectedNote}
          conversation={selectedConversation}
          chatInput={chatInput}
          isAsking={isAsking}
          isDistilling={isDistilling}
          settings={data.settings}
          onChatInputChange={setChatInput}
          onAsk={askBot}
          onDistillToNote={distillConversationToNote}
          onClose={() => setAssistantOpen(false)}
        />
      )}

      <GenerateDialog
        open={showGenerate}
        value={composer}
        targetSubject={cleanSubjectName(selectedSubject)}
        isGenerating={isGenerating}
        isListening={isListening}
        voiceError={voiceError}
        onChange={setComposer}
        onGenerate={generateNote}
        onToggleListening={toggleListening}
        onClose={() => setShowGenerate(false)}
      />

      <ConfirmDialog request={confirm} onCancel={() => setConfirm(null)} />

      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
