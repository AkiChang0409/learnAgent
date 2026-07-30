import codebaseTechnicalAnalysisSkill from './codebase-technical-analysis-writer.md?raw';

export interface ProductTip {
  id: string;
  index: number;
  category: string;
  official: boolean;
  title: string;
  summary: string;
  steps: string[];
  version: string;
  updatedAt: string;
  fileName: string;
  content: string;
  codexPrompt: string;
}

export const PRODUCT_TIPS: ProductTip[] = [
  {
    id: 'codex-project-analysis',
    index: 1,
    category: '项目笔记',
    official: true,
    title: '先用 Codex 生成项目技术分析 Markdown',
    summary: '直接导入普通 README 往往缺少架构、数据流和代码证据。把这份 Skill 放进 Codex 项目，让 Codex 先读代码并生成高质量分析文档，再导入 LearnAgent。',
    steps: [
      '复制或下载完整 Skill 内容',
      '保存为 .agents/skills/codebase-technical-analysis-writer/SKILL.md',
      '让 Codex 生成 Markdown，再导入 LearnAgent'
    ],
    version: '1.0.0',
    updatedAt: '2026-07-27',
    fileName: 'SKILL.md',
    content: codebaseTechnicalAnalysisSkill,
    codexPrompt: '请使用 codebase-technical-analysis-writer skill 深入分析当前项目，读取实际代码并生成一份可导入 LearnAgent 的中文 Markdown 技术分析文档。必须覆盖真实需求、核心流程、总体架构、关键模块、数据模型与数据流、核心技术机制、工程亮点、技术难点、技术债、演进方向、面试讲述稿和代码证据索引；合理推断请明确标注“可推断”，证据不足请明确说明。'
  }
];

export const PROJECT_ANALYSIS_TIP = PRODUCT_TIPS[0];
