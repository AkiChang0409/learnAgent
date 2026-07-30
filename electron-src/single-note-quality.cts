function singleNoteInputMode(input) {
  const text = String(input || '');
  const lineCount = text.split(/\r?\n/).filter((line) => line.trim()).length;
  return text.length >= 600 || lineCount >= 8 || /岗位职责|任职要求|职位描述|需求文档|会议纪要|原文|材料/.test(text)
    ? 'source-material'
    : 'topic-request';
}

function conciseNoteFocus(input) {
  const text = String(input || '').replace(/```[\s\S]*?```/g, ' ').trim();
  const technicalRole = text.match(/(?:人工智能|AI|ML|MLOps|DevOps|DevSecOps|数据|前端|后端|产品)[^\n。；]{0,22}(?:工程师|开发|岗位|职位)/i)?.[0];
  if (technicalRole && /岗位职责|任职要求|职位描述|招聘/.test(text)) {
    return `${technicalRole.replace(/职位$/, '').trim()}能力模型`.slice(0, 40);
  }
  const line = text.split(/\r?\n|[。！？]/)
    .map((item) => item.replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)、])\s*/, '').trim())
    .find((item) => item.length >= 2) || '未命名主题';
  return line
    .replace(/^(?:请|帮我|生成|整理|总结|学习|分析|我想了解)\s*/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 46) || '未命名主题';
}

function singleNotePlainText(draft) {
  return [
    draft?.title,
    draft?.summary,
    ...(draft?.sections || []).map((section) => `${section.heading}\n${section.content}`),
    ...(draft?.cases || []),
    ...(draft?.pitfalls || []),
    ...(draft?.interviewQuestions || [])
  ].filter(Boolean).join('\n');
}

function containsLongVerbatimCopy(input, output, windowSize = 120) {
  const source = String(input || '').replace(/\s+/g, '');
  const result = String(output || '').replace(/\s+/g, '');
  if (source.length < windowSize || result.length < windowSize) return false;
  for (let index = 0; index <= source.length - windowSize; index += Math.max(40, Math.floor(windowSize / 2))) {
    if (result.includes(source.slice(index, index + windowSize))) return true;
  }
  return false;
}

function sectionSimilarity(left, right) {
  const grams = (value) => {
    const text = String(value || '').replace(/[^\p{L}\p{N}]+/gu, '');
    const result = new Set();
    for (let index = 0; index <= text.length - 3; index += 1) result.add(text.slice(index, index + 3));
    return result;
  };
  const a = grams(left);
  const b = grams(right);
  if (a.size < 20 || b.size < 20) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return overlap / Math.min(a.size, b.size);
}

function localSingleNoteQualityReport(input, plan, draft) {
  const sections = Array.isArray(draft?.sections) ? draft.sections : [];
  const text = singleNotePlainText(draft);
  const issues = [];
  if (!draft?.title || String(draft.title).length > 60) issues.push('标题不够聚焦或过长。');
  if (sections.length < 4 || sections.length > 6) issues.push('正文必须收敛为 4 到 6 个职责不同的小节。');
  if (text.length < 750) issues.push('正文解释密度不足，尚未形成高质量单篇笔记。');
  if (String(draft?.summary || '').length > 420) issues.push('摘要过长，疑似承担了正文或复制材料。');
  if (plan.inputMode === 'source-material' && containsLongVerbatimCopy(input, text)) {
    issues.push('检测到大段原文复制，应提炼、解释和重组，而不是重新排版材料。');
  }
  if (!/原理|机制|过程|流程|关系|因果|推导|如何运作/.test(text)) issues.push('缺少原理、机制或因果过程。');
  if (!/边界|条件|限制|失败|误区|不适用|取舍/.test(text)) issues.push('缺少适用条件、失败边界或易错点分析。');
  if (!/拓展理解|迁移|举一反三|变化|替代/.test(text)) issues.push('缺少与核心问题直接相关的迁移或拓展理解。');
  let duplicatedSections = false;
  for (let left = 0; left < sections.length && !duplicatedSections; left += 1) {
    for (let right = left + 1; right < sections.length; right += 1) {
      if (sectionSimilarity(sections[left]?.content, sections[right]?.content) >= 0.72) {
        duplicatedSections = true;
        break;
      }
    }
  }
  if (duplicatedSections) issues.push('不同小节存在大面积同义或重复内容，没有承担独立分析任务。');
  const compactText = text.replace(/\s+/g, '');
  const scopeOutHits = (plan.scopeOut || []).filter((item) => {
    const phrase = String(item || '').replace(/\s+/g, '');
    return phrase.length >= 8 && compactText.includes(phrase);
  });
  if (scopeOutHits.length >= 2) issues.push('正文混入了规划阶段明确排除的内容，单篇范围失焦。');
  return {
    ok: issues.length === 0,
    score: issues.length ? Math.max(35, 88 - issues.length * 10) : 92,
    issues,
    rewriteInstruction: issues.length
      ? `整体重写，不要局部补字：${issues.join('；')} 保留核心问题，删除 scopeOut 和原文复述。`
      : ''
  };
}

module.exports = {
  conciseNoteFocus,
  containsLongVerbatimCopy,
  localSingleNoteQualityReport,
  singleNoteInputMode
};
