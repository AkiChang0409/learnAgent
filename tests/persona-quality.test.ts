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
      summary: '岗位本质是建设稳定的数据平台，适合具备数据工程基础并能承担交付责任的候选人。',
      sections: [
        { heading: '岗位概览', content: '职位：JD 未说明\n薪资：JD 未说明\n公司：JD 未说明\n领域：数据工程\n工作地点/形式：JD 未说明' },
        { heading: '主要工作', content: '- 工作职责：建设并交付稳定的数据平台。' },
        { heading: '职位要求', content: '- 技术：熟悉 SQL。\n- 学历与经验：JD 未说明。\n- 领域知识：数据平台。' },
        { heading: '核心技术要求解释', content: '**SQL｜领域：数据工程**：用于在本岗位中查询、转换和验证平台数据。' },
        { heading: '福利与其他信息', content: 'JD 未说明具体福利' }
      ]
    }, { id: 'job-description-analyst' });
    expect(issues).toEqual([]);
  });

  it('rejects requirement inflation and fabricated public research', () => {
    const issues = localPersonaQualityIssues('岗位要求：熟悉 SQL；Remote。加分项：AWS。', {
      summary: '该岗位要求数据能力。',
      sections: [
        { heading: '岗位概览', content: '职位：工程师\n薪资：JD 未说明\n公司：某公司\n领域：数据\n工作地点/形式：现场' },
        { heading: '主要工作', content: '工作职责：建设数据平台。' },
        { heading: '职位要求', content: '必须精通 SQL。' },
        { heading: '核心技术要求解释', content: 'SQL｜领域：数据，用于岗位查询。' },
        { heading: '福利与其他信息', content: 'JD 未说明具体福利' }
      ],
      collections: [{ id: 'research', title: '研究', items: ['公开资料显示该公司高速增长。'] }]
    }, { id: 'job-description-analyst' });
    expect(issues.join('\n')).toContain('熟悉/了解');
    expect(issues.join('\n')).toContain('外部调研');
    expect(issues.join('\n')).toContain('preferred/optional');
    expect(issues.join('\n')).toContain('远程工作形式');
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
