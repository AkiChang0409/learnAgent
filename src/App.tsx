import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2, Loader2, Sparkles, Upload } from 'lucide-react';
import type {
  AiSettings,
  AppUpdateState,
  ChatMessage,
  Conversation,
  EmphasisAnalysisProgress,
  Note,
  NoteDistillationPatch,
  NoteGenerationProgress,
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
import { ImportModeDialog } from './components/ImportModeDialog';
import { NoteView, type ListChangeKind, type ListField } from './components/NoteView';
import { NoteGenerationPanel } from './components/NoteGenerationPanel';
import { EmphasisAnalysisPanel } from './components/EmphasisAnalysisPanel';
import { SettingsView } from './components/SettingsView';
import { ToastHost, type ToastMessage } from './components/ToastHost';
import { TipsDialog } from './components/TipsDialog';
import { useAppData } from './hooks/useAppData';
import { useAutosave } from './hooks/useAutosave';
import { useKnowledgeImport } from './hooks/useKnowledgeImport';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { cleanSubjectName, createId, draftToNote, ensureSubjects, nowIso } from './services/notes';
import { retrieveContext } from './services/rag';
import { applyEmphasisToDocument, appendRichTextDocument, richContentFromDraft, textToRichDocument } from './services/rich-text';
import { applyTheme, resolveTheme } from './theme';
import { mergeTopicNames, moveNoteInTree, removeNoteWithPromotedChildren, restoreRemovedNote, rootNotePosition, selectMostRecentNoteForSubject } from './domain/library';

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

interface NoteUndoEntry {
  id: string;
  label: string;
  undo: () => void;
}

export default function App() {
  const [appVersion, setAppVersion] = useState('');
  const [updateState, setUpdateState] = useState<AppUpdateState>({
    status: 'idle',
    message: '将在后台自动检查更新'
  });
  const { data, setData, selectedNoteId, setSelectedNoteId, dataPath, isReady, loadError, revision } = useAppData();
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [composer, setComposer] = useState('');
  const [noteSearch, setNoteSearch] = useState('');
  const [showTips, setShowTips] = useState(false);
  const [searchResults, setSearchResults] = useState<Note[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [noteGenerationTasks, setNoteGenerationTasks] = useState<NoteGenerationProgress[]>([]);
  const completedGenerationTasks = useRef(new Set<string>());
  const [emphasisAnalysisTasks, setEmphasisAnalysisTasks] = useState<EmphasisAnalysisProgress[]>([]);
  const appliedEmphasisResults = useRef(new Set<string>());
  const [isAsking, setIsAsking] = useState(false);
  const [isDistilling, setIsDistilling] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [view, setView] = useState<'note' | 'settings'>('note');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const noteUndoStack = useRef<NoteUndoEntry[]>([]);

  useEffect(() => {
    window.learnAgent.getAppInfo().then((info) => setAppVersion(info.version)).catch(() => setAppVersion('未知'));
  }, []);

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

  const pushNoteUndo = useCallback((label: string, undo: () => void) => {
    const id = createId('undo');
    noteUndoStack.current = [...noteUndoStack.current, { id, label, undo }].slice(-50);
    return id;
  }, []);

  const undoNoteChange = useCallback((entryId?: string) => {
    const stack = noteUndoStack.current;
    const index = entryId ? stack.findIndex((entry) => entry.id === entryId) : stack.length - 1;
    if (index < 0) return false;
    const [entry] = stack.splice(index, 1);
    noteUndoStack.current = [...stack];
    entry.undo();
    pushToast('info', `已撤销：${entry.label}`);
    return true;
  }, [pushToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z') return;
      if (confirm || view !== 'note') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!noteUndoStack.current.length) return;
      event.preventDefault();
      undoNoteChange();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirm, undoNoteChange, view]);

  useEffect(() => {
    window.learnAgent.getUpdateState().then(setUpdateState).catch(() => undefined);
    return window.learnAgent.onUpdateStatus((nextState) => {
      setUpdateState(nextState);
      if (nextState.status === 'available') {
        pushToast('info', nextState.message, {
          action: { label: '更新', onClick: () => void downloadUpdate() },
          duration: 15_000
        });
      } else if (nextState.status === 'downloaded') {
        pushToast('success', nextState.message, {
          action: { label: '立即重启', onClick: () => void window.learnAgent.installUpdate() },
          duration: 15_000
        });
      }
    });
  }, [pushToast]);

  useEffect(() => window.learnAgent.onNoteGenerationProgress((progress) => {
    setNoteGenerationTasks((current) => {
      const exists = current.some((task) => task.taskId === progress.taskId);
      return exists
        ? current.map((task) => task.taskId === progress.taskId ? progress : task)
        : [...current, progress];
    });

    if (progress.stage === 'error') {
      pushToast('error', `生成失败：${progress.error || '未知错误'}`);
      return;
    }
    if (progress.stage !== 'done' || !progress.result || completedGenerationTasks.current.has(progress.taskId)) return;
    completedGenerationTasks.current.add(progress.taskId);

    const draftNote = draftToNote(progress.result.draft);
    const subject = cleanSubjectName(progress.targetSubject || draftNote.subject);
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
      notes: [{ ...note, position: rootNotePosition(current.notes, subject, topic) }, ...current.notes],
      conversations: [conversation, ...current.conversations],
      usageRecords: progress.result?.usageRecord
        ? [...(current.usageRecords || []), progress.result.usageRecord].slice(-1000)
        : current.usageRecords
    }));
    pushToast(progress.result.usedFallback ? 'info' : 'success', progress.result.message || '笔记生成完成', {
      action: {
        label: '查看笔记',
        onClick: () => {
          setSelectedNoteId(note.id);
          setSelectedSubject(subject);
          setView('note');
        }
      },
      duration: 8000
    });
    window.setTimeout(() => {
      setNoteGenerationTasks((current) => current.filter((task) => task.taskId !== progress.taskId));
      completedGenerationTasks.current.delete(progress.taskId);
    }, 6500);
  }), [pushToast, setData, setSelectedNoteId]);

  useEffect(() => window.learnAgent.onEmphasisAnalysisProgress((progress) => {
    setEmphasisAnalysisTasks((current) => {
      const exists = current.some((task) => task.taskId === progress.taskId);
      return exists
        ? current.map((task) => task.taskId === progress.taskId ? progress : task)
        : [...current, progress];
    });

    if (progress.stage === 'applying' && progress.noteId && progress.patch) {
      const resultKey = `${progress.taskId}:${progress.noteId}`;
      if (!appliedEmphasisResults.current.has(resultKey)) {
        appliedEmphasisResults.current.add(resultKey);
        setData((current) => ({
          ...current,
          notes: current.notes.map((note) => {
            if (note.id !== progress.noteId) return note;
            const sectionPlans = new Map(progress.patch?.sections.map((section) => [section.sectionId, section.emphasis]));
            return {
              ...note,
              summaryRich: applyEmphasisToDocument(note.summaryRich, note.summary, progress.patch!.summary, false),
              sections: note.sections.map((section) => {
                const emphasis = sectionPlans.get(section.id);
                return emphasis
                  ? { ...section, contentRich: applyEmphasisToDocument(section.contentRich, section.content, emphasis) }
                  : section;
              }),
              updatedAt: nowIso()
            };
          }),
          usageRecords: progress.usageRecord
            ? [...(current.usageRecords || []), progress.usageRecord].slice(-1000)
            : current.usageRecords
        }));
      }
      return;
    }
    if (progress.stage === 'error') {
      pushToast('error', `重点分析失败：${progress.error || '未知错误'}`);
      return;
    }
    if (progress.stage !== 'done') return;
    pushToast(progress.usedFallback ? 'info' : 'success', progress.message || '重点分析完成');
    window.setTimeout(() => {
      setEmphasisAnalysisTasks((current) => current.filter((task) => task.taskId !== progress.taskId));
      for (const key of appliedEmphasisResults.current) {
        if (key.startsWith(`${progress.taskId}:`)) appliedEmphasisResults.current.delete(key);
      }
    }, 6500);
  }), [pushToast, setData]);

  const theme = resolveTheme(data.settings.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (loadError) pushToast('error', loadError);
  }, [loadError, pushToast]);

  const { saveState, retrySave } = useAutosave(data, isReady, revision, (message) => pushToast('error', message));

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
        const topics = mergeTopicNames(subject.topics, notes);
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

  // Topics explicitly declared on the current subject (incl. ones with no notes yet).
  const currentSubjectTopics = useMemo(() => {
    if (!selectedSubject) return [];
    const subject = (data.subjects || []).find(
      (item) => cleanSubjectName(item.name) === selectedSubject
    );
    return subject?.topics || [];
  }, [data.subjects, selectedSubject]);

  // Focus the first subject on first load so "New note" has a sensible home,
  // and recover if the currently-focused subject was deleted.
  useEffect(() => {
    if (!isReady) return;
    setSelectedSubject((current) =>
      current && subjectSummaries.some((subject) => subject.name === current)
        ? current
        : subjectSummaries[0]?.name ?? null
    );
  }, [isReady, subjectSummaries]);

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

  const { importMarkdown, startImport, cancelImport, sourceSelection, isImportingMarkdown, importProgress } = useKnowledgeImport({
    data,
    setData,
    selectedSubject,
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
        topics: [],
        createdAt: updatedAt,
        updatedAt
      },
      ...subjects
    ];
  }

  // Ensure `subject` exists and has `topic` declared, so an empty topic persists
  // even before it holds any notes.
  function addTopicToSubject(subjects: Subject[], name: string, topic: string, updatedAt = nowIso()): Subject[] {
    const cleanName = cleanSubjectName(name);
    const cleanTopic = topic.trim();
    if (!cleanTopic) return subjects;
    const ensured = upsertSubject(subjects, cleanName, updatedAt);
    return ensured.map((subject) => {
      if (cleanSubjectName(subject.name).toLowerCase() !== cleanName.toLowerCase()) return subject;
      const topics = subject.topics || [];
      if (topics.some((item) => item.trim().toLowerCase() === cleanTopic.toLowerCase())) return subject;
      return { ...subject, topics: [...topics, cleanTopic], updatedAt };
    });
  }

  function topicExists(subjectName: string, topic: string) {
    const cleanName = cleanSubjectName(subjectName);
    const cleanTopic = topic.trim().toLowerCase();
    const declared = (data.subjects || [])
      .find((subject) => cleanSubjectName(subject.name).toLowerCase() === cleanName.toLowerCase())
      ?.topics || [];
    const fromNotes = data.notes
      .filter((note) => cleanSubjectName(note.subject).toLowerCase() === cleanName.toLowerCase())
      .map((note) => (note.topic.trim() || '未命名主题'));
    return [...declared, ...fromNotes].some((item) => item.trim().toLowerCase() === cleanTopic);
  }

  function createTopic(rawName: string) {
    const name = rawName.trim();
    if (!name) {
      pushToast('error', '请输入主题名称');
      return;
    }
    if (!selectedSubject) {
      pushToast('error', '请先在左上角选择或新建学科');
      return;
    }
    const subjectName = cleanSubjectName(selectedSubject);
    if (topicExists(subjectName, name)) {
      pushToast('error', '这个主题已经存在');
      return;
    }
    const now = nowIso();
    setData((current) => ({
      ...current,
      subjects: addTopicToSubject(current.subjects || [], subjectName, name, now)
    }));
    pushToast('success', '已创建主题');
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
    setConfirm({
      title: `删除学科「${subject.name}」`,
      message: subject.noteCount > 0
        ? `这会一并删除该学科下的 ${subject.noteCount} 篇笔记和相关对话，且无法撤销。`
        : '删除这个空学科后无法撤销。',
      confirmLabel: '删除学科',
      onConfirm: () => performDeleteSubject(subject)
    });
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
      const targetSubject = cleanSubjectName(selectedSubject);
      const { taskId } = await window.learnAgent.startNoteGeneration({ input, targetSubject, settings: data.settings });
      setNoteGenerationTasks((current) => current.some((task) => task.taskId === taskId) ? current : [...current, {
        taskId,
        stage: 'queued',
        message: '已加入后台生成队列',
        percent: 4,
        input,
        targetSubject,
        updatedAt: nowIso()
      }]);
      setComposer('');
      setShowGenerate(false);
      pushToast('info', '已转入后台生成，你可以继续使用其他功能');
    } catch (error) {
      pushToast('error', `生成失败：${errorMessage(error)}`);
    } finally {
      setIsGenerating(false);
    }
  }

  function createBlankNote(topicArg?: string) {
    const now = nowIso();
    const subject = cleanSubjectName(selectedSubject);
    const topic = (topicArg || '').trim() || '未命名主题';
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
      subjects: addTopicToSubject(current.subjects || [], subject, topic, now),
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
    const removal = removeNoteWithPromotedChildren(data.notes, removed.id);
    const directChildIds = removal.directChildIds;
    const childCount = directChildIds.length;
    const remainingInSubject = data.notes.filter(
      (note) => note.id !== removed.id && cleanSubjectName(note.subject) === cleanSubjectName(removed.subject)
    );

    const restore = () => {
      setData((current) => {
        if (current.notes.some((note) => note.id === removed.id)) return current;
        return {
          ...current,
          notes: restoreRemovedNote(current.notes, removed, directChildIds),
          conversations:
            removedConversation && !current.conversations.some((conversation) => conversation.id === removedConversation.id)
              ? [removedConversation, ...current.conversations]
              : current.conversations
        };
      });
      setSelectedSubject(cleanSubjectName(removed.subject));
      setSelectedNoteId(removed.id);
    };

    const undoId = pushNoteUndo('删除笔记', restore);
    setData((current) => ({
      ...current,
      notes: removeNoteWithPromotedChildren(current.notes, removed.id).notes,
      conversations: current.conversations.filter((conversation) => conversation.noteId !== removed.id)
    }));
    setSelectedNoteId(remainingInSubject[0]?.id || '');

    const detail = childCount ? `已删除「${removed.title || '未命名笔记'}」，${childCount} 篇子笔记已上移` : `已删除「${removed.title || '未命名笔记'}」`;
    pushToast('info', detail, { action: { label: '撤销', onClick: () => undoNoteChange(undoId) }, duration: 8000 });
  }

  function moveNote(
    draggedId: string,
    targetId: string | null,
    placement: NoteDropPlacement,
    targetTopic?: string,
    targetSubject?: string
  ) {
    const movedAt = nowIso();
    const preview = moveNoteInTree(data.notes, {
      draggedId, targetId, placement, targetTopic, targetSubject, movedAt
    });
    if (preview === data.notes) return;
    const hierarchyBefore = new Map(data.notes.map((note) => [note.id, {
      parentId: note.parentId,
      position: note.position,
      subject: note.subject,
      topic: note.topic,
      updatedAt: note.updatedAt
    }]));
    pushNoteUndo('移动笔记', () => {
      setData((current) => ({
        ...current,
        notes: current.notes.map((note) => {
          const before = hierarchyBefore.get(note.id);
          return before ? { ...note, ...before } : note;
        })
      }));
    });
    setData((current) => {
      const notes = moveNoteInTree(current.notes, {
        draggedId, targetId, placement, targetTopic, targetSubject, movedAt
      });
      return notes === current.notes ? current : { ...current, notes };
    });
  }

  async function analyzeSubjectEmphasis() {
    if (!selectedNote) return;
    const subject = cleanSubjectName(selectedNote.subject);
    const notes = data.notes.filter((note) => cleanSubjectName(note.subject) === subject);
    if (!notes.length || emphasisAnalysisTasks.some((task) => task.subject === subject && task.stage !== 'done' && task.stage !== 'error')) return;
    try {
      await window.learnAgent.startEmphasisAnalysis({
        subject,
        notes: notes.map((note) => ({
          id: note.id,
          title: note.title,
          summary: note.summary,
          sections: note.sections.map((section) => ({
            id: section.id,
            heading: section.heading,
            content: section.content
          }))
        })),
        settings: data.settings
      });
      pushToast('info', `已在后台分析“${subject}”的 ${notes.length} 篇笔记`);
    } catch (error) {
      pushToast('error', `无法启动重点分析：${errorMessage(error)}`);
    }
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
    if (!selectedNote) return;
    const noteId = selectedNote.id;
    const section = { id: createId('section'), heading: '新小节', content: '' };
    const undoId = pushNoteUndo('添加小节', () => {
      setData((current) => ({
        ...current,
        notes: current.notes.map((note) => note.id === noteId
          ? { ...note, sections: note.sections.filter((item) => item.id !== section.id), updatedAt: nowIso() }
          : note)
      }));
    });
    updateSelectedNote((note) => ({
      ...note,
      sections: [...note.sections, section]
    }));
    return undoId;
  }

  function removeSection(sectionId: string) {
    if (!selectedNote) return;
    const noteId = selectedNote.id;
    const index = selectedNote.sections.findIndex((section) => section.id === sectionId);
    const removed = selectedNote.sections[index];
    if (!removed) return;
    const undoId = pushNoteUndo('删除小节', () => {
      setData((current) => ({
        ...current,
        notes: current.notes.map((note) => {
          if (note.id !== noteId || note.sections.some((section) => section.id === removed.id)) return note;
          const sections = [...note.sections];
          sections.splice(Math.min(index, sections.length), 0, removed);
          return { ...note, sections, updatedAt: nowIso() };
        })
      }));
    });
    updateSelectedNote((note) => ({
      ...note,
      sections: note.sections.filter((section) => section.id !== sectionId)
    }));
    pushToast('info', `已删除小节「${removed.heading || '未命名小节'}」`, {
      action: { label: '撤销', onClick: () => undoNoteChange(undoId) },
      duration: 8000
    });
  }

  function moveSection(sectionId: string, direction: -1 | 1) {
    if (!selectedNote) return;
    const noteId = selectedNote.id;
    const previousOrder = selectedNote.sections.map((section) => section.id);
    pushNoteUndo('移动小节', () => {
      setData((current) => ({
        ...current,
        notes: current.notes.map((note) => {
          if (note.id !== noteId) return note;
          const byId = new Map(note.sections.map((section) => [section.id, section]));
          const ordered = previousOrder.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
          const extras = note.sections.filter((section) => !previousOrder.includes(section.id));
          return { ...note, sections: [...ordered, ...extras], updatedAt: nowIso() };
        })
      }));
    });
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

  function updateList(field: ListField, values: string[], kind: ListChangeKind = 'edit') {
    if (kind !== 'edit' && selectedNote) {
      const noteId = selectedNote.id;
      const previousValues = [...selectedNote[field]];
      const undoId = pushNoteUndo(kind === 'remove' ? '删除笔记条目' : '添加笔记条目', () => {
        setData((current) => ({
          ...current,
          notes: current.notes.map((note) => note.id === noteId
            ? { ...note, [field]: previousValues, updatedAt: nowIso() }
            : note)
        }));
      });
      if (kind === 'remove') {
        pushToast('info', '已删除一项', {
          action: { label: '撤销', onClick: () => undoNoteChange(undoId) },
          duration: 8000
        });
      }
    }
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
      const addition = appendRichTextDocument(
        textToRichDocument(`对话补充（${stampedTitle}）`),
        '',
        richContentFromDraft(section.blocks, content)
      );
      if (existingIndex >= 0) {
        const existing = nextSections[existingIndex];
        nextSections[existingIndex] = {
          ...existing,
          content: [existing.content.trim(), block].filter(Boolean).join('\n\n'),
          contentRich: appendRichTextDocument(existing.contentRich, existing.content, addition)
        };
      } else {
        nextSections.push({
          id: createId('section'),
          heading,
          content: block,
          contentRich: addition
        });
      }
    });

    return {
      ...note,
      summary: summaryAppend
        ? [note.summary.trim(), `对话补充（${stampedTitle}）\n${summaryAppend}`].filter(Boolean).join('\n\n')
        : note.summary,
      summaryRich: summaryAppend
        ? appendRichTextDocument(
            note.summaryRich,
            note.summary,
            textToRichDocument(`对话补充（${stampedTitle}）\n${summaryAppend}`, false),
            false
          )
        : note.summaryRich,
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

  async function setApiKey(value: string) {
    try {
      await window.learnAgent.setApiKey(value);
      setData((current) => ({
        ...current,
        settings: { ...current.settings, apiKeyConfigured: true }
      }));
      pushToast('success', 'API Key 已使用系统安全存储加密');
    } catch (error) {
      pushToast('error', `保存 API Key 失败：${errorMessage(error)}`);
      throw error;
    }
  }

  async function clearApiKey() {
    try {
      await window.learnAgent.clearApiKey();
      setData((current) => ({
        ...current,
        settings: { ...current.settings, apiKeyConfigured: false }
      }));
      pushToast('success', 'API Key 已清除');
    } catch (error) {
      pushToast('error', `清除 API Key 失败：${errorMessage(error)}`);
    }
  }

  async function requestClearApiKey() {
    setConfirm({
      title: '清除 API Key',
      message: '保存的 API Key 将从系统安全存储中永久删除，且无法撤销。',
      confirmLabel: '清除密钥',
      onConfirm: () => void clearApiKey()
    });
  }

  function updateTheme(nextTheme: ThemeId) {
    setData((current) => ({ ...current, settings: { ...current.settings, theme: nextTheme } }));
  }

  function openNote(noteId: string, subject: string) {
    setSelectedNoteId(noteId);
    setSelectedSubject(cleanSubjectName(subject));
    setView('note');
  }

  function switchSubject(name: string) {
    const subject = cleanSubjectName(name);
    const nextNote = selectMostRecentNoteForSubject(data.notes, subject);
    setSelectedSubject(subject);
    setSelectedNoteId(nextNote?.id || '');
    setNoteSearch('');
    setView('note');
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

  async function checkForUpdates() {
    try {
      const state = await window.learnAgent.checkForUpdates();
      setUpdateState(state);
    } catch (error) {
      pushToast('error', `检查更新失败：${errorMessage(error)}`);
    }
  }

  async function installUpdate() {
    try {
      const result = await window.learnAgent.installUpdate();
      if (!result.ok) pushToast('error', result.message || '更新尚未准备好');
    } catch (error) {
      pushToast('error', `安装更新失败：${errorMessage(error)}`);
    }
  }

  async function downloadUpdate() {
    try {
      const result = await window.learnAgent.downloadUpdate();
      setUpdateState(result.state);
      if (!result.ok) pushToast('error', result.message || '暂时无法下载更新');
    } catch (error) {
      pushToast('error', `下载更新失败：${errorMessage(error)}`);
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
        currentSubject={selectedSubject}
        currentSubjectTopics={currentSubjectTopics}
        selectedNoteId={selectedNoteId}
        isSettingsOpen={view === 'settings'}
        isTipsOpen={showTips}
        noteSearch={noteSearch}
        searchResults={searchResults}
        saveState={saveState}
        onRetrySave={retrySave}
        isImporting={isImportingMarkdown}
        onSearchChange={setNoteSearch}
        onSwitchSubject={switchSubject}
        onSelectNote={openNote}
        onCreateSubject={createSubject}
        onRenameSubject={renameSubject}
        onDeleteSubject={deleteSubject}
        onCreateTopic={createTopic}
        onCreateNoteInTopic={(topic) => createBlankNote(topic)}
        onMoveNote={moveNote}
        onNewBlank={() => createBlankNote()}
        onNewGenerate={openGenerate}
        onImport={importMarkdown}
        onOpenTips={() => setShowTips(true)}
        onOpenSettings={() => setView((current) => (current === 'settings' ? 'note' : 'settings'))}
      />

      <main className="stage">
        {view === 'settings' ? (
          <SettingsView
            settings={data.settings}
            theme={theme}
            usageRecords={data.usageRecords}
            dataPath={dataPath}
            appVersion={appVersion || '…'}
            updateState={updateState}
            isTesting={isTestingConnection}
            isSyncing={isSyncing}
            onBack={() => setView('note')}
            onChange={updateSettings}
            onSetApiKey={setApiKey}
            onClearApiKey={requestClearApiKey}
            onThemeChange={updateTheme}
            onTestConnection={testConnection}
            onExportSync={exportSyncPackage}
            onImportSync={importSyncPackage}
            onCheckForUpdates={() => void checkForUpdates()}
            onDownloadUpdate={() => void downloadUpdate()}
            onInstallUpdate={() => void installUpdate()}
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
            onNavigateSubject={switchSubject}
            onAnalyzeEmphasis={analyzeSubjectEmphasis}
            isAnalyzingEmphasis={emphasisAnalysisTasks.some((task) =>
              task.subject === cleanSubjectName(selectedNote.subject) && task.stage !== 'done' && task.stage !== 'error'
            )}
            subjectNoteCount={data.notes.filter((note) => cleanSubjectName(note.subject) === cleanSubjectName(selectedNote.subject)).length}
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
              <button className="primary-action" type="button" onClick={() => createBlankNote()}>
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

        {(importProgress || noteGenerationTasks.length > 0 || emphasisAnalysisTasks.length > 0) && (
          <div className="stage-progress">
            {importProgress && <ImportProgressPanel progress={importProgress} onCancel={cancelImport} />}
            <NoteGenerationPanel
              tasks={noteGenerationTasks}
              onDismiss={(taskId) => setNoteGenerationTasks((current) => current.filter((task) => task.taskId !== taskId))}
            />
            <EmphasisAnalysisPanel
              tasks={emphasisAnalysisTasks}
              onDismiss={(taskId) => setEmphasisAnalysisTasks((current) => current.filter((task) => task.taskId !== taskId))}
            />
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

      <ImportModeDialog selection={sourceSelection} onStart={startImport} onClose={cancelImport} />

      <TipsDialog
        open={showTips}
        onClose={() => setShowTips(false)}
        onCopied={() => pushToast('success', '已复制 Codex 项目分析 Skill，可粘贴到你的 Codex 项目中')}
      />

      <ConfirmDialog request={confirm} onCancel={() => setConfirm(null)} />

      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
