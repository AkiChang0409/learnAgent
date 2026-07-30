import type { Note, RagSource } from '../types';

interface Chunk {
  noteId: string;
  title: string;
  section: string;
  text: string;
  priority: number;
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ' ');
}

function terms(text: string) {
  const normalized = normalize(text);
  const words = normalized.split(/\s+/).filter((word) => word.length > 1);
  const cjk = Array.from(normalized.matchAll(/[\u4e00-\u9fff]/g)).map((match) => match[0]);
  return Array.from(new Set([...words, ...cjk]));
}

function noteChunks(note: Note, priority = 1): Chunk[] {
  const base: Chunk[] = [
    {
      noteId: note.id,
      title: note.title,
      section: '摘要',
      text: [note.subject, note.topic, note.summary, note.tags.join(' ')].filter(Boolean).join('\n'),
      priority
    }
  ];

  note.sections.forEach((section) => {
    base.push({
      noteId: note.id,
      title: note.title,
      section: section.heading,
      text: section.content,
      priority
    });
  });

  const grouped: Array<readonly [string, string[]]> = note.collections?.length
    ? note.collections.map((collection) => [collection.title, collection.items] as const)
    : [
        ['案例', note.cases],
        ['易错点', note.pitfalls],
        ['面试问题', note.interviewQuestions]
      ];

  grouped.forEach(([section, values]) => {
    if (values.length) {
      base.push({
        noteId: note.id,
        title: note.title,
        section,
        text: values.join('\n'),
        priority
      });
    }
  });

  return base;
}

function scoreChunk(queryTerms: string[], chunk: Chunk) {
  if (!queryTerms.length) return 0;
  const text = normalize(`${chunk.title} ${chunk.section} ${chunk.text}`);
  const score = queryTerms.reduce((total, term) => {
    if (!term) return total;
    const occurrences = text.split(term).length - 1;
    return total + Math.min(occurrences, 4);
  }, 0);
  return score * chunk.priority;
}

function excerpt(text: string, max = 260) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

export function retrieveContext(question: string, currentNote: Note, notes: Note[], limit = 6) {
  const queryTerms = terms(`${question} ${currentNote.title} ${currentNote.topic}`);
  const chunks = [
    ...noteChunks(currentNote, 3),
    ...notes.filter((note) => note.id !== currentNote.id).flatMap((note) => noteChunks(note, 1))
  ];

  const sources: RagSource[] = chunks
    .map((chunk) => ({
      noteId: chunk.noteId,
      title: chunk.title,
      section: chunk.section,
      excerpt: excerpt(chunk.text),
      score: scoreChunk(queryTerms, chunk)
    }))
    .filter((source) => source.score > 0 || source.noteId === currentNote.id)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const context = sources
    .map((source, index) => `片段${index + 1}｜${source.title} / ${source.section}\n${source.excerpt}`)
    .join('\n\n');

  return { context, sources };
}
