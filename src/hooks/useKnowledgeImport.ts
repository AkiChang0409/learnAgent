import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AgentPersonaRef, AppData, Conversation, MarkdownImportMode, MarkdownImportProgress, MarkdownSourceSelection, Note } from '../types';
import { cleanSubjectName, createId, ensureSubjects, markdownDraftToNotes, nowIso, subjectKnowledgeMapToNotes } from '../services/notes';

type SetAppData = Dispatch<SetStateAction<AppData>>;
type ToastType = 'success' | 'error' | 'info';

function noteSortValue(note: Note) {
  return note.position ?? Number.MAX_SAFE_INTEGER;
}

function rootNotePosition(notes: Note[], subject: string, topic: string) {
  const rootNotes = notes.filter((note) => !note.parentId && note.subject === subject && note.topic === topic);
  return rootNotes.length ? Math.max(...rootNotes.map(noteSortValue)) + 1 : 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}

export function useKnowledgeImport({
  data,
  setData,
  selectedSubject,
  setSelectedSubject,
  setSelectedNoteId,
  pushToast,
  personaRef
}: {
  data: AppData;
  setData: SetAppData;
  selectedSubject: string | null;
  setSelectedSubject: (subject: string | null) => void;
  setSelectedNoteId: (noteId: string) => void;
  pushToast: (type: ToastType, message: string) => void;
  personaRef: AgentPersonaRef;
}) {
  const [isImportingMarkdown, setIsImportingMarkdown] = useState(false);
  const [importProgress, setImportProgress] = useState<MarkdownImportProgress | null>(null);
  const [sourceSelection, setSourceSelection] = useState<MarkdownSourceSelection | null>(null);
  const activeSelectionId = useRef('');

  useEffect(() => {
    return window.learnAgent.onMarkdownImportProgress((progress) => {
      setImportProgress(progress);
    });
  }, []);

  async function importMarkdown() {
    if (isImportingMarkdown) return;
    try {
      const selection = await window.learnAgent.selectMarkdownSource();
      if (!selection.canceled) setSourceSelection(selection);
    } catch (error) {
      pushToast('error', `选择 Markdown 失败：${errorMessage(error)}`);
    }
  }

  async function startImport(mode: MarkdownImportMode) {
    if (!sourceSelection || isImportingMarkdown) return;
    const selection = sourceSelection;
    activeSelectionId.current = selection.selectionId;
    setSourceSelection(null);
    setIsImportingMarkdown(true);
    setImportProgress({
      stage: 'selecting-file',
      message: '准备文档',
      phaseTitle: '准备文档',
      phaseCurrent: 1,
      phaseTotal: 5,
      taskMessage: `正在准备“${selection.fileName}”`,
      fileName: selection.fileName,
      percent: 0,
      updatedAt: nowIso()
    });
    try {
      const result = await window.learnAgent.startMarkdownImport({
        selectionId: selection.selectionId,
        mode,
        personaRef,
        settings: data.settings
      });
      if (result.canceled) {
        setImportProgress(null);
        return;
      }
      if (!result.knowledgeMap && !result.root) {
        pushToast('error', '导入失败：未生成有效笔记结构');
        setImportProgress({
          stage: 'error',
          message: '未生成有效笔记结构',
          percent: 100,
          updatedAt: nowIso()
        });
        return;
      }

      const importedNotes = result.knowledgeMap
        ? subjectKnowledgeMapToNotes(result.knowledgeMap)
        : result.root
          ? markdownDraftToNotes(result.root)
          : [];
      const firstNote = importedNotes[0];
      if (!firstNote) {
        pushToast('error', '导入失败：Markdown 内容为空或无法整理');
        setImportProgress({
          stage: 'error',
          message: 'Markdown 内容为空或无法整理',
          percent: 100,
          updatedAt: nowIso()
        });
        return;
      }

      setImportProgress({
        stage: 'saving',
        message: '保存生成的笔记',
        phaseTitle: '保存生成的笔记',
        phaseCurrent: 5,
        phaseTotal: 5,
        taskMessage: `正在保存 ${importedNotes.length} 篇笔记`,
        fileName: result.fileName,
        current: 0,
        total: importedNotes.length,
        percent: 95,
        updatedAt: nowIso()
      });

      const subject = cleanSubjectName(selectedSubject || result.knowledgeMap?.subject || firstNote.subject);
      const now = nowIso();
      const stampedNotes = importedNotes.map((note) => ({
        ...note,
        subject: selectedSubject ? subject : cleanSubjectName(note.subject || subject),
        topic: note.topic || note.title || '未命名主题',
        updatedAt: now
      }));
      const conversations: Conversation[] = stampedNotes.map((note) => ({
        id: createId('conversation'),
        noteId: note.id,
        title: note.title,
        messages: [],
        updatedAt: now
      }));

      setData((current) => {
        const rootPositionByGroup = new Map<string, number>();
        const positionedNotes = stampedNotes.map((note) => {
          if (note.parentId) {
            return {
              ...note,
              position: note.position ?? 0
            };
          }
          const key = `${note.subject || subject}\u0000${note.topic || '未命名主题'}`;
          const position = rootPositionByGroup.get(key)
            ?? rootNotePosition(current.notes, note.subject || subject, note.topic || '未命名主题');
          rootPositionByGroup.set(key, position + 1);
          return {
            ...note,
            parentId: undefined,
            position
          };
        });

        return {
          ...current,
          subjects: ensureSubjects({
            subjects: current.subjects || [],
            notes: [...positionedNotes, ...current.notes]
          }),
          notes: [
            ...positionedNotes,
            ...current.notes
          ],
          conversations: [...conversations, ...current.conversations],
          usageRecords: result.usageRecord
            ? [...(current.usageRecords || []), result.usageRecord].slice(-1000)
            : current.usageRecords
        };
      });
      setSelectedSubject(subject);
      setSelectedNoteId(firstNote.id);
      setImportProgress({
        stage: 'done',
        message: '笔记生成完成',
        phaseTitle: '笔记生成完成',
        phaseCurrent: 5,
        phaseTotal: 5,
        taskMessage: `已保存 ${stampedNotes.length} 篇笔记`,
        fileName: result.fileName,
        current: stampedNotes.length,
        total: stampedNotes.length,
        percent: 100,
        updatedAt: nowIso()
      });
      pushToast(
        result.usedFallback ? 'info' : 'success',
        `${result.message || '已从 Markdown 生成知识地图'}：${stampedNotes.length} 篇笔记`
      );
    } catch (error) {
      const message = `导入 Markdown 失败：${errorMessage(error)}`;
      setImportProgress({
        stage: 'error',
        message,
        percent: 100,
        updatedAt: nowIso()
      });
      pushToast('error', message);
    } finally {
      activeSelectionId.current = '';
      setIsImportingMarkdown(false);
      window.setTimeout(() => {
        setImportProgress((current) => current?.stage === 'done' ? null : current);
      }, 3800);
    }
  }

  async function cancelImport() {
    if (!sourceSelection && !activeSelectionId.current) return;
    const selectionId = sourceSelection?.selectionId || activeSelectionId.current;
    setSourceSelection(null);
    await window.learnAgent.cancelMarkdownImport({ selectionId });
  }

  return {
    importMarkdown,
    startImport,
    cancelImport,
    sourceSelection,
    isImportingMarkdown,
    importProgress
  };
}
