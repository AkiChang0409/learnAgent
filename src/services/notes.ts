import type { AppData, GeneratedNoteDraft, Note } from '../types';

export const emptyData: AppData = {
  notes: [],
  conversations: [],
  settings: {
    provider: 'local',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4.1-mini',
    apiKey: ''
  }
};

export function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function draftToNote(draft: GeneratedNoteDraft): Note {
  const now = nowIso();
  return {
    id: createId('note'),
    title: draft.title || draft.topic || '未命名笔记',
    subject: draft.subject || '通用学习',
    topic: draft.topic || draft.title || '未命名主题',
    tags: normalizeList(draft.tags),
    summary: draft.summary || '',
    sections: (draft.sections || []).map((section) => ({
      id: createId('section'),
      heading: section.heading || '小节',
      content: section.content || ''
    })),
    cases: normalizeList(draft.cases),
    pitfalls: normalizeList(draft.pitfalls),
    interviewQuestions: normalizeList(draft.interviewQuestions),
    createdAt: now,
    updatedAt: now
  };
}

export function normalizeList(values: unknown) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value).trim()).filter(Boolean);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}
