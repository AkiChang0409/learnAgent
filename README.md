# LearnAgent

LearnAgent 是一个本地优先的桌面学习助手，用来把学习主题整理成结构化笔记，并支持围绕当前笔记继续提问。

应用基于 Electron、React 和 Vite 构建，默认数据保存在本机，不依赖远程数据库。

## 功能

- 根据学习主题生成结构化笔记
- 导入 Markdown 文档并生成“学科 > 多主题 > 多笔记 > 分笔记”的知识地图
- 编辑标题、摘要、标签、知识小节、案例、易错点和面试问题
- 保存本地笔记库
- 使用 SQLite 保存笔记、会话和设置
- 围绕当前笔记进行上下文对话
- 通过 SQLite chunk 索引从历史笔记中召回相关内容辅助回答
- 支持本地兜底、Ollama、OpenAI-compatible 接口
- 支持在 UI 中配置 Provider、Endpoint、Model，并用 Electron `safeStorage` 加密 API Key
- Markdown 支持快速分析、深度多 Agent 分析和零模型调用的离线整理
- revision + journal 自动保存；SQLite checkpoint 在 Worker Thread 中执行
- 支持模型失败提示和本地兜底提示
- 支持 Windows 安装包打包和 GitHub Release 发布

## 下载

可在 GitHub Releases 页面下载 Windows 安装包：

```text
LearnAgent-版本号-Setup.exe
```

如果没有看到安装包，说明该版本还没有发布 Release。

## 本地运行

环境要求：

- Node.js 20 或更高版本
- npm

安装依赖：

```powershell
npm install
```

启动开发版：

```powershell
npm run dev
```

类型检查：

```powershell
npm run check
```

运行单元与存储集成测试：

```powershell
npm run test:unit
```

运行 1,000 篇笔记存储基准：

```powershell
npm run benchmark:storage
```

检查生产包 gzip 预算（需要先构建）：

```powershell
npm run check:bundle-budget
```

发布 CI 会依次执行类型检查、单元/集成测试、Electron smoke、生产构建、JS/CSS gzip 预算、存储基准、依赖审计和安装包生成；任一步失败都不会发布。预算为 JS ≤100KB、CSS ≤10KB。

构建前端：

```powershell
npm run build
```

打包 Windows 安装包：

```powershell
npm run dist:win
```

打包结果会生成到本地 `release/` 目录。

## 架构

- renderer 使用领域 reducer 与 hooks 管理笔记库、自动保存、导入任务和 UI 状态，只通过窄化 preload Bridge 访问桌面能力。
- Electron 主进程按窗口安全、IPC 校验、密钥、模型 Provider、Agent 注册表、导入限制、同步包和存储协调拆分为 TypeScript `.cts` 模块，编译产物输出到 `electron-dist/`。
- SQLite/sql.js 运行在 Worker Thread；常规编辑只 upsert/delete 受影响实体并重建相关笔记 chunk，checkpoint 只负责后台导出与原子替换。
- schema v5/v6 迁移前会保存数据库备份；未 checkpoint journal 会在启动时重放，运行中的 Agent 任务会标记为 interrupted，不会自动发起新的付费调用。
- 模型输出先经过 JSON/schema、Evidence ID 与层级归一化校验；导入文档按不可信数据隔离，远程 Endpoint 只允许 HTTPS，Ollama HTTP 只允许 loopback。

详细文档：

- [项目技术深度分析](./PROJECT_TECHNICAL_NOTES.md)：需求、架构、数据流、工程亮点、技术债、面试讲述和代码证据。
- [多 Agent 编排设计](./AGENT_ORCHESTRATION_DESIGN.md)：Evidence、规划、写作、增强、校验和本地合并的设计与落地状态。

## 本轮架构演进摘要

- 数据接口从整库 `loadData/saveData` 迁移为 `loadSnapshot/applyChanges/flushData`，renderer 只传递带 baseRevision 的实体变更。
- 常规保存由整库删除重写改成 affected-entity SQL；只重建发生变化的笔记 sections 和 chunks。
- journal、checkpoint 和串行队列补齐连续 revision、崩溃重放以及 flush 失败重试语义。
- Electron 主进程迁移到 `.cts` 模块，拆分窗口安全、IPC、密钥、Provider、Agent、同步和 Worker 存储边界。
- `AiSettings` 不再持久化明文 API Key；旧密钥自动迁移到 `safeStorage`，renderer 只看到 `apiKeyConfigured`。
- Markdown 导入新增快速、深度、离线模式，以及预检、取消、调用预算、Agent run/step 记录和不可信文档隔离。
- 前端补齐空主题、学科切换、领域纯函数、模态框焦点锁定、键盘移动和保存失败重试。
- 新增 Vitest/存储集成测试、Electron smoke、性能阈值和 gzip 包体预算，并接入发布 CI。

