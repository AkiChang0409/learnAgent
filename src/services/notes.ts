import type { AppData, GeneratedNoteDraft, MarkdownImportNoteDraft, Note, Subject, SubjectKnowledgeMap } from '../types';
import { richContentFromDraft, richTextToPlainText } from './rich-text';

export const DEFAULT_SUBJECT_NAME = '通用学习';

export const emptyData: AppData = {
  schemaVersion: 8,
  subjects: [],
  notes: [],
  conversations: [],
  usageRecords: [],
  settings: {
    provider: 'local',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4.1-mini',
    defaultPersonaId: 'learning-notes',
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

export function cleanSubjectName(value: string | undefined | null) {
  return String(value || '').trim() || DEFAULT_SUBJECT_NAME;
}

export function ensureSubjects(data: Pick<AppData, 'subjects' | 'notes'>): Subject[] {
  const byName = new Map<string, Subject>();
  const now = nowIso();

  (data.subjects || []).forEach((subject) => {
    const name = cleanSubjectName(subject.name);
    const key = name.toLowerCase();
    if (byName.has(key)) return;
    byName.set(key, {
      id: subject.id || createId('subject'),
      name,
      description: subject.description || '',
      topics: Array.isArray(subject.topics) ? subject.topics : [],
      createdAt: subject.createdAt || now,
      updatedAt: subject.updatedAt || subject.createdAt || now
    });
  });

  (data.notes || []).forEach((note) => {
    const name = cleanSubjectName(note.subject);
    const key = name.toLowerCase();
    if (byName.has(key)) return;
    byName.set(key, {
      id: createId('subject'),
      name,
      description: '',
      topics: [],
      createdAt: note.createdAt || now,
      updatedAt: note.updatedAt || note.createdAt || now
    });
  });

  return Array.from(byName.values()).sort((a, b) => {
    const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    return updatedDiff || a.name.localeCompare(b.name, 'zh-CN');
  });
}

export function draftToNote(draft: GeneratedNoteDraft): Note {
  const now = nowIso();
  const summaryRich = richContentFromDraft(draft.summaryBlocks, draft.summary || '', false);
  return {
    id: createId('note'),
    title: draft.title || draft.topic || '未命名笔记',
    subject: cleanSubjectName(draft.subject),
    topic: draft.topic || draft.title || '未命名主题',
    tags: normalizeList(draft.tags),
    summary: richTextToPlainText(summaryRich, draft.summary || ''),
    summaryRich,
    sections: (draft.sections || []).map((section) => {
      const contentRich = richContentFromDraft(section.blocks, section.content || '', true);
      return {
        id: createId('section'),
        heading: section.heading || '小节',
        content: richTextToPlainText(contentRich, section.content || ''),
        contentRich
      };
    }),
    cases: normalizeList(draft.cases),
    pitfalls: normalizeList(draft.pitfalls),
    interviewQuestions: normalizeList(draft.interviewQuestions),
    personaId: draft.personaId || 'learning-notes',
    personaVersion: draft.personaVersion || 1,
    summaryLabel: draft.summaryLabel || '知识总结',
    collections: normalizeCollections(draft.collections),
    documentSchemaVersion: draft.documentSchemaVersion || 1,
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
  const firstDraft = map.topics?.flatMap((topic) => topic.notes || [])[0];

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
      interviewQuestions: [`请概括${subject}这套知识地图的核心结构。`],
      personaId: firstDraft?.personaId,
      personaVersion: firstDraft?.personaVersion,
      summaryLabel: firstDraft?.summaryLabel,
      documentSchemaVersion: firstDraft?.documentSchemaVersion,
      collections: []
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

export function normalizeCollections(values: unknown) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 8).map((value, index) => {
    const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
      id: String(source.id || `collection-${index + 1}`),
      title: String(source.title || '补充内容'),
      items: normalizeList(source.items)
    };
  }).filter((collection) => collection.items.length);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}
