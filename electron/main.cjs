const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createStorage } = require('./storage.cjs');

const isDev = !app.isPackaged;
let storage = null;

const OPENAI_PRICES_PER_MILLION = [
  ['gpt-4.1-mini', { input: 0.4, cachedInput: 0.1, output: 1.6 }],
  ['gpt-4.1', { input: 2, cachedInput: 0.5, output: 8 }],
  ['gpt-4o-mini', { input: 0.15, cachedInput: 0.075, output: 0.6 }],
  ['gpt-4o', { input: 2.5, cachedInput: 1.25, output: 10 }],
  ['gpt-5.6-sol', { input: 5, cachedInput: 0.5, output: 30 }],
  ['gpt-5.6-terra', { input: 2.5, cachedInput: 0.25, output: 15 }],
  ['gpt-5.6-luna', { input: 1, cachedInput: 0.1, output: 6 }],
  ['gpt-5.6', { input: 5, cachedInput: 0.5, output: 30 }],
  ['chat-latest', { input: 5, cachedInput: 0.5, output: 30 }],
  ['o4-mini', { input: 1.1, cachedInput: 0.275, output: 4.4 }],
  ['o3', { input: 1, cachedInput: 0.25, output: 4 }]
];

function getStorage() {
  if (!storage) {
    storage = createStorage(app.getPath('userData'));
  }
  return storage;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: 'LearnAgent',
    backgroundColor: '#f4f1ea',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    win.loadURL('http://127.0.0.1:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function asMessages(system, messages) {
  return [{ role: 'system', content: system }, ...messages.map((item) => ({
    role: item.role,
    content: item.content
  }))];
}

function createUsageId() {
  return `usage_${randomUUID()}`;
}

function normalizeModelName(model) {
  return String(model || '').trim().toLowerCase();
}

function findOpenAiPrice(model) {
  const name = normalizeModelName(model);
  if (!name) return null;
  return OPENAI_PRICES_PER_MILLION.find(([prefix]) => name === prefix || name.startsWith(`${prefix}-`))?.[1] || null;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? inputTokens + outputTokens) || 0;
  const inputDetails = usage.input_tokens_details || usage.prompt_tokens_details || {};
  const outputDetails = usage.output_tokens_details || usage.completion_tokens_details || {};
  const cachedInputTokens = Number(inputDetails.cached_tokens ?? inputDetails.cache_read_tokens ?? 0) || 0;
  const reasoningTokens = Number(outputDetails.reasoning_tokens ?? 0) || 0;

  if (!inputTokens && !outputTokens && !totalTokens) return null;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    reasoningTokens
  };
}

function estimateOpenAiCost(model, usage) {
  const price = findOpenAiPrice(model);
  if (!price || !usage) return { estimatedCostUsd: null, priceSource: 'unknown' };
  const cachedInputTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const uncachedInputTokens = Math.max(usage.inputTokens - cachedInputTokens, 0);
  const estimatedCostUsd =
    (uncachedInputTokens / 1_000_000) * price.input +
    (cachedInputTokens / 1_000_000) * price.cachedInput +
    (usage.outputTokens / 1_000_000) * price.output;
  return {
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
    priceSource: 'built-in-openai-api-pricing-2026-07-21'
  };
}

function createUsageRecord(settings, operation, rawUsage, responseId = '') {
  const usage = normalizeUsage(rawUsage);
  if (!usage) return null;
  const provider = settings?.provider || 'local';
  const model = settings?.model || '';
  const cost = provider === 'openai-compatible'
    ? estimateOpenAiCost(model, usage)
    : { estimatedCostUsd: 0, priceSource: provider === 'ollama' ? 'local-runtime' : 'unknown' };

  return {
    id: createUsageId(),
    createdAt: new Date().toISOString(),
    operation,
    provider,
    endpoint: settings?.endpoint || '',
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningTokens,
    estimatedCostUsd: cost.estimatedCostUsd,
    currency: 'usd',
    priceSource: cost.priceSource,
    responseId
  };
}

function aggregateUsageRecords(records, settings, operation) {
  const validRecords = records.filter(Boolean);
  if (!validRecords.length) return null;
  const knownCosts = validRecords
    .map((record) => record.estimatedCostUsd)
    .filter((value) => typeof value === 'number');
  return {
    id: createUsageId(),
    createdAt: new Date().toISOString(),
    operation,
    provider: settings?.provider || 'local',
    endpoint: settings?.endpoint || '',
    model: settings?.model || '',
    inputTokens: validRecords.reduce((sum, record) => sum + Number(record.inputTokens || 0), 0),
    outputTokens: validRecords.reduce((sum, record) => sum + Number(record.outputTokens || 0), 0),
    totalTokens: validRecords.reduce((sum, record) => sum + Number(record.totalTokens || 0), 0),
    cachedInputTokens: validRecords.reduce((sum, record) => sum + Number(record.cachedInputTokens || 0), 0),
    reasoningTokens: validRecords.reduce((sum, record) => sum + Number(record.reasoningTokens || 0), 0),
    estimatedCostUsd: knownCosts.length === validRecords.length
      ? Number(knownCosts.reduce((sum, value) => sum + value, 0).toFixed(8))
      : null,
    currency: 'usd',
    priceSource: Array.from(new Set(validRecords.map((record) => record.priceSource || 'unknown'))).join('+'),
    responseId: ''
  };
}

