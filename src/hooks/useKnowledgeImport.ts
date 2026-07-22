import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AppData, Conversation, MarkdownImportProgress, Note } from '../types';
import { createId, markdownDraftToNotes, nowIso, subjectKnowledgeMapToNotes } from '../services/notes';

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
  isGenerating,
  setSelectedSubject,
  setSelectedNoteId,
  pushToast
}: {
  data: AppData;
  setData: SetAppData;
  selectedSubject: string | null;
  isGenerating: boolean;
  setSelectedSubject: (subject: string | null) => void;
  setSelectedNoteId: (noteId: string) => void;
  pushToast: (type: ToastType, message: string) => void;
}) {
  const [isImportingMarkdown, setIsImportingMarkdown] = useState(false);
  const [importProgress, setImportProgress] = useState<MarkdownImportProgress | null>(null);

  useEffect(() => {
    return window.learnAgent.onMarkdownImportProgress((progress) => {
      setImportProgress(progress);
    });
  }, []);

  async function importMarkdown() {
    if (isImportingMarkdown || isGenerating) return;
    setIsImportingMarkdown(true);
    setImportProgress({
      stage: 'selecting-file',
      message: '准备导入 Markdown',
      percent: 0,
      updatedAt: nowIso()
    });
    try {
      const result = await window.learnAgent.importMarkdown({ settings: data.settings });
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
        message: '正在保存生成的主题和笔记',
        fileName: result.fileName,
        percent: 94,
        updatedAt: nowIso()
      });

      const subject = result.knowledgeMap?.subject || firstNote.subject || selectedSubject || '通用学习';
      const now = nowIso();
      const stampedNotes = importedNotes.map((note) => ({
        ...note,
        subject: note.subject || subject,
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
        message: `已保存 ${stampedNotes.length} 篇笔记`,
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
      setIsImportingMarkdown(false);
      window.setTimeout(() => {
        setImportProgress((current) => current?.stage === 'done' ? null : current);
      }, 3800);
    }
  }

  return {
    importMarkdown,
    isImportingMarkdown,
    importProgress
  };
}
