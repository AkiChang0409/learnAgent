const { resolvePersona } = require('./persona-registry.cjs');

function createIpcRegistrar(ipcMain, getMainWindow) {
  return function handleIpc(channel, handler) {
    ipcMain.handle(channel, (event, ...args) => {
      const mainWindow = getMainWindow();
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        throw new Error('拒绝来自非应用窗口的 IPC 请求');
      }
      validatePayload(channel, args);
      return handler(event, ...args);
    });
  };
}

function validatePayload(channel, args) {
  const serializedSize = Buffer.byteLength(JSON.stringify(args), 'utf8');
  const maxSize = channel === 'data:apply-changes' || channel === 'ai:start-emphasis-analysis'
    ? 8 * 1024 * 1024
    : 4 * 1024 * 1024;
  if (serializedSize > maxSize) throw new Error(`IPC payload 过大：${channel}`);
  if (channel === 'data:search-notes' && (typeof args[0] !== 'string' || args[0].length > 500)) {
    throw new Error('搜索条件格式无效');
  }
  const payload = args[0];
  const requireObject = () => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`IPC payload 格式无效：${channel}`);
  };
  if (channel === 'data:apply-changes') {
    requireObject();
    if (!Number.isSafeInteger(payload.baseRevision) || payload.baseRevision < 0) throw new Error('baseRevision 格式无效');
    if (!payload.changes || typeof payload.changes !== 'object' || Array.isArray(payload.changes)) throw new Error('changes 格式无效');
    const allowed = new Set(['subjects', 'notes', 'conversations', 'usageRecords', 'settings']);
    for (const key of Object.keys(payload.changes)) if (!allowed.has(key)) throw new Error(`未知变更类型：${key}`);
    for (const key of ['subjects', 'notes', 'conversations', 'usageRecords']) {
      const change = payload.changes[key];
      if (change === undefined) continue;
      if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error(`${key} 变更格式无效`);
      const upsert = change.upsert || [];
      const deleteIds = change.deleteIds || [];
      if (!Array.isArray(upsert) || !Array.isArray(deleteIds)) throw new Error(`${key} 变更必须使用数组`);
      const ids = new Set();
      for (const item of upsert) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || ids.has(item.id)) {
          throw new Error(`${key} upsert 包含缺失或重复主键`);
        }
        ids.add(item.id);
        if (key === 'notes') {
          resolvePersona({ id: item.personaId || 'learning-notes', version: item.personaVersion || 1 });
          if (item.collections !== undefined && (!Array.isArray(item.collections) || item.collections.length > 8)) {
            throw new Error('笔记动态集合格式无效');
          }
          for (const collection of item.collections || []) {
            if (!collection || typeof collection.id !== 'string' || collection.id.length > 80
              || typeof collection.title !== 'string' || collection.title.length > 80
              || !Array.isArray(collection.items) || collection.items.length > 30
              || collection.items.some((value) => typeof value !== 'string' || value.length > 20_000)) {
              throw new Error('笔记动态集合格式无效');
            }
          }
        }
      }
      if (deleteIds.some((id) => typeof id !== 'string' || !id) || new Set(deleteIds).size !== deleteIds.length) {
        throw new Error(`${key} deleteIds 格式无效`);
      }
    }
    if (payload.changes.settings !== undefined
      && (!payload.changes.settings || typeof payload.changes.settings !== 'object' || Array.isArray(payload.changes.settings))) {
      throw new Error('settings 变更格式无效');
    }
  }
  if (channel === 'data:retrieve-context') {
    requireObject();
    if (typeof payload.question !== 'string' || payload.question.length > 10_000) throw new Error('检索问题格式无效');
  }
  if (channel === 'settings:set-api-key') {
    if (typeof payload !== 'string' || payload.length > 16_384) throw new Error('API Key 格式无效');
  }
  if (channel === 'ai:start-markdown-import') {
    requireObject();
    if (typeof payload.selectionId !== 'string' || payload.selectionId.length > 200) throw new Error('selectionId 格式无效');
    if (!['fast', 'deep', 'offline'].includes(payload.mode)) throw new Error('导入模式无效');
    resolvePersona(payload.personaRef, {
      allowDefault: false,
      operation: 'import',
      executionProfile: payload.mode,
      provider: payload.settings?.provider || 'local'
    });
  }
  if (channel === 'ai:cancel-markdown-import') {
    requireObject();
    if (typeof payload.selectionId !== 'string' || payload.selectionId.length > 200) throw new Error('selectionId 格式无效');
  }
  if (channel === 'ai:start-note-generation') {
    requireObject();
    if (typeof payload.input !== 'string' || !payload.input.trim() || payload.input.length > 20_000) {
      throw new Error('笔记生成内容格式无效');
    }
    if (typeof payload.targetSubject !== 'string' || payload.targetSubject.length > 200) {
      throw new Error('目标学科格式无效');
    }
    resolvePersona(payload.personaRef, {
      allowDefault: false,
      operation: 'generate',
      executionProfile: 'focused',
      provider: payload.settings?.provider || 'local'
    });
  }
  if (channel === 'ai:start-emphasis-analysis') {
    requireObject();
    if (typeof payload.subject !== 'string' || !payload.subject.trim() || payload.subject.length > 200) {
      throw new Error('重点分析学科格式无效');
    }
    if (!Array.isArray(payload.notes) || !payload.notes.length || payload.notes.length > 250) {
      throw new Error('重点分析笔记数量无效');
    }
    for (const note of payload.notes) {
      if (!note || typeof note !== 'object' || typeof note.id !== 'string' || !note.id
        || typeof note.title !== 'string' || typeof note.summary !== 'string' || !Array.isArray(note.sections)) {
        throw new Error('重点分析笔记格式无效');
      }
      if (note.title.length > 500 || note.summary.length > 100_000 || note.sections.length > 100) {
        throw new Error('重点分析笔记内容超限');
      }
    }
  }
  const personaOperationByChannel = {
    'ai:chat-with-note': 'chat',
    'ai:summarize-conversation': 'memory',
    'ai:distill-conversation-to-note': 'distill'
  };
  if (personaOperationByChannel[channel]) {
    requireObject();
    resolvePersona(payload.personaRef, {
      allowDefault: false,
      operation: personaOperationByChannel[channel],
      provider: payload.settings?.provider || 'local'
    });
  }
  if (channel.startsWith('ai:') && ![
    'ai:list-personas',
    'ai:select-markdown-source',
    'ai:start-markdown-import',
    'ai:cancel-markdown-import'
  ].includes(channel)) {
    requireObject();
  }
}

module.exports = { createIpcRegistrar, validatePayload };
