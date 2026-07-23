function dateValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function stripSearchFields(note) {
  const { searchExcerpt, searchSection, searchScore, ...cleanNote } = note || {};
  return cleanNote;
}

function createSyncPackage(data) {
  const { apiKey: _legacyApiKey, ...safeSettings } = data?.settings || {};
  return {
    app: 'LearnAgent', packageVersion: 2, exportedAt: new Date().toISOString(),
    schemaVersion: data?.schemaVersion || 6,
    data: {
      subjects: data?.subjects || [], notes: (data?.notes || []).map(stripSearchFields),
      conversations: data?.conversations || [], usageRecords: data?.usageRecords || [],
      settings: safeSettings
    }
  };
}

function readSyncPayload(value) {
  const source = value?.data && typeof value.data === 'object' ? value.data : value;
  return {
    subjects: Array.isArray(source?.subjects) ? source.subjects : [],
    notes: Array.isArray(source?.notes) ? source.notes.map(stripSearchFields) : [],
    conversations: Array.isArray(source?.conversations) ? source.conversations : [],
    usageRecords: Array.isArray(source?.usageRecords) ? source.usageRecords : [],
    settings: source?.settings && typeof source.settings === 'object' ? source.settings : null
  };
}

function mergeByUpdatedAt(currentItems, incomingItems) {
  const byId = new Map();
  let added = 0;
  let updated = 0;
  for (const item of currentItems || []) if (item?.id) byId.set(item.id, item);
  for (const item of incomingItems || []) {
    if (!item?.id) continue;
    const existing = byId.get(item.id);
    if (!existing) { byId.set(item.id, item); added += 1; }
    else if (dateValue(item.updatedAt || item.createdAt) > dateValue(existing.updatedAt || existing.createdAt)) {
      byId.set(item.id, item); updated += 1;
    }
  }
  return { items: [...byId.values()], added, updated };
}

function mergeUsageRecords(currentItems, incomingItems) {
  const byId = new Map();
  let added = 0;
  for (const item of currentItems || []) if (item?.id) byId.set(item.id, item);
  for (const item of incomingItems || []) {
    if (!item?.id || byId.has(item.id)) continue;
    byId.set(item.id, item); added += 1;
  }
  return { items: [...byId.values()].sort((a, b) => dateValue(a.createdAt) - dateValue(b.createdAt)).slice(-1000), added };
}

function fixNoteHierarchy(notes) {
  const ids = new Set((notes || []).map((note) => note.id));
  const repaired = (notes || []).map((note) => (!note.parentId || note.parentId === note.id || !ids.has(note.parentId)
    ? { ...note, parentId: undefined } : { ...note }));
  const byId = new Map<string, any>(repaired.map((note) => [note.id, note]));
  for (const start of byId.keys()) {
    const path = [];
    const seen = new Map();
    let current = start;
    while (current && byId.has(current)) {
      if (seen.has(current)) {
        const cycle = path.slice(seen.get(current)).sort((a, b) => a.localeCompare(b));
        if (cycle[0]) byId.get(cycle[0]).parentId = undefined;
        break;
      }
      seen.set(current, path.length); path.push(current); current = byId.get(current)?.parentId;
    }
  }
  return repaired;
}

function mergeSyncData(currentData, importPayload) {
  const incoming = readSyncPayload(importPayload);
  const subjectMerge = mergeByUpdatedAt(currentData.subjects || [], incoming.subjects);
  const notesMerge = mergeByUpdatedAt(currentData.notes || [], incoming.notes);
  const notes = fixNoteHierarchy(notesMerge.items);
  const noteIds = new Set(notes.map((note) => note.id));
  const conversationMerge = mergeByUpdatedAt(currentData.conversations || [], incoming.conversations);
  const conversations = conversationMerge.items.filter((conversation) => noteIds.has(conversation.noteId));
  const usageMerge = mergeUsageRecords(currentData.usageRecords || [], incoming.usageRecords);
  const importedSettings = incoming.settings || {};
  return {
    data: { ...currentData, subjects: subjectMerge.items, notes, conversations, usageRecords: usageMerge.items,
      settings: { ...currentData.settings, provider: importedSettings.provider || currentData.settings.provider,
        endpoint: importedSettings.endpoint ?? currentData.settings.endpoint,
        model: importedSettings.model ?? currentData.settings.model } },
    summary: { notesAdded: notesMerge.added, notesUpdated: notesMerge.updated,
      subjectsAdded: subjectMerge.added, subjectsUpdated: subjectMerge.updated,
      conversationsAdded: conversationMerge.added, conversationsUpdated: conversationMerge.updated,
      usageRecordsAdded: usageMerge.added }
  };
}

function validateSyncPackage(value) {
  if (!value || typeof value !== 'object') throw new Error('同步包必须是 JSON 对象');
  if (value.app && value.app !== 'LearnAgent') throw new Error('这不是 LearnAgent 同步包');
  const version = Number(value.packageVersion || 1);
  if (![1, 2].includes(version)) throw new Error(`不支持的同步包版本：${version}`);
  const source = value.data && typeof value.data === 'object' ? value.data : value;
  for (const key of ['subjects', 'notes', 'conversations', 'usageRecords']) {
    if (source[key] !== undefined && !Array.isArray(source[key])) throw new Error(`同步包字段 ${key} 必须是数组`);
    const ids = new Set();
    for (const item of source[key] || []) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) {
        throw new Error(`同步包字段 ${key} 包含缺失或重复主键`);
      }
      ids.add(item.id);
    }
  }
  return value;
}

module.exports = { createSyncPackage, mergeSyncData, validateSyncPackage, fixNoteHierarchy, readSyncPayload };
