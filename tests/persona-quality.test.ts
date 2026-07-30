import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
let localPersonaQualityIssues: (input: string, draft: any, persona: any) => string[];

beforeAll(() => {
  ({ localPersonaQualityIssues } = require('../electron-dist/persona-quality.cjs'));
});

describe('Persona-specific local quality gates', () => {
  it('rejects invented JD fit claims without candidate evidence', () => {
    const issues = localPersonaQualityIssues('岗位职责：建设数据平台。任职要求：熟悉 SQL。', {
      summary: '你的匹配度为 92%，你非常适合。',
      sections: [
        { heading: '岗位职责与交付', content: '职责是建设平台，交付稳定数据。' },
        { heading: '能力要求', content: '原文明确要求 SQL；其他信息待确认。' }
      ]
    }, { id: 'job-description-analyst' });
    expect(issues.join('\n')).toContain('不得生成匹配度');
  });

  it('accepts an evidence-bounded JD analysis', () => {
    const issues = localPersonaQualityIssues('岗位职责：建设数据平台。任职要求：熟悉 SQL。', {
      summary: '岗位目标是交付稳定的数据平台。',
      sections: [
        { heading: '职责与交付', content: 'JD 原文明示建设职责，对应交付物是数据平台。' },
        { heading: '能力链', content: '明确要求 SQL；云平台经验属于合理推断，仍待确认。' }
      ]
    }, { id: 'job-description-analyst' });
    expect(issues).toEqual([]);
  });

  it('requires project analysis to cover evidence, data flow and tradeoffs', () => {
    const weak = localPersonaQualityIssues('项目资料', {
      summary: '这是一个 React 项目。', sections: [{ heading: '模块', content: '包含多个组件。' }]
    }, { id: 'codebase-technical-analyst' });
    expect(weak).toHaveLength(3);

    const strong = localPersonaQualityIssues('项目资料', {
      summary: '代码证据表明该项目采用分层架构。',
      sections: [
        { heading: '架构与模块', content: '入口组件调用服务模块。' },
        { heading: '数据流', content: '请求经过 IPC 调用链后更新状态。' },
        { heading: '工程取舍与风险', content: '该实现以复杂度换取边界安全，失败时使用回退。' }
      ]
    }, { id: 'codebase-technical-analyst' });
    expect(strong).toEqual([]);
  });
});
