const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const isDev = !app.isPackaged;

function getDataFilePath() {
  return path.join(app.getPath('userData'), 'learn-agent-data.json');
}

function defaultData() {
  return {
    notes: [],
    conversations: [],
    settings: {
      provider: 'local',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4.1-mini',
      apiKey: ''
    }
  };
}

async function loadData() {
  const filePath = getDataFilePath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return { ...defaultData(), ...JSON.parse(raw) };
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.error('Failed to read app data:', error);
    }
    return defaultData();
  }
}

async function saveData(data) {
  const filePath = getDataFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  return { ok: true, filePath };
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

async function callModel(settings, system, messages) {
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
    return data?.message?.content || '';
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
  return data?.choices?.[0]?.message?.content || '';
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

ipcMain.handle('data:load', () => loadData());
ipcMain.handle('data:save', (_event, data) => saveData(data));
ipcMain.handle('data:path', () => getDataFilePath());

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
    const raw = await callModel(settings, system, [{ role: 'user', content: input }]);
    const parsed = extractJson(raw);
    return { ...localGeneratedNote(input), ...parsed };
  } catch (error) {
    if (error?.message !== 'LOCAL_PROVIDER') {
      console.warn('Falling back to local note generation:', error);
    }
    return localGeneratedNote(input);
  }
});

ipcMain.handle('ai:chat-with-note', async (_event, payload) => {
  const settings = payload?.settings || {};
  const question = payload?.question || '';
  const note = payload?.note || {};
  const context = payload?.context || '';
  const history = Array.isArray(payload?.history) ? payload.history.slice(-8) : [];
  const system = [
    '你是学习笔记对话助手。',
    '你必须优先基于“当前笔记”和“RAG检索片段”回答。',
    '如果上下文不足，要明确说明缺口，并给出下一步学习建议。',
    '回答使用中文，结构清晰，避免编造来源。'
  ].join('\n');
  const messages = [
    {
      role: 'user',
      content: [
        `当前笔记标题：${note.title || note.topic || '未命名笔记'}`,
        `当前笔记摘要：${note.summary || ''}`,
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
    return await callModel(settings, system, messages);
  } catch (error) {
    if (error?.message !== 'LOCAL_PROVIDER') {
      console.warn('Falling back to local chat:', error);
    }
    return localChatAnswer(question, context, note);
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
