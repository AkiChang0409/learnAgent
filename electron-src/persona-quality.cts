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

const JD_SECTION_HEADINGS = [
  '岗位概览',
  '主要工作',
  '职位要求',
  '核心技术要求解释',
  '福利与其他信息'
];

function sentenceCount(value) {
  return (String(value || '').match(/[^。！？.!?]+[。！？.!?]?/g) || []).filter((item) => item.trim()).length;
}

function jdSection(draft, heading) {
  return (draft?.sections || []).find((section) => String(section?.heading || '').trim() === heading);
}

function localPersonaQualityIssues(input, draft, persona) {
  const text = draftText(draft);
  const issues = [];
  if (persona?.id === 'job-description-analyst') {
    const headings = (draft?.sections || []).map((section) => String(section?.heading || '').trim());
    if (headings.length !== JD_SECTION_HEADINGS.length || headings.some((heading, index) => heading !== JD_SECTION_HEADINGS[index])) {
      issues.push('JD 分析必须按顺序且只包含：岗位概览、主要工作、职位要求、核心技术要求解释、福利与其他信息。');
    }
    if (!draft?.summary || sentenceCount(draft.summary) > 2) {
      issues.push('“一句话判断”必须存在且不超过两句话。');
    }
    const overview = String(jdSection(draft, '岗位概览')?.content || '');
    if (!/职位/.test(overview) || !/薪资/.test(overview) || !/公司/.test(overview) || !/领域/.test(overview) || !/地点|工作形式/.test(overview)) {
      issues.push('岗位概览必须明确列出职位、薪资、公司、领域和工作地点/形式。');
    }
    const source = String(input || '');
    if (!/薪资|薪酬|salary|compensation|\$|¥|€|£/i.test(source) && !/薪资[^\n。]*JD 未说明/.test(overview)) {
      issues.push('JD 未披露薪资时必须明确写“薪资：JD 未说明”。');
    }
    const benefits = String(jdSection(draft, '福利与其他信息')?.content || '');
    if (!/福利|奖金|股权|保险|假期|签证|轮班|旅行|benefit|bonus|equity|visa/i.test(source)
      && !/JD 未说明具体福利/.test(benefits)) {
      issues.push('JD 未披露福利时必须明确写“JD 未说明具体福利”。');
    }
    const mainWork = String(jdSection(draft, '主要工作')?.content || '').trim();
    const requirements = String(jdSection(draft, '职位要求')?.content || '').trim();
    if (!mainWork || !requirements) {
      issues.push('JD 分析必须提炼主要工作和职位要求；原文缺失时也要明确写“JD 未说明”。');
    }
    if (/(加分|优先|preferred|nice[ -]to[ -]have|optional)/i.test(source)
      && !/(加分|优先|preferred|optional)/i.test(text)) {
      issues.push('JD 中的 preferred/optional 条件必须与核心要求分开保留。');
    }
    if (/(熟悉|了解|familiar with|exposure to)/i.test(source) && /(精通|专家级|必须精通)/.test(text)) {
      issues.push('不得把 JD 中“熟悉/了解”的要求升级为“精通/专家级”。');
    }
    if (!hasCandidateEvidence(input) && /(匹配度|胜任度|适配度)\s*(?:为|是|[:：])?\s*\d+%|你(?:已经|完全)?具备|你非常适合/.test(text)) {
      issues.push('未提供候选人经历时不得生成匹配度或声称用户具备岗位能力。');
    }
    if (!/(公开资料|来源|https?:\/\/)/i.test(source) && /(公开资料显示|结合公开信息判断|经公开资料核实)/.test(text)) {
      issues.push('当前输入没有可信公开来源，不得声称已经完成外部调研。');
    }
    const technology = String(jdSection(draft, '核心技术要求解释')?.content || '');
    if (!/JD 未说明核心技术要求/.test(technology) && (!/领域/.test(technology) || !/用于|在本岗位|工作中|岗位用途/.test(technology))) {
      issues.push('决定性技术必须解释它是什么、所属领域以及在本岗位中的实际用途。');
    }
    const criticalSignals: Array<[RegExp, RegExp, string]> = [
      [/远程|remote/i, /远程|remote/i, '远程工作形式'],
      [/混合|hybrid/i, /混合|hybrid/i, '混合工作形式'],
      [/签证|visa/i, /签证|visa/i, '签证条件'],
      [/轮班|shift/i, /轮班|shift/i, '轮班条件'],
      [/出差|旅行|travel/i, /出差|旅行|travel/i, '出差或旅行要求']
    ];
    for (const [sourcePattern, outputPattern, label] of criticalSignals) {
      if (sourcePattern.test(source) && !outputPattern.test(text)) issues.push(`必须保留 JD 中的${label}。`);
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
