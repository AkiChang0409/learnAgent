const IMPORT_LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxCharacters: 160_000,
  maxChunks: 16,
  maxTopics: 8,
  maxNotesPerTopic: 2,
  independentConcurrency: 3,
  maxRetriesPerStep: 1
});

function validateImportPreflight({ fileBytes, characterCount, chunkCount }) {
  if (!Number.isSafeInteger(fileBytes) || fileBytes < 0 || fileBytes > IMPORT_LIMITS.maxFileBytes) {
    throw new Error('文件超过 2MiB，请拆分后再导入');
  }
  if (!Number.isSafeInteger(characterCount) || characterCount < 0 || characterCount > IMPORT_LIMITS.maxCharacters) {
    throw new Error('可处理字符超过 160,000，请拆分后再导入');
  }
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > IMPORT_LIMITS.maxChunks) {
    throw new Error('文档超过 16 个处理块，请拆分后再导入');
  }
}

function estimatedImportCalls(mode, chunkCount) {
  if (mode === 'offline') return 0;
  if (mode === 'fast') return chunkCount + 3;
  return chunkCount + Math.min(IMPORT_LIMITS.maxTopics, Math.max(1, chunkCount)) * 4 + 3;
}

module.exports = { IMPORT_LIMITS, validateImportPreflight, estimatedImportCalls };
