import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
let api: any;

beforeAll(() => {
  api = require('../electron-dist/persona-registry.cjs');
});

describe('Agent Persona registry', () => {
  it('publishes three prompt-free, versioned Persona summaries', () => {
    const catalog = api.publicPersonaCatalog();
    expect(catalog.map((persona: any) => persona.id)).toEqual([
      'learning-notes',
      'job-description-analyst',
      'codebase-technical-analyst'
    ]);
    expect(catalog.every((persona: any) => persona.version === 1)).toBe(true);
    expect(JSON.stringify(catalog)).not.toContain('domainSystem');
  });

  it('composes platform, Persona and stage contracts in a stable order', () => {
    const persona = api.resolvePersona({ id: 'job-description-analyst', version: 1 }, {
      operation: 'generate', executionProfile: 'focused', provider: 'openai-compatible'
    });
    const prompt = api.composePersonaSystem(persona, 'STAGE_CONTRACT', 'generate');
    expect(prompt.indexOf('平台边界')).toBeLessThan(prompt.indexOf('Job Description'));
    expect(prompt.indexOf('Job Description')).toBeLessThan(prompt.indexOf('STAGE_CONTRACT'));
    expect(prompt).toContain('禁止生成个人匹配分数');
    expect(prompt).toContain('岗位概览、主要工作、职位要求、核心技术要求解释、福利与其他信息');
    expect(prompt).toContain('JD 未说明');
    expect(prompt).toContain('没有网页浏览能力');
  });

  it('rejects unknown, unsupported and model-less professional modes', () => {
    expect(() => api.resolvePersona({ id: 'missing', version: 1 })).toThrow('未知 Agent Persona');
    expect(() => api.resolvePersona({ id: 'job-description-analyst', version: 1 }, {
      operation: 'import', executionProfile: 'offline', provider: 'openai-compatible'
    })).toThrow('不支持 offline');
    expect(() => api.resolvePersona({ id: 'codebase-technical-analyst', version: 1 }, {
      operation: 'chat', provider: 'local'
    })).toThrow('需要配置模型');
  });

  it('decorates the same legacy draft with Persona-specific document collections', () => {
    const draft = {
      title: '输入', summary: '摘要', sections: [], tags: [],
      cases: ['显式要求'], pitfalls: ['信息缺口'], interviewQuestions: ['如何验证？']
    };
    const learning = api.decorateDocumentDraft(draft, api.PERSONA_REGISTRY['learning-notes']);
    const jd = api.decorateDocumentDraft(draft, api.PERSONA_REGISTRY['job-description-analyst']);
    const project = api.decorateDocumentDraft(draft, api.PERSONA_REGISTRY['codebase-technical-analyst']);
    expect(learning.collections.map((item: any) => item.title)).toContain('案例');
    expect(jd.collections.map((item: any) => item.title)).toContain('岗位关键信息');
    expect(project.collections.map((item: any) => item.title)).toContain('代码证据');
    expect(new Set([learning.summaryLabel, jd.summaryLabel, project.summaryLabel]).size).toBe(3);
  });

  it('collapses JD imports to one document while preserving project knowledge maps', () => {
    const map = {
      subject: '分析', title: '材料', overview: '总览', tags: [],
      topics: [
        { title: '职责', summary: '', notes: [{ title: '职责', summary: '', sections: [{ heading: '职责', content: '交付' }], cases: [], pitfalls: [], interviewQuestions: [] }] },
        { title: '要求', summary: '', notes: [{ title: '要求', summary: '', sections: [{ heading: '要求', content: '能力' }], cases: [], pitfalls: [], interviewQuestions: [] }] }
      ]
    };
    const jd = api.decorateKnowledgeMap(map, api.PERSONA_REGISTRY['job-description-analyst']);
    const project = api.decorateKnowledgeMap(map, api.PERSONA_REGISTRY['codebase-technical-analyst']);
    expect(jd.topics).toHaveLength(1);
    expect(jd.topics[0].notes).toHaveLength(1);
    expect(jd.topics[0].notes[0].sections.map((section: any) => section.heading)).toEqual([
      '岗位概览',
      '主要工作',
      '职位要求',
      '核心技术要求解释',
      '福利与其他信息'
    ]);
    expect(project.topics).toHaveLength(2);
  });
});
