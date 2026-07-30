import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
let conciseNoteFocus: (input: string) => string;
let containsLongVerbatimCopy: (input: string, output: string, windowSize?: number) => boolean;
let localSingleNoteQualityReport: (input: string, plan: any, draft: any) => any;
let singleNoteInputMode: (input: string) => string;

beforeAll(() => {
  ({
    conciseNoteFocus,
    containsLongVerbatimCopy,
    localSingleNoteQualityReport,
    singleNoteInputMode
  } = require('../electron-dist/single-note-quality.cjs'));
});

describe('single-note focus and quality gate', () => {
  it('recognizes pasted source material and derives a concise focus instead of using the whole input as title', () => {
    const input = `人工智能 MLOps 工程师职位描述\n岗位职责：负责模型训练、部署、监控和持续交付。\n任职要求：熟悉 Kubernetes、MLflow 与 CI/CD。`;
    expect(singleNoteInputMode(input)).toBe('source-material');
    expect(conciseNoteFocus(input)).toContain('能力模型');
    expect(conciseNoteFocus(input).length).toBeLessThanOrEqual(40);
  });

  it('detects long verbatim passages copied from source material', () => {
    const source = '这是一段应当被提炼而不是原样复制的岗位材料。'.repeat(18);
    const output = `核心分析：${source.slice(60, 420)}`;
    expect(containsLongVerbatimCopy(source, output)).toBe(true);
  });

  it('rejects pasted, shallow drafts and accepts a focused explanatory note', () => {
    const source = '岗位要求模型部署监控自动化测试持续交付安全合规与团队协作。'.repeat(25);
    const plan = { inputMode: 'source-material', scopeOut: ['完整岗位职责清单', '无关工具关键词堆砌'] };
    const pasted = {
      title: '岗位解析', summary: '岗位说明',
      sections: [{ heading: '全部内容', content: source }], cases: [], pitfalls: [], interviewQuestions: []
    };
    const rejected = localSingleNoteQualityReport(source, plan, pasted);
    expect(rejected.ok).toBe(false);
    expect(rejected.issues.join('\n')).toContain('大段原文复制');
    expect(rejected.issues.join('\n')).toContain('4 到 6');

    const focused = {
      title: 'MLOps 持续交付闭环',
      summary: '聚焦模型从验证到部署和监控的闭环机制。',
      sections: [
        { heading: '核心问题', content: '模型进入生产环境后，训练结果并不会自然转化为稳定服务。核心问题是如何把代码、数据、模型和配置放进同一条可追踪链路，并让每次变化都能被验证。这个目标决定了流程必须同时关注可复现性、交付速度和运行可靠性，而不是简单堆叠工具。'.repeat(2) },
        { heading: '运行机制', content: '持续交付机制从版本化输入开始，经过自动测试、模型评估、制品登记、分阶段部署和监控反馈。每个阶段都接收前一步的明确产物，并产生可审计状态；只有质量门槛通过才向后推进，因此失败可以定位到具体环节。'.repeat(2) },
        { heading: '条件与失败边界', content: '该流程依赖稳定的数据契约、可重复的运行环境和有效监控。如果数据质量条件不满足，离线指标就不能代表线上效果；如果监控缺失，自动化反而会放大错误。团队需要在发布速度、成本和可靠性之间作出取舍。'.repeat(2) },
        { heading: '拓展理解与迁移', content: '迁移到新团队时，不应直接复制工具清单，而要重新识别审批要求、风险等级和反馈周期。可以从最小闭环开始，再根据变化频率选择替代方案；举一反三的关键是保持验证与反馈机制，而不是绑定某个产品。'.repeat(2) }
      ],
      cases: ['在明确条件下运行流程，观察结果及失败分支。'],
      pitfalls: ['忽略适用边界会导致错误结论。'],
      interviewQuestions: ['条件变化时为什么需要调整机制？']
    };
    expect(localSingleNoteQualityReport('请解释 MLOps 持续交付', { inputMode: 'topic-request', scopeOut: [] }, focused).ok).toBe(true);
  });
});
