const fs = require('node:fs/promises');
const path = require('node:path');
const initSqlJs = require('sql.js');

const SCHEMA_VERSION = 1;

function defaultData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    notes: [],
    conversations: [],
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

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
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

      INSERT OR IGNORE INTO metadata (key, value) VALUES ('schemaVersion', '${SCHEMA_VERSION}');
      INSERT OR IGNORE INTO settings (id, data) VALUES (1, '${escapeSql(JSON.stringify(defaultData().settings))}');
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS note_search (
        note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
        content_text TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    rebuildSearchIndex();
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
    data.conversations = readConversations(noteIds);
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
      settings: { ...defaultData().settings, ...data?.settings }
    };
    db.run('BEGIN TRANSACTION');
    try {
      db.run('DELETE FROM messages');
      db.run('DELETE FROM conversations');
      db.run('DELETE FROM note_sections');
      db.run('DELETE FROM notes');
      db.run('UPDATE settings SET data = ? WHERE id = 1', [JSON.stringify(merged.settings)]);

      const insertNote = db.prepare(`
        INSERT INTO notes (
          id, title, subject, topic, tags, summary, cases_json, pitfalls_json,
          interview_questions_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertSection = db.prepare(`
        INSERT INTO note_sections (id, note_id, heading, content, position)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertConversation = db.prepare(`
        INSERT INTO conversations (id, note_id, title, updated_at)
        VALUES (?, ?, ?, ?)
      `);
      const insertMessage = db.prepare(`
        INSERT INTO messages (id, conversation_id, role, content, created_at, sources_json, position)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const note of merged.notes || []) {
        insertNote.run([
          note.id,
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
        insertConversation.run([conversation.id, conversation.noteId, conversation.title, conversation.updatedAt]);
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

      insertNote.free();
      insertSection.free();
      insertConversation.free();
      insertMessage.free();
      rebuildSearchIndex();
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

    const like = `%${cleanQuery.toLowerCase()}%`;
    const rows = queryRows(
      `SELECT note_id FROM note_search WHERE content_text LIKE ? ORDER BY updated_at DESC LIMIT 100`,
      [like]
    );
    return readNotes(rows.map((row) => row.note_id));
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

  function readNotes(noteIds = null) {
    const where = noteIds?.length ? `WHERE id IN (${noteIds.map(() => '?').join(',')})` : '';
    const rows = queryRows(`SELECT * FROM notes ${where} ORDER BY updated_at DESC`, noteIds || []);
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
      messages: messagesByConversation.get(row.id) || [],
      updatedAt: row.updated_at
    }));
  }

  function rebuildSearchIndex() {
    db.run('DELETE FROM note_search');
    const notes = readNotes();
    const insert = db.prepare(`
      INSERT INTO note_search (note_id, content_text, updated_at)
      VALUES (?, ?, ?)
    `);
    notes.forEach((note) => {
      const content = [
        note.title,
        note.subject,
        note.topic,
        note.tags.join(' '),
        note.summary,
        note.sections.map((section) => `${section.heading}\n${section.content}`).join('\n'),
        note.cases.join('\n'),
        note.pitfalls.join('\n'),
        note.interviewQuestions.join('\n')
      ].join('\n').toLowerCase();
      insert.run([
        note.id,
        content,
        note.updatedAt
      ]);
    });
    insert.free();
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
    getDataFilePath,
    paths: {
      dbPath,
      legacyJsonPath
    }
  };
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

module.exports = {
  SCHEMA_VERSION,
  createStorage,
  defaultData
};
