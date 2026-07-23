const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createStorage } = require('../electron-dist/storage.cjs');

const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const stamp = '2026-01-01T00:00:00.000Z';

function dataset(count) {
  const subjects = [{ id: 's1', name: '性能测试', topics: ['数据库'], createdAt: stamp, updatedAt: stamp }];
  const notes = Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    title: `事务与索引 ${index}`,
    subject: '性能测试',
    topic: '数据库',
    tags: ['sql', '索引'],
    summary: `第 ${index} 篇关于事务、索引、缓存和一致性的笔记。`,
    sections: Array.from({ length: 5 }, (_unused, section) => ({
      id: `n${index}-s${section}`,
      heading: `章节 ${section}`,
      content: `事务隔离 索引优化 缓存一致性 journal checkpoint worker ${index} ${section}`.repeat(10)
    })),
    cases: [], pitfalls: [], interviewQuestions: [], createdAt: stamp, updatedAt: stamp
  }));
  return {
    schemaVersion: 6, subjects, notes, conversations: [], usageRecords: [],
    settings: { provider: 'local', endpoint: '', model: '', apiKey: '', lastTestStatus: 'idle' }
  };
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learnagent-bench-'));
  const storage = createStorage(root);
  try {
    let { revision } = await storage.loadSnapshot();
    let data = dataset(1000);
    ({ revision } = await storage.applyChanges({ baseRevision: revision, changes: { snapshot: data } }));
    let maxEventLoopDelay = 0;
    let previousTick = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      maxEventLoopDelay = Math.max(maxEventLoopDelay, now - previousTick - 5);
      previousTick = now;
    }, 5);
    await storage.flushData();
    clearInterval(ticker);

    const saveTimes = [];
    for (let index = 0; index < 20; index += 1) {
      const changed = { ...data.notes[index], summary: `${data.notes[index].summary} update ${index}`, updatedAt: new Date().toISOString() };
      data = { ...data, notes: data.notes.map((note) => note.id === changed.id ? changed : note) };
      const started = performance.now();
      ({ revision } = await storage.applyChanges({ baseRevision: revision, changes: { notes: { upsert: [changed] } } }));
      saveTimes.push(performance.now() - started);
    }

    await storage.flushData();
    await storage.searchNotes('事务 索引');
    const searchTimes = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      await storage.searchNotes(index % 2 ? '缓存一致性' : '事务 索引');
      searchTimes.push(performance.now() - started);
    }
    const metrics = {
      notes: 1000,
      sectionsPerNote: 5,
      saveAckP95Ms: Number(percentile(saveTimes, 0.95).toFixed(1)),
      searchP95Ms: Number(percentile(searchTimes, 0.95).toFixed(1)),
      checkpointEventLoopDelayMs: Number(maxEventLoopDelay.toFixed(1))
    };
    console.log(JSON.stringify(metrics, null, 2));
    if (metrics.saveAckP95Ms >= 100) throw new Error(`保存 P95 未达标：${metrics.saveAckP95Ms}ms`);
    if (metrics.searchP95Ms >= 150) throw new Error(`搜索 P95 未达标：${metrics.searchP95Ms}ms`);
    if (metrics.checkpointEventLoopDelayMs >= 50) throw new Error(`checkpoint 主线程阻塞未达标：${metrics.checkpointEventLoopDelayMs}ms`);
  } finally {
    await storage.terminate();
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
