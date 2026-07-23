import { useCallback, useEffect, useReducer, useState, type Dispatch, type SetStateAction } from 'react';
import type { AppData } from '../types';
import { emptyData, ensureSubjects } from '../services/notes';
import { appDataReducer } from '../domain/app-data-reducer';

export function useAppData() {
  const [data, dispatchData] = useReducer(appDataReducer, emptyData);
  const setData: Dispatch<SetStateAction<AppData>> = useCallback((next) => {
    if (typeof next === 'function') {
      dispatchData({ type: 'update', update: next as (current: AppData) => AppData });
    } else {
      dispatchData({ type: 'replace', value: next });
    }
  }, []);
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [dataPath, setDataPath] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let mounted = true;
    Promise.all([window.learnAgent.loadSnapshot(), window.learnAgent.getDataFilePath()])
      .then(([snapshot, filePath]) => {
        if (!mounted) return;
        const loaded = snapshot.data;
        const merged: AppData = {
          ...emptyData,
          ...loaded,
          subjects: ensureSubjects({
            subjects: loaded.subjects || [],
            notes: loaded.notes || []
          }),
          usageRecords: loaded.usageRecords || [],
          settings: { ...emptyData.settings, ...loaded.settings }
        };
        setData(merged);
        setSelectedNoteId('');
        setDataPath(filePath);
        setRevision(snapshot.revision);
        setIsReady(true);
      })
      .catch((error) => {
        if (!mounted) return;
        setData(emptyData);
        setLoadError(`读取本地数据失败：${error?.message || '未知错误'}`);
        setIsReady(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { data, setData, selectedNoteId, setSelectedNoteId, dataPath, isReady, loadError, revision };
}
