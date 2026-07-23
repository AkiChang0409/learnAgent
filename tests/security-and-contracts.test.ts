import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
let validatePayload: (channel: string, args: unknown[]) => void;
let createIpcRegistrar: (ipcMain: any, getMainWindow: () => any) => any;
let validateModelEndpoint: (value: string, provider: string) => string;
let createModelProvider: (getApiKey: () => Promise<string>, fetchImpl: any) => any;
let normalizeUsage: (usage: unknown) => any;
let estimateOpenAiCost: (model: string, usage: any) => any;
let validateSyncPackage: (value: unknown) => unknown;
let mergeSyncData: (current: any, incoming: any) => any;
let fixNoteHierarchy: (notes: any[]) => any[];
let validateImportPreflight: (input: any) => void;
let estimatedImportCalls: (mode: string, chunks: number) => number;
let safeExternalUrl: (value: string) => string | null;
let loadSafeSnapshot: (storage: any, secretStore: any) => Promise<any>;

beforeAll(() => {
  ({ validatePayload, createIpcRegistrar } = require('../electron-dist/ipc-security.cjs'));
  ({ createModelProvider, validateModelEndpoint, normalizeUsage, estimateOpenAiCost } = require('../electron-dist/model-provider.cjs'));
  ({ validateSyncPackage, mergeSyncData, fixNoteHierarchy } = require('../electron-dist/sync-package.cjs'));
  ({ validateImportPreflight, estimatedImportCalls } = require('../electron-dist/import-limits.cjs'));
  ({ safeExternalUrl } = require('../electron-dist/window-security.cjs'));
  ({ loadSafeSnapshot } = require('../electron-dist/key-migration.cjs'));
});

describe('IPC security boundary', () => {
  it('rejects an untrusted sender before invoking a handler', async () => {
    let wrapped: any;
    const ipcMain = { handle: vi.fn((_channel, handler) => { wrapped = handler; }) };
    const webContents = {};
    const handler = vi.fn();
    createIpcRegistrar(ipcMain, () => ({ webContents }))('data:flush', handler);
    expect(() => wrapped({ sender: {} })).toThrow('非应用窗口');
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows only HTTPS and mailto external links', () => {
    expect(safeExternalUrl('https://example.com/docs')).toBe('https://example.com/docs');
    expect(safeExternalUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    expect(safeExternalUrl('http://example.com')).toBeNull();
    expect(safeExternalUrl('file:///C:/secret.txt')).toBeNull();
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
  });

  it('validates revisions, modes, query length and payload size', () => {
    expect(() => validatePayload('data:apply-changes', [{ baseRevision: -1, changes: {} }])).toThrow('baseRevision');
    expect(() => validatePayload('ai:start-markdown-import', [{ selectionId: 's1', mode: 'turbo' }])).toThrow('导入模式');
    expect(() => validatePayload('data:search-notes', ['x'.repeat(501)])).toThrow('搜索条件');
    expect(() => validatePayload('settings:set-api-key', ['x'.repeat(16_385)])).toThrow('API Key');
  });
});

describe('provider policy and accounting', () => {
  it('requires HTTPS remotely and loopback URLs for Ollama', () => {
    expect(() => validateModelEndpoint('http://example.com/v1/chat', 'openai-compatible')).toThrow('HTTPS');
    expect(() => validateModelEndpoint('http://example.com/api/chat', 'ollama')).toThrow('本机');
    expect(validateModelEndpoint('http://127.0.0.1:11434/api/chat', 'ollama')).toContain('127.0.0.1');
  });

  it('keeps provider tokens intact and estimates price separately', () => {
    const usage = normalizeUsage({ prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 100 } });
    expect(usage).toMatchObject({ inputTokens: 1000, outputTokens: 200, cachedInputTokens: 100 });
    expect(estimateOpenAiCost('gpt-4.1-mini', usage).estimatedCostUsd).toBeGreaterThan(0);
  });

  it('retries one 429 response but does not retry authentication failures', async () => {
    const ok = new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }), { status: 200 });
    const throttledFetch = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(ok);
    const provider = createModelProvider(async () => 'secret', throttledFetch);
    await expect(provider.callModel({ provider: 'openai-compatible', endpoint: 'https://example.com/chat', model: 'gpt-4.1-mini' }, 'system', [], 'test')).resolves.toMatchObject({ content: 'OK' });
    expect(throttledFetch).toHaveBeenCalledTimes(2);

    const authFetch = vi.fn().mockResolvedValue(new Response('invalid token=secret', { status: 401 }));
    const authProvider = createModelProvider(async () => 'secret', authFetch);
    await expect(authProvider.callModel({ provider: 'openai-compatible', endpoint: 'https://example.com/chat', model: 'gpt-4.1-mini' }, 'system', [], 'test')).rejects.toThrow('401');
    expect(authFetch).toHaveBeenCalledTimes(1);
  });
});