async function callModel(settings, system, messages, operation = 'unknown') {
  const provider = settings?.provider || 'local';
  if (provider === 'local') {
    throw new Error('LOCAL_PROVIDER');
  }

  if (provider === 'ollama') {
    const endpoint = settings?.endpoint || 'http://127.0.0.1:11434/api/chat';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings?.model || 'llama3.1',
        messages: asMessages(system, messages),
        stream: false
      })
    });
    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status}`);
    }
    const data = await response.json();
    return {
      content: data?.message?.content || '',
      usageRecord: createUsageRecord(
        settings,
        operation,
        {
          prompt_tokens: data?.prompt_eval_count || 0,
          completion_tokens: data?.eval_count || 0,
          total_tokens: (data?.prompt_eval_count || 0) + (data?.eval_count || 0)
        },
        ''
      )
    };
  }

  const endpoint = settings?.endpoint || 'https://api.openai.com/v1/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (settings?.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings?.model || 'gpt-4.1-mini',
      messages: asMessages(system, messages),
      temperature: 0.35
    })
  });
  if (!response.ok) {
    throw new Error(`AI request failed: ${response.status}`);
  }
  const data = await response.json();
  return {
    content: data?.choices?.[0]?.message?.content || '',
    usageRecord: createUsageRecord(settings, operation, data?.usage, data?.id || '')
  };
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model response.');
  }
  return JSON.parse(source.slice(start, end + 1));
}

function localGeneratedNote(input) {
  const cleanInput = String(input || '').trim();
  const subject = inferSubject(cleanInput);
  const topic = cleanInput
    .replace(/今天|学习|学了|主题|关于|请|总结|知识点/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || cleanInput || '未命名主题';

  return {
    title: `${topic}学习总结`,
    subject,
    topic,
    tags: Array.from(new Set([subject, ...topic.split(/[，,、\s]+/).filter(Boolean).slice(0, 4)])),
    summary: `${topic}的学习可以按“概念定义、核心机制、典型场景、常见误区、可迁移问题”来整理。当前处于本地兜底模式，建议在设置中接入 Ollama 或 OpenAI-compatible 接口获得更细的学科推理与案例。`,
    sections: [
      {
        heading: '核心知识点',
        content: [
          `先明确${topic}解决的问题、输入输出、约束条件和适用边界。`,
          '把概念拆成定义、组成部分、运行流程、关键公式或规则，并记录每一步的因果关系。',
          '用自己的话复述一次，再用一个反例检查是否真的理解边界。'
        ].join('\n')
      },
      {
        heading: '学习路径',
        content: [
          '1. 先写出一句话定义。',
          '2. 画出流程或结构关系。',
          '3. 找一个小案例手动推演。',
          '4. 总结最容易混淆的两个点。',
          '5. 用面试问答检验表达。'
        ].join('\n')
      }
    ],
    cases: [
      `案例：把${topic}应用到一个最小问题中，记录初始条件、执行过程和结果解释。`,
      `迁移：尝试换一个约束条件，观察${topic}的结论是否还成立。`
    ],
    pitfalls: [
      '只背定义但没有说明适用前提。',
      '把相似概念混用，忽略输入、输出或目标函数的差异。',
      '会做题但无法解释为什么这样做。'
    ],
    interviewQuestions: [
      `请用一分钟解释${topic}是什么，以及它主要解决什么问题？`,
      `如果${topic}的前提条件不满足，会发生什么？`,
      `请举一个${topic}的真实应用案例，并说明关键决策点。`
    ]
  };
}

function stripMarkdown(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, (block) => block.slice(0, 1200))
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}[-*+]\s+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractMarkdownHeadings(markdown) {
  return Array.from(String(markdown || '').matchAll(/^(#{1,4})\s+(.+)$/gm))
    .map((match) => ({
      level: match[1].length,
      title: match[2].replace(/[#*_`]/g, '').trim()
    }))
    .filter((heading) => heading.title)
    .slice(0, 80);
}

function chunkMarkdown(markdown, maxChars = 9000) {
  const text = stripMarkdown(markdown);
  if (text.length <= maxChars) return [text];
  const blocks = text.split(/\n(?=#{1,3}\s+)/g);
  const chunks = [];
  let current = '';
  blocks.forEach((block) => {
    if ((current + '\n' + block).length > maxChars && current) {
      chunks.push(current.trim());
      current = block;
    } else {
      current = [current, block].filter(Boolean).join('\n');
    }
  });
  if (current.trim()) chunks.push(current.trim());
  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxChars) return [chunk];
    const parts = [];
    for (let index = 0; index < chunk.length; index += maxChars) {
      parts.push(chunk.slice(index, index + maxChars));
    }
    return parts;
  });
}

