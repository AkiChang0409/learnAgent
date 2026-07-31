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

  it('gives single-note generation its own focus and anti-copy review stages', () => {
    expect(registry['note.focus-planner'].system).toContain('scopeOut');
    expect(registry['note.generator'].system).toContain('只围绕 focusQuestion');
    expect(registry['note.quality-critic'].system).toContain('大段照抄');
  });

  it('compiles JD Analysis into one Persona with a dedicated internal workflow', () => {
    expect(registry['jd.analysis-planner'].system).toContain('required、preferred、optional');
    expect(registry['jd.analysis-writer'].system).toContain('岗位概览、主要工作、职位要求、核心技术要求解释、福利与其他信息');
    expect(registry['jd.analysis-writer'].system).toContain('当前运行时不能浏览网页');
    expect(registry['jd.analysis-critic'].system).toContain('市场薪酬不得冒充岗位开价');
  });
});