describe('sync and import contracts', () => {
  it('reads v1 packages but rejects duplicate ids and unknown versions', () => {
    expect(validateSyncPackage({ packageVersion: 1, notes: [] })).toBeTruthy();
    expect(() => validateSyncPackage({ packageVersion: 3, data: {} })).toThrow('版本');
    expect(() => validateSyncPackage({ data: { notes: [{ id: 'n' }, { id: 'n' }] } })).toThrow('重复主键');
  });

  it('migrates a legacy plaintext API key and never returns it to the renderer', async () => {
    const storage = {
      loadSnapshot: vi.fn().mockResolvedValue({ revision: 4, data: { settings: { provider: 'openai-compatible', apiKey: 'legacy-secret' } } }),
      applyChanges: vi.fn().mockResolvedValue({ revision: 5, durable: true }),
      flushData: vi.fn().mockResolvedValue({ revision: 5, durable: true }),
      loadData: vi.fn().mockResolvedValue({ settings: { provider: 'openai-compatible', apiKeyConfigured: true } })
    };
    const secretStore = { setApiKey: vi.fn().mockResolvedValue({ configured: true }), isConfigured: vi.fn().mockResolvedValue(true) };
    const snapshot = await loadSafeSnapshot(storage, secretStore);
    expect(secretStore.setApiKey).toHaveBeenCalledWith('legacy-secret');
    expect(snapshot.revision).toBe(5);
    expect(snapshot.data.settings).toEqual({ provider: 'openai-compatible', apiKeyConfigured: true });
  });

  it('handles concurrent legacy key migrations as one idempotent load', async () => {
    let snapshot = {
      revision: 4,
      data: { settings: { provider: 'openai-compatible', apiKey: 'legacy-secret' } }
    };
    const storage = {
      loadSnapshot: vi.fn(async () => structuredClone(snapshot)),
      applyChanges: vi.fn(async ({ baseRevision }: { baseRevision: number }) => {
        await Promise.resolve();
        if (baseRevision !== snapshot.revision) {
          throw Object.assign(new Error(`数据版本冲突：期望 ${snapshot.revision}`), {
            code: 'REVISION_CONFLICT',
            revision: snapshot.revision
          });
        }
        snapshot = {
          revision: snapshot.revision + 1,
          data: { settings: { provider: 'openai-compatible', apiKeyConfigured: true } }
        };
        return { revision: snapshot.revision, durable: true };
      }),
      flushData: vi.fn(async () => ({ revision: snapshot.revision, durable: true })),
      loadData: vi.fn(async () => structuredClone(snapshot.data))
    };
    const secretStore = {
      setApiKey: vi.fn().mockResolvedValue({ configured: true }),
      isConfigured: vi.fn().mockResolvedValue(true)
    };

    const results = await Promise.all([
      loadSafeSnapshot(storage, secretStore),
      loadSafeSnapshot(storage, secretStore)
    ]);

    expect(results.map((result) => result.revision)).toEqual([5, 5]);
    expect(results.every((result) => result.data.settings.apiKey === undefined)).toBe(true);
    expect(storage.applyChanges).toHaveBeenCalledTimes(2);
  });

  it('repairs orphaned parents and deterministic multi-node cycles', () => {
    const fixed = fixNoteHierarchy([
      { id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'missing' }
    ]);
    expect(fixed.find((note) => note.id === 'a')?.parentId).toBeUndefined();
    expect(fixed.find((note) => note.id === 'c')?.parentId).toBeUndefined();
  });

  it('does not import a secret and removes conversations pointing to absent notes', () => {
    const current = { subjects: [], notes: [], conversations: [], usageRecords: [], settings: { provider: 'local' } };
    const result = mergeSyncData(current, { data: { notes: [], conversations: [{ id: 'c', noteId: 'missing' }], settings: { apiKey: 'leaked' } } });
    expect(result.data.settings.apiKey).toBeUndefined();
    expect(result.data.conversations).toEqual([]);
  });

  it('enforces explicit import caps and estimates each mode', () => {
    expect(() => validateImportPreflight({ fileBytes: 2 * 1024 * 1024 + 1, characterCount: 1, chunkCount: 1 })).toThrow('2MiB');
    expect(() => validateImportPreflight({ fileBytes: 1, characterCount: 160_001, chunkCount: 1 })).toThrow('160,000');
    expect(() => validateImportPreflight({ fileBytes: 1, characterCount: 1, chunkCount: 17 })).toThrow('16');
    expect(estimatedImportCalls('offline', 16)).toBe(0);
    expect(estimatedImportCalls('fast', 4)).toBe(7);
    expect(estimatedImportCalls('deep', 16)).toBeLessThanOrEqual(51);
  });
});
