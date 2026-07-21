import { useEffect, useState } from 'react';
import type { AppData } from '../types';
import { emptyData } from '../services/notes';

export function useAppData() {
  const [data, setData] = useState<AppData>(emptyData);
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [dataPath, setDataPath] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let mounted = true;
    Promise.all([window.learnAgent.loadData(), window.learnAgent.getDataFilePath()])
      .then(([loaded, filePath]) => {
        if (!mounted) return;
        const merged: AppData = {
          ...emptyData,
          ...loaded,
          usageRecords: loaded.usageRecords || [],
          settings: { ...emptyData.settings, ...loaded.settings }
        };
        setData(merged);
        setSelectedNoteId('');
        setDataPath(filePath);
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

  return { data, setData, selectedNoteId, setSelectedNoteId, dataPath, isReady, loadError };
}
