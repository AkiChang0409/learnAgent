import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
let registry: Record<string, { system: string }>;

beforeAll(() => {
  ({ AGENT_REGISTRY: registry } = require('../electron-dist/agent-registry.cjs'));
});

describe('Markdown import depth contracts', () => {
  it('separates evidence-backed facts, reasoned inference and general extensions', () => {
    expect(registry['project.analysis-master'].system).toContain('可推断');
    expect(registry['project.analysis-master'].system).toContain('拓展思考');
    expect(registry['project.analysis-critic'].system).toContain('三层边界');
  });

  it('requires planning, writing and validation to pursue causal depth', () => {
    expect(registry['subject.orchestrator'].system).toContain('reasoningQuestions');
    expect(registry['topic.note-writer'].system).toContain('失败与边界');
    expect(registry['note.enricher'].system).toContain('迁移条件');
    expect(registry['knowledge.validator'].system).toContain('因果链');
  });
});
