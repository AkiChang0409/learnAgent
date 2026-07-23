import type { AppData } from '../types';

export type AppDataAction =
  | { type: 'replace'; value: AppData }
  | { type: 'update'; update: (current: AppData) => AppData };

export function appDataReducer(state: AppData, action: AppDataAction): AppData {
  return action.type === 'replace' ? action.value : action.update(state);
}
