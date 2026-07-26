import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let rawCreateStorage: (root: string) => any;
let SQL: any;
const tempRoots: string[] = [];
const activeStorages: any[] = [];

function createStorage(root: string) {
  const storage = rawCreateStorage(root);
  activeStorages.push(storage);
  return storage;
}

beforeAll(async () => {
  ({ createStorage: rawCreateStorage } = require('../electron-dist/storage-core.cjs'));
  SQL = await require('sql.js')();
});

afterEach(async () => {
  await Promise.allSettled(activeStorages.splice(0).map((storage) => storage.flushData()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sampleData() {
  return {
    schemaVersion: 7,
    subjects: [{ id: 's1', name: '计算机', topics: ['空主题'], createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    notes: [{
      id: 'n1', title: '事务', subject: '计算机', topic: '数据库', tags: [], summary: '原子提交',
      sections: [{ id: 'sec1', heading: 'ACID', content: '一致性与持久性' }], cases: [], pitfalls: [],
      interviewQuestions: [], createdAt: '2026-01-01', updatedAt: '2026-01-01'
    }],
    conversations: [],
    usageRecords: [],
    settings: { provider: 'local', endpoint: '', model: '', lastTestStatus: 'idle' }
  };
}

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'learnagent-storage-'));
  tempRoots.push(root);
  return root;
}

describe('revisioned storage', () => {
  it('journals a change, flushes it, and reloads the durable revision', async () => {
    const root = await tempRoot();
    const storage = createStorage(root);
    expect((await storage.loadSnapshot()).revision).toBe(0);
    const accepted = await storage.applyChanges({ baseRevision: 0, changes: { snapshot: sampleData() } });
    expect(accepted).toEqual({ revision: 1, durable: true });
    await storage.flushData();

    const reopened = createStorage(root);
    const snapshot = await reopened.loadSnapshot();
    expect(snapshot.revision).toBe(1);
    expect(snapshot.data.notes[0].title).toBe('事务');
  });

  it('replays a newer journal after an interrupted checkpoint', async () => {
    const root = await tempRoot();
    const storage = createStorage(root);
    await storage.loadSnapshot();
    const journalData = sampleData();
    journalData.notes[0].title = '崩溃前已确认';
    await writeFile(path.join(root, 'learn-agent.journal.json'), JSON.stringify({ revision: 4, data: journalData }));

    const reopened = createStorage(root);
    const snapshot = await reopened.loadSnapshot();
    expect(snapshot.revision).toBe(4);
    expect(snapshot.data.notes[0].title).toBe('崩溃前已确认');
    await expect(readFile(path.join(root, 'learn-agent.sqlite'))).resolves.toBeTruthy();
  });

  it('rejects stale revisions and duplicate entity ids', async () => {
    const root = await tempRoot();
    const storage = createStorage(root);
    await storage.loadSnapshot();
    await storage.applyChanges({ baseRevision: 0, changes: { snapshot: sampleData() } });
    await expect(storage.applyChanges({ baseRevision: 0, changes: {} })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await storage.flushData();

    const duplicate = sampleData();
    duplicate.notes.push({ ...duplicate.notes[0] });
    await expect(storage.applyChanges({ baseRevision: 1, changes: { snapshot: duplicate } })).rejects.toThrow('重复');
  });

  it('upserts only changed notes and refreshes their searchable chunks', async () => {
    const root = await tempRoot();
    const storage = createStorage(root);
    await storage.loadSnapshot();
    await storage.applyChanges({ baseRevision: 0, changes: { snapshot: sampleData() } });
    const updated = { ...sampleData().notes[0], summary: '唯一增量索引词', updatedAt: '2026-01-02' };
    await storage.applyChanges({ baseRevision: 1, changes: { notes: { upsert: [updated] } } });
    expect((await storage.searchNotes('唯一增量索引词'))[0]?.id).toBe('n1');
    await storage.flushData();
    const reopened = createStorage(root);
    expect((await reopened.loadSnapshot()).data.notes[0].summary).toBe('唯一增量索引词');
  });

  it('persists allowlisted rich text while keeping the plain-text projection searchable', async () => {
    const root = await tempRoot();
    const storage = createStorage(root);
    const data = sampleData();
    await storage.applyChanges({ baseRevision: 0, changes: { snapshot: data } });
    const updated = {
      ...data.notes[0],
      summary: '表格检索关键词',
      summaryRich: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'text',
            text: '表格检索关键词',
            marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: 'javascript:bad' } }]
          }]
        }, { type: 'script', content: [{ type: 'text', text: '不应保存' }] }]
      },
      sections: [{
        ...data.notes[0].sections[0],
        content: '方案\t优势\nA\t快速',
        contentRich: {
          type: 'doc',
          content: [{
            type: 'table',
            content: [
              { type: 'tableRow', content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '方案' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '优势' }] }] }
              ] },
              { type: 'tableRow', content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '快速' }] }] }
              ] }
            ]
          }]
        }
      }],
      updatedAt: '2026-01-03'
    };
    await storage.applyChanges({ baseRevision: 1, changes: { notes: { upsert: [updated] } } });
    const snapshot = await storage.loadSnapshot();
    expect(snapshot.data.schemaVersion).toBe(7);
    expect(snapshot.data.notes[0].summaryRich.content).toHaveLength(1);
    expect(snapshot.data.notes[0].summaryRich.content[0].content[0].marks).toEqual([{ type: 'bold' }]);
    expect(snapshot.data.notes[0].sections[0].contentRich.content[0].type).toBe('table');
    expect((await storage.searchNotes('快速'))[0]?.id).toBe('n1');
  });

  it('deletes dependent conversations when a note is deleted', async () => {
    const root = await tempRoot();
    const storage = createStorage(root);
    const data = sampleData();
    data.conversations = [{ id: 'c1', noteId: 'n1', title: '讨论', messages: [{
      id: 'm1', role: 'user', content: '问题', createdAt: '2026-01-01', sources: []
    }], updatedAt: '2026-01-01' }];
    await storage.loadSnapshot();
    await storage.applyChanges({ baseRevision: 0, changes: { snapshot: data } });
    await storage.applyChanges({ baseRevision: 1, changes: { notes: { deleteIds: ['n1'] } } });
    const snapshot = await storage.loadSnapshot();
    expect(snapshot.data.notes).toEqual([]);
    expect(snapshot.data.conversations).toEqual([]);
  });

  it('backs up and migrates a schema v4 database through v5, v6 and v7', async () => {
    const root = await tempRoot();
    const legacy = new SQL.Database();
    legacy.run("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    legacy.run("INSERT INTO metadata VALUES ('schemaVersion', '4'), ('revision', '7')");
    legacy.run("CREATE TABLE settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL)");
    legacy.run("INSERT INTO settings VALUES (1, '{\"provider\":\"local\"}')");
    await writeFile(path.join(root, 'learn-agent.sqlite'), Buffer.from(legacy.export()));
    legacy.close();

    const storage = createStorage(root);
    const snapshot = await storage.loadSnapshot();
    expect(snapshot.revision).toBe(7);
    expect(snapshot.data.schemaVersion).toBe(7);
    await expect(stat(path.join(root, 'learn-agent.sqlite.pre-v4-migration.backup'))).resolves.toBeTruthy();
  });
});
