# LearnAgent

LearnAgent 是一个本地优先的桌面学习助手，用来把学习主题整理成结构化笔记，并支持围绕当前笔记继续提问。

应用基于 Electron、React 和 Vite 构建，默认数据保存在本机，不依赖远程数据库。

## 功能

- 根据学习主题生成结构化笔记
- 编辑标题、摘要、标签、知识小节、案例、易错点和面试问题
- 保存本地笔记库
- 围绕当前笔记进行上下文对话
- 从历史笔记中召回相关内容辅助回答
- 支持本地兜底、Ollama、OpenAI-compatible 接口
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

## 本地数据

笔记、会话和模型设置默认保存在 Electron 用户数据目录中的：

```text
learn-agent-data.json
```

数据只保存在本机。请不要把本地数据文件、`.env` 或 API Key 上传到公开仓库。

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

- 当前版本：`0.1.0`
- 执行：`npm version patch`
- 新版本：`0.1.1`
- 新 tag：`v0.1.1`
- GitHub Release 附件：`LearnAgent-0.1.1-Setup.exe`

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
