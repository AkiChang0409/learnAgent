# LearnAgent

LearnAgent 是一个本地桌面端学习助手应用，用于把用户当天学习的主题快速整理成结构化知识笔记，并支持围绕当前笔记进行上下文对话。应用基于 Electron、React 和 Vite 构建，数据默认保存在本机，不依赖远程数据库。

## 功能概览

- **学习主题输入**：支持文字输入，运行环境支持时可使用语音识别输入。
- **知识点生成**：根据学习主题生成学科、主题、摘要、知识小节、案例、易错点和面试问题。
- **本地笔记库**：笔记、对话和模型设置保存到本机用户数据目录。
- **笔记式编辑体验**：支持标题、学科、主题、标签、摘要、多小节内容编排。
- **结构化整理**：支持新增、删除、上移、下移知识小节。
- **当前笔记对话 Bot**：Bot 会优先读取当前笔记内容，并通过轻量 RAG 从历史笔记中召回相关片段。
- **模型配置**：支持本地兜底模式、Ollama、OpenAI-compatible Chat Completions 接口。
- **Windows 打包**：使用 electron-builder 生成 Windows 安装包和免安装目录。

## 技术栈

- **桌面容器**：Electron
- **前端框架**：React
- **构建工具**：Vite
- **语言**：TypeScript
- **图标**：lucide-react
- **打包工具**：electron-builder
- **本地存储**：Electron `app.getPath('userData')` 下的 JSON 文件

## 项目结构

```text
LearnAgent/
├── electron/
│   ├── main.cjs          # Electron 主进程：窗口、IPC、本地存储、AI 请求代理
│   └── preload.cjs       # 安全暴露给渲染进程的 API
├── src/
│   ├── App.tsx           # 主界面、笔记编辑、对话、设置
│   ├── main.tsx          # React 入口
│   ├── styles.css        # 应用样式
│   ├── types.ts          # 应用类型定义
│   └── services/
│       ├── notes.ts      # 笔记数据转换、ID、时间工具
│       └── rag.ts        # 轻量 RAG 检索逻辑
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

## 快速开始

要求：

- Node.js 20 或更高版本
- npm
- Windows 环境用于生成 `.exe`

安装依赖：

```powershell
npm install
```

启动开发版桌面应用：

```powershell
npm run dev
```

类型检查：

```powershell
npm run check
```

构建前端产物：

```powershell
npm run build
```

打包 Windows 安装包：

```powershell
npm run dist:win
```

打包完成后，输出目录为：

```text
release/
├── LearnAgent-0.1.0-Setup.exe
└── win-unpacked/
    └── LearnAgent.exe
```

## 模型配置

应用右上角设置中可以选择不同 Provider：

- **Local fallback**：不调用外部模型，使用内置规则生成基础笔记和回答。
- **Ollama**：适合本地模型，例如 `http://127.0.0.1:11434/api/chat`。
- **OpenAI-compatible**：适合兼容 Chat Completions 的远程接口。

默认 OpenAI-compatible endpoint：

```text
https://api.openai.com/v1/chat/completions
```

如果使用远程模型，需要在设置中填写 API Key。该 Key 当前保存在本地数据 JSON 中，不建议把数据文件上传或同步到公开仓库。

## 本地数据

笔记、会话和设置通过 Electron 主进程保存到用户数据目录中的：

```text
learn-agent-data.json
```

具体路径可在应用设置面板底部查看。

数据结构主要包含：

- `notes`：学习笔记列表
- `conversations`：按笔记关联的对话历史
- `settings`：模型 Provider、Endpoint、Model、API Key

## 打包说明

项目使用 electron-builder 的 NSIS 目标生成 Windows 安装包：

- 安装包：`release/LearnAgent-0.1.0-Setup.exe`
- 免安装运行目录：`release/win-unpacked/LearnAgent.exe`

Vite 配置中设置了：

```ts
base: './'
```

这是 Electron `file://` 加载生产页面所必需的配置。否则构建产物会引用 `/assets/...`，打包后的应用可能出现空白页。

## 当前限制

- 语音输入依赖 Chromium 环境的 Web Speech API，可用性与系统/运行环境有关。
- 当前 RAG 是轻量关键词检索，没有引入向量数据库或 embedding。
- 本地数据以 JSON 文件保存，适合个人学习工具；大量笔记场景建议迁移到 SQLite。
- 安装包未配置自定义图标和正式代码签名，Windows 可能提示未知发布者。

## 后续优化方向

- 使用 SQLite 替代 JSON，支持更稳定的数据迁移和查询。
- 增加 embedding + 向量检索，提升跨笔记召回质量。
- 增加 Markdown 导入导出。
- 增加笔记模板、复习计划和间隔重复。
- 增加模型配置加密存储，避免 API Key 明文保存。
- 增加自动更新、自定义图标和代码签名。
