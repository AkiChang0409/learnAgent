const path = require('node:path');
const fs = require('node:fs/promises');
const { Worker } = require('node:worker_threads');

function createStorage(userDataPath) {
  const worker = new Worker(path.join(__dirname, 'storage-thread.cjs'), { workerData: { userDataPath } });
  let nextId = 1;
  const pending = new Map();
  const journalPath = path.join(userDataPath, 'learn-agent.journal.json');
  let revision = null;
  let latestData = null;
  let coordinatorQueue: Promise<any> = Promise.resolve();
  let workerQueue: Promise<any> = Promise.resolve();
  let workerFailure = null;

  worker.on('message', (message) => {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else {
      const error: any = new Error(message.error?.message || '存储 Worker 操作失败');
      Object.assign(error, message.error || {});
      request.reject(error);
    }
  });
  worker.on('error', (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });

  const invoke = (method, ...args) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, args });
  });

  async function ensureLoaded() {
    if (revision !== null && latestData) return { revision, data: latestData };
    const snapshot: any = await invoke('loadSnapshot');
    revision = Number(snapshot.revision || 0);
    latestData = snapshot.data;
    return snapshot;
  }

  async function appendJournal(entry) {
    const handle = await fs.open(journalPath, 'a');
    try {
      await handle.writeFile(`${JSON.stringify(entry)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  function applyBatch(current, changes) {
    const entities = (items, change: any = {}) => {
      const deleted = new Set(change.deleteIds || []);
      const byId = new Map<string, any>(items.filter((item) => !deleted.has(item.id)).map((item) => [item.id, item]));
      for (const item of change.upsert || []) byId.set(item.id, item);
      return Array.from(byId.values());
    };
    if (changes.snapshot) return changes.snapshot;
    const notes = entities(current.notes || [], changes.notes);
    const noteIds = new Set(notes.map((note) => note.id));
    const { apiKey: _legacyApiKey, ...safeSettings } = changes.settings
      ? { ...current.settings, ...changes.settings }
      : current.settings;
    return {
      ...current,
      subjects: entities(current.subjects || [], changes.subjects),
      notes,
      conversations: entities(current.conversations || [], changes.conversations)
        .filter((conversation) => noteIds.has(conversation.noteId)),
      usageRecords: entities(current.usageRecords || [], changes.usageRecords).slice(-1000),
      settings: safeSettings
    };
  }

  async function applyChanges(payload) {
    const operation = coordinatorQueue.catch(() => {}).then(async () => {
      await ensureLoaded();
      if (Number(payload?.baseRevision) !== revision) {
        const error: any = new Error(`数据版本冲突：期望 ${revision}`);
        error.code = 'REVISION_CONFLICT';
        error.revision = revision;
        throw error;
      }
      const baseRevision = revision;
      const nextRevision = baseRevision + 1;
      await appendJournal({ baseRevision, revision: nextRevision, changes: payload.changes || {} });
      latestData = applyBatch(latestData, payload.changes || {});
      revision = nextRevision;
      const workerPayload = { ...payload, baseRevision, revision: nextRevision };
      const workerOperation = workerQueue.catch(() => {}).then(() => invoke('applyChangesVolatile', workerPayload));
      workerQueue = workerOperation.catch((error) => {
        workerFailure = error;
      });
      return { revision: nextRevision, durable: true };
    });
    coordinatorQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function flushData() {
    const operation = coordinatorQueue.catch(() => {}).then(async () => {
      await workerQueue;
      if (workerFailure) throw workerFailure;
      return invoke('flushData');
    });
    coordinatorQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return {
    loadData: async () => (await ensureLoaded()).data,
    loadSnapshot: () => ensureLoaded(),
    saveData: async (data) => ({ ok: true, filePath: path.join(userDataPath, 'learn-agent.sqlite'), ...(await applyChanges({ baseRevision: revision ?? (await ensureLoaded()).revision, changes: { snapshot: data } })) }),
    applyChanges,
    flushData,
    searchNotes: (query) => invoke('searchNotes', query),
    retrieveContext: (payload) => invoke('retrieveContext', payload),
    recordAgentRun: (run) => invoke('recordAgentRun', run),
    recordAgentStep: (step) => invoke('recordAgentStep', step),
    getDataFilePath: () => invoke('getDataFilePath'),
    terminate: () => worker.terminate()
  };
}

module.exports = { createStorage };
