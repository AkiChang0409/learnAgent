import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
let buildAgentRetryPrompt: (userContent: string, error: Error) => string;
let coerceAgentStringArray: (value: unknown) => string[];
let isAgentOutputError: (error: unknown) => boolean;
let normalizeAgentOutput: (agentId: string, value: unknown) => any;
let validateAgentOutput: (agentId: string, value: unknown) => void;

beforeAll(() => {
  ({
    buildAgentRetryPrompt,
    coerceAgentStringArray,
    isAgentOutputError,
    normalizeAgentOutput,
    validateAgentOutput
  } = require('../electron-dist/agent-output.cjs'));
});

describe('agent output boundary', () => {
  it('keeps valid arrays and repairs scalar or Markdown-list values', () => {
    expect(coerceAgentStringArray(['案例一', '案例二'])).toEqual(['案例一', '案例二']);
    expect(coerceAgentStringArray('单个案例')).toEqual(['单个案例']);
    expect(coerceAgentStringArray('- 案例一\n2. 案例二')).toEqual(['案例一', '案例二']);
  });

  it('normalizes recoverable note.enricher fields before contract validation', () => {
    const normalized = normalizeAgentOutput('note.enricher', {
      noteTaskId: 'task-1',
      cases: '案例一',
      pitfalls: '- 易错点一\n- 易错点二',
      interviewQuestions: null,
      suggestedTags: 'Agent',
      usedEvidenceIds: ['evidence-1']
    });

    expect(normalized).toMatchObject({
      cases: ['案例一'],
      pitfalls: ['易错点一', '易错点二'],
      interviewQuestions: [],
      suggestedTags: ['Agent'],
      usedEvidenceIds: ['evidence-1']
    });
    expect(() => validateAgentOutput('note.enricher', normalized)).not.toThrow();
  });

  it('keeps missing required fields strict and classifies the failure as recoverable output error', () => {
    const normalized = normalizeAgentOutput('note.enricher', { cases: [], pitfalls: [] });
    let caught: any;
    try {
      validateAgentOutput('note.enricher', normalized);
    } catch (error) {
      caught = error;
    }

    expect(caught?.message).toContain('interviewQuestions');
    expect(isAgentOutputError(caught)).toBe(true);
  });

  it('adds precise JSON correction instructions on retry', () => {
    const error = Object.assign(new Error('note.enricher 输出字段 cases 必须是数组'), {
      code: 'AGENT_OUTPUT_CONTRACT'
    });
    const retry = buildAgentRetryPrompt('原始任务', error);
    expect(retry).toContain('原始任务');
    expect(retry).toContain('cases 必须是数组');
    expect(retry).toContain('即使没有内容也返回 []');
    expect(retry).toContain('不要输出 Markdown');
  });

  it('does not classify provider or cancellation errors as model-output errors', () => {
    expect(isAgentOutputError(new Error('401 unauthorized'))).toBe(false);
    expect(isAgentOutputError(new Error('IMPORT_CANCELED'))).toBe(false);
    expect(isAgentOutputError(new Error('AGENT_CALL_BUDGET_EXCEEDED'))).toBe(false);
  });

  it('requires the emphasis analyzer to return summary and section plans', () => {
    expect(() => validateAgentOutput('note.emphasis', {
      summary: { boldPhrases: [], tones: [], highlights: [] },
      sections: []
    })).not.toThrow();
    expect(() => validateAgentOutput('note.emphasis', { summary: {}, sections: 'bad' })).toThrow('sections');
  });

  it('validates the focused note planner and critic contracts', () => {
    const plan = normalizeAgentOutput('note.focus-planner', {
      title: '聚焦主题',
      scopeIn: '核心机制',
      scopeOut: [],
      keyPoints: ['因果链'],
      reasoningQuestions: ['为什么？'],
      extensionDirections: ['迁移条件'],
      evidenceItems: []
    });
    expect(plan.scopeIn).toEqual(['核心机制']);
    expect(() => validateAgentOutput('note.focus-planner', plan)).not.toThrow();
    expect(() => validateAgentOutput('note.quality-critic', {
      ok: false,
      score: 55,
      issues: ['复制原文'],
      rewriteInstruction: '整体重写'
    })).not.toThrow();
    expect(() => validateAgentOutput('note.quality-critic', { ok: 'yes', issues: [] })).toThrow('ok');
  });
});
