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
- 支持在 UI 中配置 Provider、Endpoint、Model、API Key，并测试连接
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

构建前端：

```powershell
npm run build
```

打包 Windows 安装包：

```powershell
npm run dist:win
```

打包结果会生成到本地 `release/` 目录。

## 模型配置

应用内可选择三种 Provider：

- `Local fallback`：不请求外部模型，使用内置规则生成基础内容
- `Ollama`：连接本机 Ollama 服务
- `OpenAI-compatible`：连接兼容 Chat Completions 的接口

使用远程接口时，需要在应用设置中填写 Endpoint、Model 和 API Key。

设置面板支持：

- Provider 预设切换
- Endpoint 和 Model 输入
- API Key 输入、显示/隐藏、清空
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

在学科首页或笔记页点击“导入 MD”，可以选择本地 `.md` / `.markdown` / `.txt` 文件。应用会通过可复用 Agent 编排读取文档内容，整理成一套结构化知识点：

- 学科：识别文档所属学科或项目技术方向
- 多主题：按知识体系或项目能力拆成多个主题
- 多笔记：每个主题下生成若干聚焦的知识笔记
- 分笔记：复杂笔记可继续拆出子笔记
- 补充内容：案例、易错点、面试/复习问题

如果导入的是项目开发文档，生成结果会重点提炼项目功能、亮点、技术重点、实现难点、对应解决方案和可复用经验，适合快速了解一个项目的技术方案。

长 Markdown 会先由“知识抽取 Agent”按标题和长度分块提炼，再交给“知识整理 Agent”生成最终 `SubjectKnowledgeMap`，避免一个 Agent 同时承担阅读、抽取、编排、写作导致质量下降。导入过程中会显示读取、分块、抽取、整理和保存进度；模型不可用时会使用本地规则兜底，仍可生成基础结构。

## 本地数据

笔记、会话和模型设置默认保存在 Electron 用户数据目录中的 SQLite 文件：

```text
learn-agent.sqlite
```

如果旧版本已经存在 `learn-agent-data.json`，应用首次启动 SQLite 版本时会自动导入旧数据，并在同一目录生成一份 JSON 备份：

```text
learn-agent-data.backup-时间戳.json
```

数据只保存在本机。请不要把本地 SQLite、JSON 备份、`.env` 或 API Key 上传到公开仓库。

当前搜索使用 SQLite chunk 索引，覆盖标题、学科、主题、标签、摘要、小节、案例、易错点和面试问题。搜索结果会显示匹配小节和摘录；Bot 对话也复用同一套 chunk scoring 来生成 RAG 引用片段。后续如果切换到 native SQLite，可进一步升级为 FTS5 全文搜索或 embedding 向量检索。

## 发布版本

项目已配置 GitHub Actions 自动发布。推送版本 tag 后，GitHub 会自动打包 Windows 安装包并上传到 Release。

推荐流程：

```powershell
git checkout main
git pull origin main
npm version patch
git push origin main
git push origin --tags
```

示例：

- 当前版本：`1.0.1`
- 执行：`npm version patch`
- 新版本：`1.0.2`
- 新 tag：`v1.0.2`
- GitHub Release 附件：`LearnAgent-0.1.4-Setup.exe`

也可以手动创建 tag：
```powershell
git tag v0.1.1
git push origin v0.1.1
```

## 不应提交的内容

以下内容已通过 `.gitignore` 排除：

- `node_modules/`
- `release/`
- `.env`
- `.env.*`
- `PROJECT_TECHNICAL_NOTES.md`

`release/` 是本地打包输出目录，不应进入 Git。安装包应通过 GitHub Release 附件分发。

## License

MIT