async function buildMarkdownImportContent(settings, fileName, headings, chunks) {
  const headingText = headings.map((heading) => `${'#'.repeat(heading.level)} ${heading.title}`).join('\n') || '无明显标题';
  if (chunks.length <= 6) {
    return {
      content: [
        `文件名：${fileName}`,
        `标题结构：\n${headingText}`,
        `全文分块数量：${chunks.length}`,
        chunks.map((chunk, index) => `--- Markdown Chunk ${index + 1}/${chunks.length} ---\n${chunk}`).join('\n\n')
      ].join('\n\n'),
      usageRecords: []
    };
  }

  const chunkSystem = [
    '你是一个项目文档和学习资料分析助手。',
    '你会收到 Markdown 的一个连续分块，需要提取该分块里的有效知识，不要扩写。',
    '如果是项目文档，提取功能点、技术实现、亮点、难点、解决方案、工程取舍和可复用经验。',
    '如果是学科资料，提取概念、案例、易错点、边界条件和复习问题。',
    '输出简洁中文要点，保留事实和判断依据。'
  ].join('\n');
  const summaries = [];
  const usageRecords = [];

  for (const [index, chunk] of chunks.entries()) {
    const result = await callModel(
      settings,
      chunkSystem,
      [{
        role: 'user',
        content: [
          `文件名：${fileName}`,
          `标题结构：\n${headingText}`,
          `当前分块：${index + 1}/${chunks.length}`,
          chunk
        ].join('\n\n')
      }],
      'import-markdown'
    );
    summaries.push(`--- Chunk ${index + 1}/${chunks.length} 提炼 ---\n${result.content}`);
    if (result.usageRecord) usageRecords.push(result.usageRecord);
  }

  return {
    content: [
      `文件名：${fileName}`,
      `标题结构：\n${headingText}`,
      `全文分块数量：${chunks.length}`,
      '以下内容来自对完整 Markdown 的逐块提炼，请基于全部分块生成最终知识地图。',
      summaries.join('\n\n')
    ].join('\n\n'),
    usageRecords
  };
}

function inferMarkdownSubject(fileName, markdown) {
  const text = `${fileName}\n${markdown}`.toLowerCase();
  if (/react|typescript|electron|vite|sqlite|api|架构|项目|代码|开发|数据库|前端|后端/.test(text)) {
    return '项目技术方案';
  }
  if (/网络|协议|算法|操作系统|数据库|计算机/.test(text)) return '计算机科学';
  if (/产品|用户|需求|商业|增长/.test(text)) return '产品与业务';
  return '综合学习';
}

function localMarkdownImportDraft(fileName, markdown) {
  const headings = extractMarkdownHeadings(markdown);
  const subject = inferMarkdownSubject(fileName, markdown);
  const cleanName = path.basename(fileName, path.extname(fileName)) || 'Markdown 文档';
  const topHeadings = headings.filter((heading) => heading.level <= 2).slice(0, 8);
  const isProject = subject === '项目技术方案';
  const headingText = topHeadings.map((heading) => `- ${heading.title}`).join('\n');
  const summary = isProject
    ? `该文档围绕 ${cleanName} 的项目背景、功能能力、技术实现和工程取舍展开。建议按“功能全景、技术架构、亮点能力、关键难点、解决方案、可复用经验”来学习。`
    : `该文档围绕 ${cleanName} 的核心知识展开。建议按“学科名、主题、核心笔记、分笔记、案例、易错点、复习问题”来学习。`;

  const subNotes = (topHeadings.length ? topHeadings : [{ title: '核心内容', level: 1 }]).slice(0, 6).map((heading, index) => ({
    title: heading.title,
    subject,
    topic: heading.title,
    tags: [subject, cleanName],
    summary: `围绕“${heading.title}”整理该文档中的关键概念、实现方式、判断标准和可复用经验。`,
    sections: [
      {
        heading: '关键要点',
        content: '基于原始 Markdown 自动生成的分笔记。建议接入模型后重新导入，可获得更准确的提炼。'
      },
      {
        heading: '原文结构线索',
        content: headingText || '原文没有明显标题结构。'
      }
    ],
    cases: [],
    pitfalls: [],
    interviewQuestions: [`请解释“${heading.title}”在该文档中的作用和关键结论。`]
  }));

  return {
    title: `${cleanName} 知识地图`,
    subject,
    topic: cleanName,
    tags: [subject, cleanName, isProject ? '项目复盘' : 'Markdown导入'],
    summary,
    sections: [
      {
        heading: isProject ? '项目功能全景' : '学科与主题概览',
        content: headingText || '原文没有明显标题结构，已根据全文生成概览。'
      },
      {
        heading: isProject ? '技术重点与难点' : '核心知识点',
        content: '建议重点关注文档中反复出现的概念、模块边界、设计选择、问题约束和解决方案。'
      },
      {
        heading: '学习路线',
        content: '1. 先读主笔记掌握全局。\n2. 再按分笔记逐个主题拆解。\n3. 最后用面试问题检查是否能讲清楚亮点、难点和取舍。'
      }
    ],
    cases: isProject ? ['把文档中的一个功能模块作为案例，说明它的用户价值、技术实现和工程取舍。'] : [],
    pitfalls: ['只复述目录但没有提炼关键取舍。', '只看实现细节但忽略问题背景和边界条件。'],
    interviewQuestions: isProject
      ? ['这个项目解决了什么问题？', '项目的核心技术亮点是什么？', '遇到的主要难点是什么，对应方案是什么？']
      : ['这个主题的核心概念是什么？', '有哪些容易混淆的边界？', '如何用案例说明这个知识点？'],
    subNotes
  };
}

