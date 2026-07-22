import type { AppData, GeneratedNoteDraft, MarkdownImportNoteDraft, Note, SubjectKnowledgeMap } from '../types';

export const emptyData: AppData = {
  schemaVersion: 3,
  notes: [],
  conversations: [],
  usageRecords: [],
  settings: {
    provider: 'local',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4.1-mini',
    apiKey: '',
    lastTestStatus: 'idle',
    lastTestMessage: '尚未测试连接'
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

export function markdownDraftToNotes(draft: MarkdownImportNoteDraft): Note[] {
  const root = draftToNote(draft);
  const subNotes = (draft.subNotes || []).map((subDraft, index) => ({
    ...draftToNote(subDraft),
    parentId: root.id,
    position: index
  }));
  return [root, ...subNotes];
}

export function subjectKnowledgeMapToNotes(map: SubjectKnowledgeMap): Note[] {
  const subject = map.subject || '综合学习';
  const notes: Note[] = [];

  if (map.overview?.trim()) {
    notes.push(draftToNote({
      title: map.title || `${subject} 知识地图`,
      subject,
      topic: '学科总览',
      tags: normalizeList(map.tags),
      summary: map.overview,
      sections: [
        {
          heading: '总览',
          content: map.overview
        },
        {
          heading: '主题索引',
          content: (map.topics || []).map((topic) => `- ${topic.title}: ${topic.summary || '核心主题'}`).join('\n')
        }
      ],
      cases: [],
      pitfalls: [],
      interviewQuestions: [`请概括${subject}这套知识地图的核心结构。`]
    }));
  }

  (map.topics || []).forEach((topic) => {
    const topicTitle = topic.title || '未命名主题';
    const topicNotes = topic.notes?.length
      ? topic.notes
      : [{
          title: topicTitle,
          subject,
          topic: topicTitle,
          tags: [],
          summary: topic.summary || '',
          sections: [{ heading: '核心内容', content: topic.summary || '' }],
          cases: [],
          pitfalls: [],
          interviewQuestions: []
        }];

    topicNotes.forEach((draft, noteIndex) => {
      const root = draftToNote({
        ...draft,
        subject,
        topic: topicTitle
      });
      root.position = noteIndex;
      notes.push(root);

      (draft.subNotes || []).forEach((subDraft, subIndex) => {
        notes.push({
          ...draftToNote({
            ...subDraft,
            subject,
            topic: topicTitle
          }),
          parentId: root.id,
          position: subIndex
        });
      });
    });
  });

  return notes;
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
