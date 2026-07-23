const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const initSqlJs = require('sql.js');

const SCHEMA_VERSION = 4;
const DEFAULT_SUBJECT_NAME = '通用学习';

function defaultData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    subjects: [],
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
}

function createStorage(userDataPath) {
  const dbPath = path.join(userDataPath, 'learn-agent.sqlite');
  const legacyJsonPath = path.join(userDataPath, 'learn-agent-data.json');
  let SQL = null;
  let db = null;

  async function init() {
    if (db) return;
    SQL = await initSqlJs();
    await fs.mkdir(userDataPath, { recursive: true });
    try {
      const fileBuffer = await fs.readFile(dbPath);
      db = new SQL.Database(fileBuffer);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      db = new SQL.Database();
    }
    applySchema();
    await migrateLegacyJsonIfNeeded();
    await persist();
  }

  function applySchema() {
    db.run(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subjects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        parent_note_id TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        topic TEXT NOT NULL,
        tags TEXT NOT NULL,
        summary TEXT NOT NULL,
        cases_json TEXT NOT NULL,
        pitfalls_json TEXT NOT NULL,
        interview_questions_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS note_sections (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        heading TEXT NOT NULL,
        content TEXT NOT NULL,
        position INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        title TEXT NOT NULL,
        memory_summary TEXT NOT NULL DEFAULT '',
        memory_updated_at TEXT,
        summarized_message_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        position INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        operation TEXT NOT NULL,
        provider TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        cached_input_tokens INTEGER NOT NULL,
        reasoning_tokens INTEGER NOT NULL,
        estimated_cost_usd REAL,
        currency TEXT NOT NULL,
        price_source TEXT NOT NULL,
        response_id TEXT NOT NULL
      );

      INSERT OR IGNORE INTO metadata (key, value) VALUES ('schemaVersion', '${SCHEMA_VERSION}');
      UPDATE metadata SET value = '${SCHEMA_VERSION}' WHERE key = 'schemaVersion';
      INSERT OR IGNORE INTO settings (id, data) VALUES (1, '${escapeSql(JSON.stringify(defaultData().settings))}');
    `);

    ensureColumn('conversations', 'memory_summary', "TEXT NOT NULL DEFAULT ''");
    ensureColumn('conversations', 'memory_updated_at', 'TEXT');
    ensureColumn('conversations', 'summarized_message_count', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn('notes', 'parent_note_id', 'TEXT');
    ensureColumn('notes', 'position', 'INTEGER NOT NULL DEFAULT 0');
    db.run(`UPDATE metadata SET value = '${SCHEMA_VERSION}' WHERE key = 'schemaVersion'`);

    db.run(`
      CREATE TABLE IF NOT EXISTS note_search (
        note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
        content_text TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS note_chunks (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        section TEXT NOT NULL,
        kind TEXT NOT NULL,
        content_text TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        position INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_note_chunks_note_id ON note_chunks(note_id);
      CREATE INDEX IF NOT EXISTS idx_note_chunks_updated_at ON note_chunks(updated_at);
    `);
    rebuildIndexes();
  }

  async function migrateLegacyJsonIfNeeded() {
    const existingNotes = singleValue('SELECT COUNT(*) AS count FROM notes', 'count');
    if (existingNotes > 0) return;

    let legacyData = null;
    try {
      const raw = await fs.readFile(legacyJsonPath, 'utf8');
      legacyData = { ...defaultData(), ...JSON.parse(raw) };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to read legacy JSON data:', error);
      }
      return;
    }

    saveDataSync(legacyData);
    const backupPath = legacyJsonPath.replace(/\.json$/, `.backup-${Date.now()}.json`);
    await fs.copyFile(legacyJsonPath, backupPath);
  }

  async function loadData() {
    await init();
    return loadDataSync();
  }

  function loadDataSync(noteIds = null) {
    const data = defaultData();
    data.settings = readSettings();
    data.notes = readNotes(noteIds);
    data.subjects = noteIds ? readSubjectsForNotes(data.notes) : readSubjects(data.notes);
    data.conversations = readConversations(noteIds);
    data.usageRecords = readUsageRecords();
    return data;
  }

  async function saveData(data) {
    await init();
    saveDataSync(data);
    await persist();
    return { ok: true, filePath: dbPath };
  }

  function saveDataSync(data) {
    const merged = {
      ...defaultData(),
      ...data,
      subjects: normalizeSubjects(data),
      settings: { ...defaultData().settings, ...data?.settings }
    };
    db.run('BEGIN TRANSACTION');
    try {
      db.run('DELETE FROM messages');
      db.run('DELETE FROM conversations');
      db.run('DELETE FROM note_sections');
      db.run('DELETE FROM notes');
      db.run('DELETE FROM subjects');
      db.run('DELETE FROM usage_records');
      db.run('UPDATE settings SET data = ? WHERE id = 1', [JSON.stringify(merged.settings)]);

      const insertSubject = db.prepare(`
        INSERT INTO subjects (id, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertNote = db.prepare(`
        INSERT INTO notes (
          id, parent_note_id, position, title, subject, topic, tags, summary, cases_json,
          pitfalls_json, interview_questions_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertSection = db.prepare(`
        INSERT INTO note_sections (id, note_id, heading, content, position)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertConversation = db.prepare(`
        INSERT INTO conversations (
          id, note_id, title, memory_summary, memory_updated_at, summarized_message_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMessage = db.prepare(`
        INSERT INTO messages (id, conversation_id, role, content, created_at, sources_json, position)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertUsageRecord = db.prepare(`
        INSERT INTO usage_records (
          id, created_at, operation, provider, endpoint, model, input_tokens, output_tokens,
          total_tokens, cached_input_tokens, reasoning_tokens, estimated_cost_usd, currency,
          price_source, response_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const subject of merged.subjects || []) {
        insertSubject.run([
          subject.id,
          subject.name,
          subject.description || '',
          subject.createdAt,
          subject.updatedAt
        ]);
      }

      for (const note of merged.notes || []) {
        insertNote.run([
          note.id,
          note.parentId || null,
          Number(note.position || 0),
          note.title,
          note.subject,
          note.topic,
          JSON.stringify(note.tags || []),
          note.summary || '',
          JSON.stringify(note.cases || []),
          JSON.stringify(note.pitfalls || []),
          JSON.stringify(note.interviewQuestions || []),
          note.createdAt,
          note.updatedAt
        ]);
        (note.sections || []).forEach((section, index) => {
          insertSection.run([section.id, note.id, section.heading, section.content || '', index]);
        });
      }

      for (const conversation of merged.conversations || []) {
        insertConversation.run([
          conversation.id,
          conversation.noteId,
          conversation.title,
          conversation.memorySummary || '',
          conversation.memoryUpdatedAt || null,
          Number(conversation.summarizedMessageCount || 0),
          conversation.updatedAt
        ]);
        (conversation.messages || []).forEach((message, index) => {
          insertMessage.run([
            message.id,
            conversation.id,
            message.role,
            message.content,
            message.createdAt,
            JSON.stringify(message.sources || []),
            index
          ]);
        });
      }

      for (const record of (merged.usageRecords || []).slice(-1000)) {
        insertUsageRecord.run([
          record.id,
          record.createdAt,
          record.operation || 'unknown',
          record.provider || '',
          record.endpoint || '',
          record.model || '',
          Number(record.inputTokens || 0),
          Number(record.outputTokens || 0),
          Number(record.totalTokens || 0),
          Number(record.cachedInputTokens || 0),
          Number(record.reasoningTokens || 0),
          typeof record.estimatedCostUsd === 'number' ? record.estimatedCostUsd : null,
          record.currency || 'usd',
          record.priceSource || 'unknown',
          record.responseId || ''
        ]);
      }

      insertSubject.free();
      insertNote.free();
      insertSection.free();
      insertConversation.free();
      insertMessage.free();
      insertUsageRecord.free();
      rebuildIndexes();
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  }

  async function searchNotes(query) {
    await init();
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) return loadDataSync().notes;

    const queryTerms = terms(cleanQuery);
    const chunkRows = readChunkRows();
    const ranked = rankChunks(queryTerms, chunkRows, { limit: 240 })
      .filter((chunk) => chunk.score > 0);
    const byNote = new Map();

    ranked.forEach((chunk) => {
      const existing = byNote.get(chunk.noteId);
      if (!existing || chunk.score > existing.score) {
        byNote.set(chunk.noteId, chunk);
      }
    });

    const ordered = Array.from(byNote.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);
    const notesById = new Map(readNotes(ordered.map((item) => item.noteId)).map((note) => [note.id, note]));
    return ordered
      .map((item) => {
        const note = notesById.get(item.noteId);
        if (!note) return null;
        return {
          ...note,
          searchExcerpt: highlightExcerpt(item.contentText, queryTerms),
          searchSection: item.section,
          searchScore: item.score
        };
      })
      .filter(Boolean);
  }

  async function retrieveContext(payload) {
    await init();
    const question = String(payload?.question || '').trim();
    const currentNote = payload?.currentNote || {};
    const limit = Number(payload?.limit || 8);
    const queryTerms = terms(`${question} ${currentNote.title || ''} ${currentNote.topic || ''}`);
    const chunkRows = readChunkRows();
    const dbChunks = chunkRows.filter((chunk) => chunk.noteId !== currentNote.id);
    const currentChunks = currentNote?.id ? noteToChunks(currentNote).map((chunk) => ({
      ...chunk,
      updatedAt: currentNote.updatedAt || new Date().toISOString()
    })) : [];
    const chunks = [...currentChunks, ...dbChunks];
    const ranked = rankChunks(queryTerms, chunks, {
      limit,
      currentNoteId: currentNote.id
    }).filter((source) => source.score > 0 || source.noteId === currentNote.id);

    const sources = ranked.map((source) => ({
      noteId: source.noteId,
      title: source.title,
      section: source.section,
      excerpt: excerpt(source.contentText, 300),
      score: source.score
    }));

    return {
      sources,
      context: sources
        .map((source, index) => `片段${index + 1}｜${source.title} / ${source.section}\n${source.excerpt}`)
        .join('\n\n')
    };
  }

  async function getDataFilePath() {
    await init();
    return dbPath;
  }

  function readSettings() {
    const row = queryRows('SELECT data FROM settings WHERE id = 1')[0];
    if (!row) return defaultData().settings;
    return { ...defaultData().settings, ...safeParse(row.data, {}) };
  }

  function readSubjects(notes = []) {
    const rows = queryRows('SELECT * FROM subjects ORDER BY updated_at DESC, name ASC');
    if (!rows.length) return inferSubjectsFromNotes(notes);
    return normalizeSubjects({
      subjects: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      notes
    });
  }

  function readSubjectsForNotes(notes = []) {
    return normalizeSubjects({ subjects: [], notes });
  }

  function readNotes(noteIds = null) {
    const where = noteIds?.length ? `WHERE id IN (${noteIds.map(() => '?').join(',')})` : '';
    const rows = queryRows(`SELECT * FROM notes ${where} ORDER BY position ASC, updated_at DESC`, noteIds || []);
    const sectionsByNote = new Map();
    const sectionRows = queryRows(
      noteIds?.length
        ? `SELECT * FROM note_sections WHERE note_id IN (${noteIds.map(() => '?').join(',')}) ORDER BY position ASC`
        : 'SELECT * FROM note_sections ORDER BY position ASC',
      noteIds || []
    );
    sectionRows.forEach((row) => {
      const list = sectionsByNote.get(row.note_id) || [];
      list.push({ id: row.id, heading: row.heading, content: row.content });
      sectionsByNote.set(row.note_id, list);
    });

    return rows.map((row) => ({
      id: row.id,
      parentId: row.parent_note_id || undefined,
      position: Number(row.position || 0),
      title: row.title,
      subject: row.subject,
      topic: row.topic,
      tags: safeParse(row.tags, []),
      summary: row.summary,
      sections: sectionsByNote.get(row.id) || [],
      cases: safeParse(row.cases_json, []),
      pitfalls: safeParse(row.pitfalls_json, []),
      interviewQuestions: safeParse(row.interview_questions_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  function readConversations(noteIds = null) {
    const where = noteIds?.length ? `WHERE note_id IN (${noteIds.map(() => '?').join(',')})` : '';
    const rows = queryRows(`SELECT * FROM conversations ${where} ORDER BY updated_at DESC`, noteIds || []);
    const conversationIds = rows.map((row) => row.id);
    const messagesByConversation = new Map();
    const messageRows = conversationIds.length
      ? queryRows(
          `SELECT * FROM messages WHERE conversation_id IN (${conversationIds.map(() => '?').join(',')}) ORDER BY position ASC`,
          conversationIds
        )
      : [];
    messageRows.forEach((row) => {
      const list = messagesByConversation.get(row.conversation_id) || [];
      list.push({
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
        sources: safeParse(row.sources_json, [])
      });
      messagesByConversation.set(row.conversation_id, list);
    });

    return rows.map((row) => ({
      id: row.id,
      noteId: row.note_id,
      title: row.title,
      memorySummary: row.memory_summary || '',
      memoryUpdatedAt: row.memory_updated_at || undefined,
      summarizedMessageCount: Number(row.summarized_message_count || 0),
      messages: messagesByConversation.get(row.id) || [],
      updatedAt: row.updated_at
    }));
  }

  function readUsageRecords() {
    const rows = queryRows('SELECT * FROM usage_records ORDER BY created_at ASC LIMIT 1000');
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      operation: row.operation,
      provider: row.provider,
      endpoint: row.endpoint,
      model: row.model,
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0),
      totalTokens: Number(row.total_tokens || 0),
      cachedInputTokens: Number(row.cached_input_tokens || 0),
      reasoningTokens: Number(row.reasoning_tokens || 0),
      estimatedCostUsd: row.estimated_cost_usd === null || row.estimated_cost_usd === undefined
        ? null
        : Number(row.estimated_cost_usd),
      currency: row.currency || 'usd',
      priceSource: row.price_source || 'unknown',
      responseId: row.response_id || ''
    }));
  }

  function ensureColumn(table, column, definition) {
    const columns = queryRows(`PRAGMA table_info(${table})`).map((row) => row.name);
    if (!columns.includes(column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  function rebuildIndexes() {
    db.run('DELETE FROM note_search');
    db.run('DELETE FROM note_chunks');
    const notes = readNotes();
    const insertSearch = db.prepare(`
      INSERT INTO note_search (note_id, content_text, updated_at)
      VALUES (?, ?, ?)
    `);
    const insertChunk = db.prepare(`
      INSERT INTO note_chunks (id, note_id, title, section, kind, content_text, excerpt, position, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    notes.forEach((note) => {
      const chunks = noteToChunks(note);
      const content = chunks.map((chunk) => chunk.contentText).join('\n').toLowerCase();
      insertSearch.run([
        note.id,
        content,
        note.updatedAt
      ]);
      chunks.forEach((chunk, index) => {
        insertChunk.run([
          chunk.id,
          chunk.noteId,
          chunk.title,
          chunk.section,
          chunk.kind,
          chunk.contentText,
          excerpt(chunk.contentText, 300),
          index,
          note.updatedAt
        ]);
      });
    });
    insertSearch.free();
    insertChunk.free();
  }

  function readChunkRows() {
    return queryRows('SELECT * FROM note_chunks ORDER BY updated_at DESC, position ASC').map((row) => ({
      id: row.id,
      noteId: row.note_id,
      title: row.title,
      section: row.section,
      kind: row.kind,
      contentText: row.content_text,
      excerpt: row.excerpt,
      position: Number(row.position || 0),
      updatedAt: row.updated_at
    }));
  }

  async function persist() {
    const bytes = db.export();
    await fs.writeFile(dbPath, Buffer.from(bytes));
  }

  function queryRows(sql, params = []) {
    const statement = db.prepare(sql);
    try {
      statement.bind(params);
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  function singleValue(sql, key) {
    return queryRows(sql)[0]?.[key] || 0;
  }

  return {
    defaultData,
    loadData,
    saveData,
    searchNotes,
    retrieveContext,
    getDataFilePath,
    paths: {
      dbPath,
      legacyJsonPath
    }
  };
}

function noteToChunks(note) {
  const chunks = [];
  const push = (kind, section, text) => {
    const contentText = [note.title, note.subject, note.topic, note.tags?.join(' ') || '', section, text]
      .filter(Boolean)
      .join('\n')
      .trim();
    if (!contentText) return;
    chunks.push({
      id: `${note.id}:${kind}:${chunks.length}`,
      noteId: note.id,
      title: note.title || '未命名笔记',
      section,
      kind,
      contentText
    });
  };

  push('summary', '摘要', note.summary || '');
  (note.sections || []).forEach((section) => push('section', section.heading || '小节', section.content || ''));
  if (note.cases?.length) push('cases', '案例', note.cases.join('\n'));
  if (note.pitfalls?.length) push('pitfalls', '易错点', note.pitfalls.join('\n'));
  if (note.interviewQuestions?.length) push('interviewQuestions', '面试问题', note.interviewQuestions.join('\n'));
  return chunks;
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ' ');
}

function terms(text) {
  const normalized = normalize(text);
  const words = normalized.split(/\s+/).filter((word) => word.length > 1);
  const cjkPairs = Array.from(normalized.matchAll(/[\u4e00-\u9fff]{2,}/g))
    .flatMap((match) => {
      const value = match[0];
      const pairs = [];
      for (let index = 0; index < value.length - 1; index += 1) {
        pairs.push(value.slice(index, index + 2));
      }
      return [value, ...pairs];
    });
  return Array.from(new Set([...words, ...cjkPairs])).slice(0, 32);
}

function scoreChunk(queryTerms, chunk, currentNoteId) {
  if (!queryTerms.length) return chunk.noteId === currentNoteId ? 1 : 0;
  const text = normalize(`${chunk.title} ${chunk.section} ${chunk.contentText}`);
  const titleText = normalize(`${chunk.title} ${chunk.section}`);
  const score = queryTerms.reduce((total, term) => {
    if (!term) return total;
    const occurrences = text.split(term).length - 1;
    const titleBoost = titleText.includes(term) ? 3 : 0;
    return total + Math.min(occurrences, 6) + titleBoost;
  }, 0);
  const currentBoost = chunk.noteId === currentNoteId ? 2.4 : 1;
  const kindBoost = chunk.kind === 'summary' ? 1.25 : 1;
  return score * currentBoost * kindBoost;
}

function rankChunks(queryTerms, chunks, options = {}) {
  const currentNoteId = options.currentNoteId || '';
  return chunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(queryTerms, chunk, currentNoteId)
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    })
    .slice(0, options.limit || 8);
}

function excerpt(text, max = 260) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

function highlightExcerpt(text, queryTerms, max = 180) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  const lower = compact.toLowerCase();
  const firstIndex = queryTerms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(firstIndex - 42, 0);
  const clipped = compact.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${clipped}${start + max < compact.length ? '…' : ''}`;
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function createSubjectId() {
  return `subject_${randomUUID()}`;
}

function cleanSubjectName(value) {
  return String(value || '').trim() || DEFAULT_SUBJECT_NAME;
}

function normalizeSubjects(data) {
  const now = new Date().toISOString();
  const byName = new Map();

  (data?.subjects || []).forEach((subject) => {
    const name = cleanSubjectName(subject?.name);
    const key = name.toLowerCase();
    if (byName.has(key)) return;
    byName.set(key, {
      id: subject?.id || createSubjectId(),
      name,
      description: subject?.description || '',
      createdAt: subject?.createdAt || subject?.created_at || now,
      updatedAt: subject?.updatedAt || subject?.updated_at || subject?.createdAt || now
    });
  });

  (data?.notes || []).forEach((note) => {
    const name = cleanSubjectName(note?.subject);
    const key = name.toLowerCase();
    if (byName.has(key)) return;
    byName.set(key, {
      id: createSubjectId(),
      name,
      description: '',
      createdAt: note?.createdAt || now,
      updatedAt: note?.updatedAt || note?.createdAt || now
    });
  });

  return Array.from(byName.values()).sort((a, b) => {
    const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    return updatedDiff || String(a.name).localeCompare(String(b.name), 'zh-CN');
  });
}

function inferSubjectsFromNotes(notes = []) {
  return normalizeSubjects({ subjects: [], notes });
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

module.exports = {
  SCHEMA_VERSION,
  createStorage,
  defaultData
};
