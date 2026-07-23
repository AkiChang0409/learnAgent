import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppData, AppDataChanges } from '../types';

export type SaveState = 'idle' | 'saving' | 'received' | 'saved' | 'error';

function entityChanges<T extends { id: string }>(before: T[], after: T[]) {
  const oldById = new Map(before.map((item) => [item.id, item]));
  const nextIds = new Set(after.map((item) => item.id));
  const upsert = after.filter((item) => JSON.stringify(oldById.get(item.id)) !== JSON.stringify(item));
  const deleteIds = before.filter((item) => !nextIds.has(item.id)).map((item) => item.id);
  return upsert.length || deleteIds.length ? { upsert, deleteIds } : undefined;
}

export function createChangeBatch(before: AppData, after: AppData): AppDataChanges {
  const changes: AppDataChanges = {
    subjects: entityChanges(before.subjects, after.subjects),
    notes: entityChanges(before.notes, after.notes),
    conversations: entityChanges(before.conversations, after.conversations),
    usageRecords: entityChanges(before.usageRecords, after.usageRecords)
  };
  if (JSON.stringify(before.settings) !== JSON.stringify(after.settings)) changes.settings = after.settings;
  return changes;
}

function hasChanges(changes: AppDataChanges) {
  return Object.values(changes).some(Boolean);
}

export function useAutosave(
  data: AppData,
  isReady: boolean,
  initialRevision: number,
  onError: (message: string) => void
) {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimer = useRef<number | undefined>(undefined);
  const acceptedData = useRef<AppData | null>(null);
  const revision = useRef(initialRevision);
  const saveQueue = useRef(Promise.resolve());
  const latestData = useRef(data);
  const failedSnapshot = useRef<AppData | null>(null);
  const failedNeedsFlush = useRef(false);

  latestData.current = data;

  const enqueueSave = useCallback((snapshot: AppData) => {
    setSaveState('saving');
    saveQueue.current = saveQueue.current.then(async () => {
      const changes = createChangeBatch(acceptedData.current || snapshot, snapshot);
      if (!hasChanges(changes)) {
        setSaveState('idle');
        return;
      }
      const result = await window.learnAgent.applyChanges({ baseRevision: revision.current, changes });
      revision.current = result.revision;
      acceptedData.current = snapshot;
      failedSnapshot.current = null;
      setSaveState('received');
      try {
        await window.learnAgent.flushData();
        failedNeedsFlush.current = false;
      } catch (error) {
        failedNeedsFlush.current = true;
        throw error;
      }
      setSaveState('saved');
      window.setTimeout(() => setSaveState('idle'), 1400);
    }).catch((error) => {
      failedSnapshot.current = snapshot;
      setSaveState('error');
      onError(`保存失败：${error?.message || '未知错误'}`);
    });
  }, [onError]);

  const retrySave = useCallback(() => {
    if (failedNeedsFlush.current) {
      setSaveState('saving');
      saveQueue.current = saveQueue.current.then(async () => {
        await window.learnAgent.flushData();
        failedNeedsFlush.current = false;
        failedSnapshot.current = null;
        setSaveState('saved');
        window.setTimeout(() => setSaveState('idle'), 1400);
      }).catch((error) => {
        setSaveState('error');
        onError(`保存失败：${error?.message || '未知错误'}`);
      });
      return;
    }
    enqueueSave(failedSnapshot.current || latestData.current);
  }, [enqueueSave, onError]);

  useEffect(() => {
    if (!isReady) return;
    if (!acceptedData.current) {
      acceptedData.current = data;
      revision.current = initialRevision;
      return;
    }
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      enqueueSave(data);
    }, 450);

    return () => window.clearTimeout(saveTimer.current);
  }, [data, enqueueSave, isReady, initialRevision]);

  return { saveState, retrySave };
}