上述能力已写入当前源码；最新一轮改动尚未执行测试、构建、基准或安装包验证，发布前必须让 CI 完整通过，不能仅依据本文档视为已验收。

## 模型配置

应用内可选择三种 Provider：

- `Local fallback`：不请求外部模型，使用内置规则生成基础内容
- `Ollama`：连接本机 Ollama 服务
- `OpenAI-compatible`：连接兼容 Chat Completions 的接口

使用远程接口时，需要在应用设置中填写 Endpoint、Model 和 API Key。

设置面板支持：

- Provider 预设切换
- Endpoint 和 Model 输入
- API Key 设置、替换和清空；已保存密钥不会返回 renderer，也不会进入同步包
- 连接测试
- 最近一次连接测试状态和时间

默认 Provider 配置：

```text
Local fallback       不需要 Endpoint / Model / API Key
Ollama               http://127.0.0.1:11434/api/chat / llama3.1
OpenAI-compatible    https://api.openai.com/v1/chat/completions / gpt-4.1-mini
```

如果配置模型不可用，应用会在界面提示失败原因，并继续保留本地兜底生成和回答能力。

## Markdown 导入

在学科首页或笔记页点击“导入 MD”，可以选择本地 `.md` / `.markdown` / `.txt` 文件。预检只向 renderer 返回临时 `selectionId`、文件名、字符数和预计块数，不暴露真实路径。随后可选择：

- 快速分析（默认）：证据抽取 → 整体分析 → 质量评审
- 深度分析：Ingestor → Orchestrator → Writer → Enricher → Validator → 本地合并
- 离线整理：不调用模型，忠实按标题与原文生成基础知识地图

应用会整理成一套结构化知识点：

- 学科：识别文档所属学科或项目技术方向
- 多主题：按知识体系或项目能力拆成多个主题
- 多笔记：每个主题下生成若干聚焦的知识笔记
- 分笔记：复杂笔记可继续拆出子笔记
- 补充内容：案例、易错点、面试/复习问题

如果导入的是项目开发文档，生成结果会重点提炼项目功能、亮点、技术重点、实现难点、对应解决方案和可复用经验，适合快速了解一个项目的技术方案。

导入上限为 2MiB、160,000 个处理字符和 16 个 chunk；深度模式最多 8 个主题、每主题 2 篇核心笔记、步骤并发度 3，Validator 最多触发一次定向重写。超限会明确要求拆分，不会静默截断。Local Provider 自动使用离线模式。

## 本地数据

笔记、会话和模型设置默认保存在 Electron 用户数据目录中的 SQLite 文件：

```text
learn-agent.sqlite
```

已确认变更会先 fsync 到 `learn-agent.journal.json`，后台再原子 checkpoint 到 SQLite；启动时会自动重放未 checkpoint 的 revision，并保留 `learn-agent.sqlite.backup`。API Key 单独使用操作系统安全存储加密。

如果旧版本已经存在 `learn-agent-data.json`，应用首次启动 SQLite 版本时会自动导入旧数据，并在同一目录生成一份 JSON 备份：

```text
learn-agent-data.backup-时间戳.json
```

数据只保存在本机。请不要把本地 SQLite、JSON 备份、`.env` 或 API Key 上传到公开仓库。

当前搜索使用 SQLite chunk 索引，覆盖标题、学科、主题、标签、摘要、小节、案例、易错点和面试问题。搜索结果会显示匹配小节和摘录；Bot 对话也复用同一套 chunk scoring 来生成 RAG 引用片段。后续如果切换到 native SQLite，可进一步升级为 FTS5 全文搜索或 embedding 向量检索。

## 发布版本

项目已配置 GitHub Actions 自动发布。推送版本 tag 后，GitHub 会自动打包 Windows 安装包，并把安装包、差分更新文件与 `latest.yml` 更新清单上传到 Release。

正式安装版会在启动后自动检查 GitHub Release。发现新版本后会先提醒用户；用户点击“更新”后才在后台下载，下载完成后再提示重启安装。也可以在“设置 → 关于”中手动检查。开发环境不会请求更新服务。

推荐流程：

```powershell
git checkout main
git pull origin main
npm version patch
git push origin main
git push origin --tags
```

示例：

- 当前版本：`1.0.2`
- 执行：`npm version patch`
- 新版本：`1.0.3`
- 新 tag：`v1.0.3`
- GitHub Release 附件：`LearnAgent-1.0.3-Setup.exe`、对应的 `.blockmap` 和 `latest.yml`

也可以手动创建 tag：
```powershell
git tag v1.0.3
git push origin v1.0.3
```

## 不应提交的内容

以下内容已通过 `.gitignore` 排除：

- `node_modules/`
- `release/`
- `dist/`（CI 生成）
- `electron-dist/`（TypeScript 编译产物）
- `.claude/settings.local.json`
- `.env`
- `.env.*`

`release/` 是本地打包输出目录，不应进入 Git。安装包应通过 GitHub Release 附件分发。

## License

MIT
