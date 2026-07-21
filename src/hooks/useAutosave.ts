import { useEffect, useRef, useState } from 'react';
import type { AppData } from '../types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function useAutosave(
  data: AppData,
  isReady: boolean,
  onError: (message: string) => void
) {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!isReady) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setSaveState('saving');
      window.learnAgent
        .saveData(data)
        .then(() => {
          setSaveState('saved');
          window.setTimeout(() => setSaveState('idle'), 1400);
        })
        .catch((error) => {
          setSaveState('error');
          onError(`保存失败：${error?.message || '未知错误'}`);
        });
    }, 450);

    return () => window.clearTimeout(saveTimer.current);
  }, [data, isReady, onError]);

  return saveState;
}
