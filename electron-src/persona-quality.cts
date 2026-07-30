function draftText(draft) {
  return [
    draft?.title,
    draft?.summary,
    ...(draft?.sections || []).map((section) => `${section.heading}\n${section.content}`),
    ...(draft?.collections || []).flatMap((collection) => collection.items || []),
    ...(draft?.cases || []),
    ...(draft?.pitfalls || []),
    ...(draft?.interviewQuestions || [])
  ].filter(Boolean).join('\n');
}

function hasCandidateEvidence(input) {
  return /我的经历|我的简历|候选人|工作经历|项目经历|我负责|我曾|本人|resume|curriculum vitae|\bCV\b/i.test(String(input || ''));
}

function localPersonaQualityIssues(input, draft, persona) {
  const text = draftText(draft);
  const issues = [];
  if (persona?.id === 'job-description-analyst') {
    if (!/职责|交付|目标/.test(text) || !/能力|要求|技能/.test(text)) {
      issues.push('JD 分析必须建立岗位职责、交付物与能力要求之间的关系。');
    }
    if (!hasCandidateEvidence(input) && /(匹配度|胜任度|适配度)\s*(?:为|是|[:：])?\s*\d+%|你(?:已经|完全)?具备|你非常适合/.test(text)) {
      issues.push('未提供候选人经历时不得生成匹配度或声称用户具备岗位能力。');
    }
    if (!/明示|明确|JD|原文/.test(text) || !/推断|待确认|无法确认|信息缺口/.test(text)) {
      issues.push('JD 分析必须区分原文明示事实、合理推断和待确认信息。');
    }
  }
  if (persona?.id === 'codebase-technical-analyst') {
    if (!/架构|模块|组件/.test(text) || !/数据流|调用链|流程|状态变化/.test(text)) {
      issues.push('项目解析必须覆盖架构协作和至少一条数据流或调用链。');
    }
    if (!/证据|文件|代码|实现/.test(text)) {
      issues.push('项目实现断言必须带有可回溯的代码分析证据。');
    }
    if (!/取舍|权衡|边界|失败|风险/.test(text)) {
      issues.push('项目解析必须解释工程取舍、失败边界或风险。');
    }
  }
  return issues;
}

module.exports = { draftText, hasCandidateEvidence, localPersonaQualityIssues };