function normalizeMarkdownImportDraft(value, fileName, markdown) {
  const fallback = localMarkdownImportDraft(fileName, markdown);
  const source = value && typeof value === 'object' ? value : {};
  const normalizeDraft = (draft, fallbackDraft) => ({
    title: String(draft?.title || fallbackDraft.title || 'Markdown 知识地图').trim(),
    subject: String(draft?.subject || fallbackDraft.subject || '综合学习').trim(),
    topic: String(draft?.topic || fallbackDraft.topic || fileName).trim(),
    tags: asStringList(draft?.tags).length ? asStringList(draft.tags) : fallbackDraft.tags,
    summary: String(draft?.summary || fallbackDraft.summary || '').trim(),
    sections: Array.isArray(draft?.sections)
      ? draft.sections.map((section) => ({
          heading: String(section?.heading || '小节').trim(),
          content: String(section?.content || '').trim()
        })).filter((section) => section.content)
      : fallbackDraft.sections,
    cases: asStringList(draft?.cases),
    pitfalls: asStringList(draft?.pitfalls).length ? asStringList(draft.pitfalls) : fallbackDraft.pitfalls,
    interviewQuestions: asStringList(draft?.interviewQuestions).length
      ? asStringList(draft.interviewQuestions)
      : fallbackDraft.interviewQuestions
  });

  const root = normalizeDraft(source, fallback);
  const sourceSubNotes = Array.isArray(source.subNotes) ? source.subNotes : [];
  root.subNotes = (sourceSubNotes.length ? sourceSubNotes : fallback.subNotes)
    .slice(0, 12)
    .map((subNote, index) => normalizeDraft(subNote, fallback.subNotes[index] || fallback.subNotes[0]));
  return root;
}

function inferSubject(input) {
  const text = String(input || '').toLowerCase();
  const rules = [
    ['计算机科学', ['算法', '数据结构', '网络', '数据库', '操作系统', 'react', 'typescript', 'python', 'java', 'ai', '机器学习', '深度学习']],
    ['数学', ['函数', '概率', '统计', '积分', '导数', '矩阵', '线性代数', '微积分']],
    ['英语', ['英语', 'grammar', 'vocabulary', 'listening', 'speaking', 'reading']],
    ['经济金融', ['经济', '金融', '股票', '会计', '财报', '利率', '通胀']],
    ['物理', ['力学', '电磁', '量子', '热学', '物理']],
    ['产品与管理', ['产品', '管理', 'okr', '项目', '需求', '用户']]
  ];
  const hit = rules.find(([, words]) => words.some((word) => text.includes(word)));
  return hit ? hit[0] : '通用学习';
}

function localChatAnswer(question, context, note) {
  const contextText = String(context || '').trim();
  const title = note?.title || note?.topic || '当前笔记';
  if (!contextText) {
    return `我已经在看《${title}》，但没有检索到足够明确的上下文。你可以先补充一个小节，或把问题问得更具体一些。`;
  }
  const clipped = contextText.split('\n').filter(Boolean).slice(0, 8).join('\n');
  return [
    `基于《${title}》里的内容，我会这样理解：`,
    clipped,
    '',
    `针对你的问题“${question}”，可以先抓住笔记中反复出现的概念、条件和案例，再把它整理成定义、原因、例子、误区四步。当前是本地兜底回答；接入模型后会根据检索片段生成更自然的解释。`
  ].join('\n');
}

