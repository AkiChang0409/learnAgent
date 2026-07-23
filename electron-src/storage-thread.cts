const { parentPort, workerData } = require('node:worker_threads');
const { createStorage } = require('./storage-core.cjs');

if (!parentPort) throw new Error('storage-thread must run inside a Worker');
const storage = createStorage(workerData.userDataPath);

parentPort.on('message', async (message) => {
  const { id, method, args = [] } = message || {};
  try {
    const fn = storage[method];
    if (typeof fn !== 'function') throw new Error(`未知存储操作：${method}`);
    const result = await fn(...args);
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: error?.code,
        revision: error?.revision
      }
    });
  }
});