function clipText(value, max = 900) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatDialogue(messages, limit = 14) {
  return (messages || [])
    .slice(-limit)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${clipText(message.content, 900)}`)
    .join('\n');
}

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function localConversationMemory(note, previousSummary, messages) {
  const title = note?.title || note?.topic || '当前笔记';
  const dialogue = formatDialogue(messages, 10);
  const questionLines = (messages || [])
    .filter((message) => message.role === 'user')
    .slice(-5)
    .map((message) => `- ${clipText(message.content, 160)}`)
    .join('\n');

  return [
    previousSummary ? `已有记忆：${clipText(previousSummary, 900)}` : '',
    `阶段性记忆：用户围绕《${title}》继续追问、澄清和迁移应用。`,
    questionLines ? `最近关注点：\n${questionLines}` : '',
    dialogue ? `最近对话摘要材料：\n${clipText(dialogue, 1300)}` : ''
  ].filter(Boolean).join('\n\n');
}

function localDistillationPatch(note, memorySummary, messages) {
  const title = note?.title || note?.topic || '当前笔记';
  const userQuestions = (messages || [])
    .filter((message) => message.role === 'user')
    .slice(-6)
    .map((message) => clipText(message.content, 180));
  const assistantAnswers = (messages || [])
    .filter((message) => message.role === 'assistant')
    .slice(-4)
    .map((message) => clipText(message.content, 360));
  const summaryAppend = memorySummary
    ? clipText(memorySummary, 1100)
    : `本次对话围绕《${title}》补充了问题澄清、概念边界和应用思路。`;

  return {
    summaryAppend,
    sections: [
      {
        heading: '对话沉淀',
        content: [
          '本节由当前 RAG Bot 对话自动整理，建议后续人工校对后保留。',
          userQuestions.length ? `关注问题：\n${userQuestions.map((question) => `- ${question}`).join('\n')}` : '',
          assistantAnswers.length ? `关键补充：\n${assistantAnswers.map((answer) => `- ${answer}`).join('\n')}` : ''
        ].filter(Boolean).join('\n\n')
      }
    ],
    tags: ['对话沉淀'],
    cases: [],
    pitfalls: [],
    interviewQuestions: userQuestions.slice(0, 4)
  };
}

function normalizeDistillationPatch(value, note, memorySummary, messages) {
  const fallback = localDistillationPatch(note, memorySummary, messages);
  const source = value && typeof value === 'object' ? value : {};
  return {
    summaryAppend: String(source.summaryAppend || fallback.summaryAppend || '').trim(),
    sections: Array.isArray(source.sections)
      ? source.sections
          .map((section) => ({
            heading: String(section?.heading || '对话沉淀').trim(),
            content: String(section?.content || '').trim()
          }))
          .filter((section) => section.content)
      : fallback.sections,
    tags: asStringList(source.tags).length ? asStringList(source.tags) : fallback.tags,
    cases: asStringList(source.cases),
    pitfalls: asStringList(source.pitfalls),
    interviewQuestions: asStringList(source.interviewQuestions).length
      ? asStringList(source.interviewQuestions)
      : fallback.interviewQuestions
  };
}

function dateValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function stripSearchFields(note) {
  const {
    searchExcerpt,
    searchSection,
    searchScore,
    ...cleanNote
  } = note || {};
  return cleanNote;
}

function createSyncPackage(data) {
  return {
    app: 'LearnAgent',
    packageVersion: 1,
    exportedAt: new Date().toISOString(),
    schemaVersion: data?.schemaVersion || 3,
    data: {
      notes: (data?.notes || []).map(stripSearchFields),
      conversations: data?.conversations || [],
      usageRecords: data?.usageRecords || [],
      settings: {
        ...(data?.settings || {}),
        apiKey: ''
      }
    }
  };
}

function readSyncPayload(value) {
  const source = value?.data && typeof value.data === 'object' ? value.data : value;
  return {
    notes: Array.isArray(source?.notes) ? source.notes.map(stripSearchFields) : [],
    conversations: Array.isArray(source?.conversations) ? source.conversations : [],
    usageRecords: Array.isArray(source?.usageRecords) ? source.usageRecords : [],
    settings: source?.settings && typeof source.settings === 'object' ? source.settings : null
  };
}

function mergeByUpdatedAt(currentItems, incomingItems) {
  const byId = new Map();
  let added = 0;
  let updated = 0;

  (currentItems || []).forEach((item) => {
    if (item?.id) byId.set(item.id, item);
  });

  (incomingItems || []).forEach((item) => {
    if (!item?.id) return;
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      added += 1;
      return;
    }
    if (dateValue(item.updatedAt || item.createdAt) > dateValue(existing.updatedAt || existing.createdAt)) {
      byId.set(item.id, item);
      updated += 1;
    }
  });

  return {
    items: Array.from(byId.values()),
    added,
    updated
  };
}

function mergeUsageRecords(currentItems, incomingItems) {
  const byId = new Map();
  let added = 0;
  (currentItems || []).forEach((item) => {
    if (item?.id) byId.set(item.id, item);
  });
  (incomingItems || []).forEach((item) => {
    if (!item?.id || byId.has(item.id)) return;
    byId.set(item.id, item);
    added += 1;
  });
  return {
    items: Array.from(byId.values()).sort((a, b) => dateValue(a.createdAt) - dateValue(b.createdAt)).slice(-1000),
    added
  };
}

function fixNoteHierarchy(notes) {
  const ids = new Set((notes || []).map((note) => note.id));
  return (notes || []).map((note) => {
    if (!note.parentId || note.parentId === note.id || !ids.has(note.parentId)) {
      return { ...note, parentId: undefined };
    }
    return note;
  });
}

function mergeSyncData(currentData, importPayload) {
  const incoming = readSyncPayload(importPayload);
  const notesMerge = mergeByUpdatedAt(currentData.notes || [], incoming.notes);
  const notes = fixNoteHierarchy(notesMerge.items);
  const noteIds = new Set(notes.map((note) => note.id));
  const conversationMerge = mergeByUpdatedAt(currentData.conversations || [], incoming.conversations);
  const conversations = conversationMerge.items.filter((conversation) => noteIds.has(conversation.noteId));
  const usageMerge = mergeUsageRecords(currentData.usageRecords || [], incoming.usageRecords);
  const importedSettings = incoming.settings || {};

  return {
    data: {
      ...currentData,
      notes,
      conversations,
      usageRecords: usageMerge.items,
      settings: {
        ...currentData.settings,
        provider: importedSettings.provider || currentData.settings.provider,
        endpoint: importedSettings.endpoint ?? currentData.settings.endpoint,
        model: importedSettings.model ?? currentData.settings.model,
        apiKey: currentData.settings.apiKey
      }
    },
    summary: {
      notesAdded: notesMerge.added,
      notesUpdated: notesMerge.updated,
      conversationsAdded: conversationMerge.added,
      conversationsUpdated: conversationMerge.updated,
      usageRecordsAdded: usageMerge.added
    }
  };
}

ipcMain.handle('data:load', () => getStorage().loadData());
ipcMain.handle('data:save', (_event, data) => getStorage().saveData(data));
ipcMain.handle('data:path', () => getStorage().getDataFilePath());
ipcMain.handle('data:search-notes', (_event, query) => getStorage().searchNotes(query));
ipcMain.handle('data:retrieve-context', (_event, payload) => getStorage().retrieveContext(payload));

ipcMain.handle('sync:export-package', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const stamp = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(win, {
    title: '导出 LearnAgent 同步包',
    defaultPath: `learn-agent-sync-${stamp}.json`,
    filters: [{ name: 'LearnAgent Sync Package', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  const data = await getStorage().loadData();
  const syncPackage = createSyncPackage(data);
  await fs.writeFile(result.filePath, JSON.stringify(syncPackage, null, 2), 'utf8');
  return {
    ok: true,
    canceled: false,
    filePath: result.filePath,
    summary: {
      notes: syncPackage.data.notes.length,
      conversations: syncPackage.data.conversations.length,
      usageRecords: syncPackage.data.usageRecords.length
    }
  };
});

ipcMain.handle('sync:import-package', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: '导入 LearnAgent 同步包',
    properties: ['openFile'],
    filters: [{ name: 'LearnAgent Sync Package', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true };
  }

  const raw = await fs.readFile(result.filePaths[0], 'utf8');
  const parsed = JSON.parse(raw);
  const currentData = await getStorage().loadData();
  const merged = mergeSyncData(currentData, parsed);
  await getStorage().saveData(merged.data);
  return {
    ok: true,
    canceled: false,
    filePath: result.filePaths[0],
    data: merged.data,
    summary: merged.summary
  };
});

ipcMain.handle('ai:generate-note', async (_event, payload) => {
  const input = payload?.input || '';
  const settings = payload?.settings || {};
  const system = [
    '你是一个严谨的学习智能体，负责把用户当天学习的主题生成结构化中文笔记。',
    '你需要识别学科和主题，并补充相关知识总结、案例、易错点、面试问题。',
    '只输出一个 JSON 对象，不要输出 Markdown。',
    'JSON 字段：title, subject, topic, tags, summary, sections, cases, pitfalls, interviewQuestions。',
    'sections 是数组，每项包含 heading 和 content。tags/cases/pitfalls/interviewQuestions 都是字符串数组。'
  ].join('\n');
  try {
    const modelResult = await callModel(settings, system, [{ role: 'user', content: input }], 'generate-note');
    const raw = modelResult.content;
    const parsed = extractJson(raw);
    return {
      draft: { ...localGeneratedNote(input), ...parsed },
      usedFallback: false,
      message: '已使用配置模型生成笔记',
      usageRecord: modelResult.usageRecord
    };
  } catch (error) {
    const message = error?.message === 'LOCAL_PROVIDER'
      ? '已使用本地兜底生成笔记'
      : `模型调用失败，已使用本地兜底：${error?.message || '未知错误'}`;
    if (error?.message !== 'LOCAL_PROVIDER') {
      console.warn('Falling back to local note generation:', error);
    }
    return {
      draft: localGeneratedNote(input),
      usedFallback: true,
      message
    };
  }
});

ipcMain.handle('ai:import-markdown', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: '选择 Markdown 文档',
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: 'Text', extensions: ['txt'] }
    ]
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const fileName = path.basename(filePath);
  const settings = payload?.settings || {};
  const markdown = await fs.readFile(filePath, 'utf8');
  const chunks = chunkMarkdown(markdown);
  const headings = extractMarkdownHeadings(markdown);
  const system = [
    '你是一个专业的学习笔记与项目文档分析 Agent。',
    '用户会给你一个 Markdown 文档，可能是学科资料，也可能是项目开发完整文档。',
    '你需要读取全部信息，生成一套层次化知识笔记：主笔记 + 分笔记。',
    '如果是项目文档，必须提炼：项目功能、亮点、技术重点、难点、对应解决方案、可复用经验。',
    '如果是学科资料，必须提炼：学科名、主题、核心知识点、案例、易错点、面试/复习问题。',
    '要求：内容全面，不啰嗦；保留重点、取舍、难点和解决方案；不要泛泛而谈。',
    '只输出一个 JSON 对象，不要输出 Markdown。',
    'JSON 字段：title, subject, topic, tags, summary, sections, cases, pitfalls, interviewQuestions, subNotes。',
    'subNotes 是数组，每项字段同主笔记，但不再包含 subNotes。sections 是数组，每项包含 heading 和 content。'
  ].join('\n');

  try {
    const importContent = await buildMarkdownImportContent(settings, fileName, headings, chunks);
    const modelResult = await callModel(
      settings,
      system,
      [{ role: 'user', content: importContent.content }],
      'import-markdown'
    );
    const parsed = extractJson(modelResult.content);
    const usageRecord = aggregateUsageRecords(
      [...importContent.usageRecords, modelResult.usageRecord],
      settings,
      'import-markdown'
    ) || modelResult.usageRecord;
    return {
      filePath,
      fileName,
      root: normalizeMarkdownImportDraft(parsed, fileName, markdown),
      usedFallback: false,
      message: '已从 Markdown 生成知识地图',
      usageRecord
    };
  } catch (error) {
    const message = error?.message === 'LOCAL_PROVIDER'
      ? '已使用本地规则导入 Markdown'
      : `模型调用失败，已使用本地规则导入 Markdown：${error?.message || '未知错误'}`;
    if (error?.message !== 'LOCAL_PROVIDER') {
      console.warn('Falling back to local Markdown import:', error);
    }
    return {
      filePath,
      fileName,
      root: localMarkdownImportDraft(fileName, markdown),
      usedFallback: true,
      message
    };
  }
});

ipcMain.handle('ai:chat-with-note', async (_event, payload) => {
  const settings = payload?.settings || {};
  const question = payload?.question || '';
  const note = payload?.note || {};
  const context = payload?.context || '';
  const history = Array.isArray(payload?.history) ? payload.history.slice(-6) : [];
  const memorySummary = String(payload?.memorySummary || '').trim();
  const system = [
    '你是学习笔记对话助手。',
    '你必须优先基于“当前笔记”和“RAG检索片段”回答。',
    '如果提供了“阶段性对话记忆”，把它当作历史上下文，但不要逐字复述。',
    '如果上下文不足，要明确说明缺口，并给出下一步学习建议。',
    '回答使用中文，结构清晰，避免编造来源。'
  ].join('\n');
  const messages = [
    {
      role: 'user',
      content: [
        `当前笔记标题：${note.title || note.topic || '未命名笔记'}`,
        `当前笔记摘要：${note.summary || ''}`,
        memorySummary ? `阶段性对话记忆：\n${memorySummary}` : '',
        'RAG检索片段：',
        context,
        '用户问题：',
        question
      ].join('\n\n')
    },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: question }
  ];

  try {
    const modelResult = await callModel(settings, system, messages, 'chat-with-note');
    return {
      content: modelResult.content,
      usedFallback: false,
      message: '已使用配置模型回答',
      usageRecord: modelResult.usageRecord
    };
  } catch (error) {
    const message = error?.message === 'LOCAL_PROVIDER'
      ? '已使用本地兜底回答'
      : `模型调用失败，已使用本地兜底：${error?.message || '未知错误'}`;
    if (error?.message !== 'LOCAL_PROVIDER') {
      console.warn('Falling back to local chat:', error);
    }
    return {
      content: localChatAnswer(question, context, note),
      usedFallback: true,
      message
    };
  }
});

ipcMain.handle('ai:summarize-conversation', async (_event, payload) => {
  const settings = payload?.settings || {};
  const note = payload?.note || {};
  const previousSummary = String(payload?.previousSummary || '').trim();
  const messages = Array.isArray(payload?.messages) ? payload.messages.slice(-14) : [];
  const system = [
    '你是学习型 Agent 的对话记忆管理器。',
    '任务：把围绕同一篇笔记的多轮对话压缩成稳定记忆，供后续 RAG 对话继续使用。',
    '保留：用户已确认的理解、关键定义、边界条件、例子、仍未解决的问题、适合写回笔记的要点。',
    '删除：寒暄、重复表达、模型过程性措辞、无关细节。',
    '用中文输出 180 到 320 字的纯文本摘要，不要输出 Markdown 标题。'
  ].join('\n');
  const userContent = [
    `当前笔记标题：${note.title || note.topic || '未命名笔记'}`,
    `当前笔记摘要：${note.summary || ''}`,
    previousSummary ? `上一版阶段性记忆：\n${previousSummary}` : '',
    `新对话：\n${formatDialogue(messages, 14)}`
  ].filter(Boolean).join('\n\n');

  try {
    const modelResult = await callModel(
      settings,
      system,
      [{ role: 'user', content: userContent }],
      'summarize-conversation'
    );
    const memorySummary = modelResult.content.trim();
    return {
      memorySummary: memorySummary || localConversationMemory(note, previousSummary, messages),
      usedFallback: false,
      message: '已更新阶段性对话记忆',
      usageRecord: modelResult.usageRecord
    };
  } catch (error) {
    const message = error?.message === 'LOCAL_PROVIDER'
      ? '已使用本地规则更新阶段性记忆'
      : `模型调用失败，已使用本地规则更新阶段性记忆：${error?.message || '未知错误'}`;
    if (error?.message !== 'LOCAL_PROVIDER') {
      console.warn('Falling back to local conversation memory:', error);
    }
    return {
      memorySummary: localConversationMemory(note, previousSummary, messages),
      usedFallback: true,
      message
    };
  }
});

ipcMain.handle('ai:distill-conversation-to-note', async (_event, payload) => {
  const settings = payload?.settings || {};
  const note = payload?.note || {};
  const memorySummary = String(payload?.memorySummary || '').trim();
  const messages = Array.isArray(payload?.messages) ? payload.messages.slice(-18) : [];
  const system = [
    '你是专业的学习笔记整理 Agent。',
    '任务：从当前笔记相关对话中提取“应该写回笔记”的增量内容。',
    '不要重复当前笔记已有内容；只提取新解释、新例子、边界条件、易错点、可复习问题。',
    '只输出一个 JSON 对象，不要输出 Markdown。',
    'JSON 字段：summaryAppend, sections, tags, cases, pitfalls, interviewQuestions。',
    'sections 是数组，每项包含 heading 和 content。所有数组字段都是字符串数组。'
  ].join('\n');
  const userContent = [
    `当前笔记：${JSON.stringify(note)}`,
    memorySummary ? `阶段性对话记忆：\n${memorySummary}` : '',
    `最近对话：\n${formatDialogue(messages, 18)}`
  ].filter(Boolean).join('\n\n');

  try {
    const modelResult = await callModel(
      settings,
      system,
      [{ role: 'user', content: userContent }],
      'distill-conversation-to-note'
    );
    const raw = modelResult.content;
    const parsed = extractJson(raw);
    const patch = normalizeDistillationPatch(parsed, note, memorySummary, messages);
    return {
      patch,
      memorySummary: memorySummary || localConversationMemory(note, '', messages),
      usedFallback: false,
      message: '已从对话中提取可写回笔记的内容',
      usageRecord: modelResult.usageRecord
    };
  } catch (error) {
    const message = error?.message === 'LOCAL_PROVIDER'
      ? '已使用本地规则提取对话沉淀'
      : `模型调用失败，已使用本地规则提取对话沉淀：${error?.message || '未知错误'}`;
    if (error?.message !== 'LOCAL_PROVIDER') {
      console.warn('Falling back to local note distillation:', error);
    }
    const summary = memorySummary || localConversationMemory(note, '', messages);
    return {
      patch: localDistillationPatch(note, summary, messages),
      memorySummary: summary,
      usedFallback: true,
      message
    };
  }
});

ipcMain.handle('ai:test-connection', async (_event, payload) => {
  const settings = payload?.settings || {};
  const testedAt = new Date().toISOString();
  if ((settings.provider || 'local') === 'local') {
    return { ok: true, message: 'Local fallback 不需要外部模型连接', testedAt };
  }
  if (settings.provider === 'openai-compatible' && !settings.apiKey) {
    return { ok: false, message: '请输入 API Key 后再测试连接', testedAt };
  }
  try {
    const modelResult = await callModel(
      settings,
      '你是连接测试助手。请只回复 OK。',
      [{ role: 'user', content: '请回复 OK，用于测试模型连接。' }],
      'test-connection'
    );
    return {
      ok: true,
      message: modelResult.content ? `连接成功：${String(modelResult.content).trim().slice(0, 80)}` : '连接成功',
      testedAt,
      usageRecord: modelResult.usageRecord
    };
  } catch (error) {
    return {
      ok: false,
      message: `连接失败：${error?.message || '未知错误'}`,
      testedAt
    };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
