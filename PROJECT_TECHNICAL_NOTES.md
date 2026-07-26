# 项目技术深度分析文档：LearnAgent

> 更新日期：2026-07-24
> 文档定位：面向项目复盘、架构评审、技术面试和后续 AI 笔记导入。
> 事实边界：本文以当前工作区源码、提交历史和 2026-07-24 的本机验证结果为依据。没有真实用户规模、线上故障率或生产环境成本数据的结论会明确标记为 `当前代码未体现` 或 `可推断`。

本轮验证结论：

| 验证项 | 结果 | 关键证据 |
| --- | --- | --- |
| TypeScript renderer + Electron 类型检查 | 通过 | `npm run check` 退出码 0 |
| 单元/集成测试 | 未完全通过 | 25 项中 24 项通过；存储测试清理临时目录时因后台 checkpoint 未结束触发 `ENOTEMPTY` |
| 生产构建 | 通过 | Vite 转换 1602 个模块，生成 Electron 与 renderer 产物 |
| Electron smoke | 通过 | root、preload bridge 和标题检查通过 |
| gzip 预算 | 通过 | JS 85.6KB / 100KB，CSS 7.2KB / 10KB |
| 1000 篇笔记存储基准 | 通过 | 保存确认 P95 9.6ms；搜索 P95 72.9ms；checkpoint 事件循环延迟 15.9ms |
| Windows 安装包、签名、自动更新 | 本轮未验证 / 当前代码未完整体现 | 仅验证到 build 与 smoke；未执行 `dist:win`，未发现签名和自动更新实现 |

## 1. 项目定位与真实需求

LearnAgent 是一个本地优先的 Electron 学习桌面应用。它解决的不是“让模型生成一段笔记”这一个点，而是把资料导入、结构化笔记、历史检索、围绕笔记的对话、会话记忆、知识回写、成本统计和本地持久化串成长期可用的学习闭环。

代码直接体现的主要需求包括：

- 用户可以按学科、主题、笔记和子笔记组织知识；空主题也能独立持久化。
- Markdown/文本资料可以选择快速、深度或离线模式导入。
- 对话不仅读取当前笔记，还能从历史笔记 chunk 中召回上下文并展示来源。
- 长对话会形成阶段记忆，讨论中形成的新理解可以回写当前笔记。
- 笔记、会话、设置和用量默认保存在本机，不依赖云端数据库。
- 模型不可用时仍能使用本地规则完成基础生成、导入和对话。
- API Key、外部链接、文件选择和 IPC 属于桌面应用的敏感边界，需要由 Electron 主进程控制。

可推断的目标用户是需要长期整理技术资料、课程笔记或项目复盘的个人用户。当前代码未体现多人协作、账号体系、云端同步或团队权限模型，因此它仍是单机个人知识系统，而不是协作型知识平台。

## 2. 核心用户流程 / 业务流程

### 2.1 学科、主题与笔记编辑

入口位于 `src/App.tsx` 和 `src/components/AppRail.tsx`。用户创建学科或主题后，React 状态通过 `useAppData` 中的 reducer 更新；空主题记录在 `Subject.topics`，已有笔记的主题再通过 `mergeTopicNames()` 合并展示。切换学科时会清空搜索，并用 `selectMostRecentNoteForSubject()` 选择该学科最近更新的根笔记；空学科不会继续显示旧学科内容。

拖拽移动和键盘“移到主题根级”最终调用 `moveNoteInTree()`。该纯函数会阻止把父笔记移动到自己的后代之下，并同步修改整棵子树的学科和主题。删除笔记时，直接子笔记会上移；撤销时用 `restoreRemovedNote()` 恢复原层级和会话。

### 2.2 revision 自动保存

`useAutosave()` 比较已接收快照和最新 `AppData`，只生成 subjects、notes、conversations、usageRecords 和 settings 的实体级变更批次。renderer 调用 `applyChanges({ baseRevision, changes })` 后，主进程存储协调层先把变更 fsync 到 journal，再确认新 revision；随后 Worker Thread 执行 SQL upsert/delete，`flushData()` 等待 SQLite checkpoint 完成。

UI 区分“保存中”“变更已接收”“已保存”和“保存失败”。如果变更已经被接收但 SQLite flush 失败，重试会直接重试持久化，而不是因为实体 diff 已经为空而跳过。

### 2.3 Markdown 导入

用户通过 `selectMarkdownSource()` 选择文件。主进程检查扩展名和文件大小，renderer 只拿到临时 `selectionId`、文件名、字符数、chunk 数和预计调用数，不会收到真实路径。

随后用户选择：

- 快速模式：Document Ingestor → 项目整体分析 → 质量评审，质量不合格时最多整体重写一次。
- 深度模式：Document Ingestor → Subject Orchestrator → Topic Writer → Note Enricher → Knowledge Validator → 本地 Merger；Validator 最多触发一次定向重写。
- 离线模式：零模型调用，按标题和原文生成基础知识地图，并明确标记“离线整理、未做深度推理”。Local Provider 会自动选择此模式。

导入过程上报 runId、agentId、stepId、预计/实际调用数、阶段、百分比和是否可取消。最终 `useKnowledgeImport()` 把 `SubjectKnowledgeMap` 转换为 subjects、notes、subNotes 和 conversations，再进入同一 revision 保存链。

### 2.4 RAG 对话与知识回写

`retrieveContext()` 把问题规范化成检索 term，对缓存的 `note_chunks` 文本进行评分；标题/小节命中、摘要类型和当前笔记都会获得权重。返回的 chunk 被转换为 `RagSource`，与当前笔记、阶段记忆和有限历史消息一起进入模型请求。

当消息累计到阈值时，系统调用会话摘要能力更新 `memorySummary` 和 `summarizedMessageCount`。用户触发“补充到笔记”时，系统把会话增量归一化为 summary、sections、tags、cases、pitfalls 和 interviewQuestions，并在本地完成去重合并。

### 2.5 同步包导入导出

同步包 v2 导出 subjects、notes、conversations、usageRecords 和非敏感 settings，主动删除搜索临时字段和 API Key。导入支持 v1/v2，拒绝未知版本、重复主键和畸形数组；相同 ID 按 updatedAt 合并，usage 记录去重并保留最近 1000 条。合并后会修复孤儿 parentId、自引用和多节点循环，并删除指向不存在笔记的会话。

当前流程存在一个高优先级 revision 闭环缺口：`sync:import-package` 在主进程中调用 `saveData()`，存储 revision 因此加一，但返回给 renderer 的 `SyncImportResult` 不包含新 revision，`useAutosave()` 内部仍保留导入前 revision。renderer 随后因 `setData(result.data)` 产生一次新的自动保存时，可能提交 stale `baseRevision` 并收到 `REVISION_CONFLICT`；当前自动保存重试也不会主动 reload/rebase。这个问题尚无端到端测试覆盖，应在同步功能投入真实使用前修复。

## 3. 总体技术架构

运行形态是 Electron 主进程 + sandboxed preload + React renderer + sql.js Worker Thread：

```text
React UI / domain reducer / hooks
  -> window.learnAgent（窄化能力桥）
    -> preload / ipcRenderer.invoke
      -> IPC sender + payload validation
        -> Electron main orchestration
          -> model provider / agent runtime / sync package / safeStorage
          -> storage coordinator
            -> fsync journal
            -> Worker Thread
              -> sql.js entity SQL
              -> chunk index/cache
              -> atomic SQLite checkpoint + backup
```

主要技术栈为 React 19、TypeScript、Vite、Electron 和 sql.js。选择 sql.js 的好处是保持现有 SQLite 文件格式且不引入原生 SQLite 构建链；代价是 checkpoint 仍需导出整个数据库字节数组。当前方案把同步 SQL、索引维护和导出放进 Worker Thread，并把常规编辑改成实体级 SQL，从而避免主进程承担这些同步工作，但不能消除 sql.js 全库 export 的固有成本。

从提交 `e14dc61`（版本提交 1.0.2）到当前 HEAD，新版涉及 56 个文件、约 5736 行新增和 1632 行删除。变化不是单纯 UI 增量，而是一次数据可靠性、Agent 编排、安全边界和发布门禁的系统性重构。

Electron 源码使用 `.cts`，经独立 `tsconfig.electron.json` 输出 `.cjs` 到 `electron-dist/`。主进程已拆分窗口安全、IPC 安全、密钥、Provider、Agent 注册表、导入限制、同步包、密钥迁移和存储模块；`main.cts` 仍保留较多 Agent 归一化与业务编排代码，是后续继续拆分的主要位置。

## 4. 关键模块分析

### 4.1 前端工作区与领域逻辑

- 模块职责：组织学科、主题、笔记、对话、设置和导入任务 UI。
- 主要文件：`src/App.tsx`、`src/hooks/useAppData.ts`、`src/hooks/useAutosave.ts`、`src/hooks/useKnowledgeImport.ts`、`src/domain/library.ts`。
- 机制：`useAppData` 通过 reducer 提供兼容 `SetStateAction` 的更新入口；排序、层级修复、移动、删除和撤销放在纯函数中。
- 取舍：保留 `App.tsx` 作为跨领域协调器，降低一次性重构风险；代价是该文件已达到约 1121 行，对话记忆、同步、设置、笔记命令和页面状态共享闭包，局部改动容易扩大回归面。

### 4.2 Preload 与 IPC 安全边界

- 模块职责：renderer 只获得业务能力，不获得 Node/Electron 对象。
- 主要文件：`electron-src/preload.cts`、`electron-src/ipc-security.cts`。
- 机制：每个 IPC 先确认 `event.sender === mainWindow.webContents`，再限制序列化大小并校验 revision、变更对象、主键、模式、selectionId、搜索长度和密钥长度。
- 取舍：采用手写轻量校验，没有引入运行时 schema 依赖；维护成本随 IPC 类型增加而上升。

### 4.3 Worker 存储与恢复

- 模块职责：维护 SQLite、revision、journal、备份、迁移和本地检索索引。
- 主要文件：`electron-src/storage.cts`、`storage-thread.cts`、`storage-core.cts`。
- 机制：协调层串行确认 revision 并写 journal；Worker 只修改受影响实体和笔记 chunk；checkpoint 写临时文件、fsync 后原子替换，并保留最近备份。启动时重放未 checkpoint journal。
- 迁移：schema v5 回填主题和用量记账字段；v6 增加 revision、Agent run/step 和恢复元数据。旧版本迁移前复制数据库备份。
- 取舍：journal 确认速度与 checkpoint 分离，提高交互响应；必须仔细处理队列拒绝、连续 revision、journal 压缩和 Worker 关闭时机。本轮失败测试证明，直接使用 `storage-core` 的调用方没有统一 `close()/awaitIdle()` 生命周期协议，后台 checkpoint 可能与测试目录清理竞争。

### 4.4 模型 Provider 与密钥

- 模块职责：统一 Ollama/OpenAI-compatible 请求、usage、费用、超时、取消、重试和错误脱敏。
- 主要文件：`electron-src/model-provider.cts`、`secrets.cts`、`key-migration.cts`。
- 机制：远程 Endpoint 必须 HTTPS；Ollama HTTP/HTTPS 只允许 loopback。请求使用 AbortController，429/5xx 或网络错误最多退避重试一次，认证错误不重试。API Key 用 Electron `safeStorage` 加密，renderer 只持有 `apiKeyConfigured`。
- 兼容：首次加载发现旧 settings 明文密钥时，先加密写入安全存储，再通过 revision 变更删除旧字段。

### 4.5 Agent 导入运行时

- 模块职责：把不可信长文档转换为有证据约束的知识地图。
- 主要文件：`electron-src/agent-registry.cts`、`import-limits.cts` 和 `main.cts` 中的运行/归一化函数。
- 机制：动态任务使用明确的 `<UNTRUSTED_DOCUMENT_DATA>` 分隔；所有 JSON Agent 输出先做字段结构检查，再做 Evidence ID 白名单和长度/数量归一化。每个步骤记录状态、尝试次数、输入/输出摘要和 usageRecordId。
- 控制：2MiB、160,000 字符、16 chunk、8 主题、每主题 2 篇核心笔记、独立步骤并发度 3、每步最多一次重试，并设置总调用预算。

### 4.6 搜索、RAG 与同步

- 搜索和 RAG 共用 `note_chunks`、文本规范化缓存与 term scoring，避免每次重新解析整篇笔记。
- 同步包负责轻量跨设备迁移，不承担实时云同步或多端并发冲突解决。
- `note_search` 旧表在迁移时删除，避免两套索引逻辑并存。

## 5. 数据模型与数据流

核心领域对象为 `Subject`、`Note`、`NoteSection`、`Conversation`、`ChatMessage`、`TokenUsageRecord` 和 `AiSettings`。

- Subject 持有显式 topics，因此没有笔记的主题仍可存在。
- Note 通过 parentId 构成层级，通过 position 保持同一学科/主题/父节点下的顺序。
- Conversation 绑定 note，并保存 memorySummary、memoryUpdatedAt 和 summarizedMessageCount。
- TokenUsageRecord 保存 Provider 返回的真实 token；费用拆为基础估价、校准倍率、最终估价和价格表版本。
- AiSettings 不再包含持久化明文 apiKey，只包含 apiKeyConfigured。

数据库主要表包括 subjects、notes、note_sections、conversations、messages、usage_records、note_chunks、agent_runs、agent_steps、settings 和 metadata。正常数据流是：

```text
用户操作
  -> AppData reducer
  -> createChangeBatch
  -> journal revision
  -> Worker entity SQL
  -> affected note chunks
  -> SQLite checkpoint
```

数据校验拒绝重复主键和畸形集合，层级校验会确定性修复孤儿、自引用和循环。删除笔记时同时清理 sections、chunks、相关 conversations 和 messages。usageRecords 限制为最近 1000 条。

历史 Dashboard 校准记录无法恢复原始真实 token，因此只标记为 `legacy-dashboard-calibrated-v1`，并在 UI 中与新 `provider-reported-v2` 合计分开显示，避免把旧校准值继续当成真实值。

## 6. 核心技术机制

### 6.1 可恢复的 revision 保存协议

baseRevision 防止过期 renderer 覆盖新数据；journal 在确认前 fsync，保证已确认 revision 能在崩溃后重放。checkpoint 队列会持续等待到最新 revision 落盘后才压缩 journal，解决连续编辑期间“旧 checkpoint 完成、最新 journal 被提前删除”的竞态。

### 6.2 增量 SQLite 与索引更新

旧方案每次保存会删除并重写所有表、重建所有 chunk。当前常规变更只 upsert/delete 受影响实体；笔记更新只删除重建该 note 的 sections 和 chunks。完整重写仅用于旧数据迁移、完整同步替换和崩溃恢复。

### 6.3 快/深/离线三模式

快速模式降低普通资料的调用数；深度模式用规划、逐篇写作、增强和校验换取结构质量；离线模式保证无网络和 Local Provider 场景可运行。三种模式共享同一预检、进度、取消、归一化和落库结构。

### 6.4 不可信文档与模型输出边界

导入文本不会直接拼成高优先级指令，而是作为不可信 JSON 数据放入分隔区。模型输出不直接落库：先解析 JSON、检查必要数组/布尔字段、过滤未知 Evidence ID、限制主题/笔记/补充项数量，再由本地 merger 生成最终对象。

边界仍不是形式化安全保证：Ingestor 从不可信原文生成的 evidence 随后被标记为 `<VERIFIED_EVIDENCE>`，当前只验证 Evidence ID 和若干字段形状，并未证明其文本内容不含间接指令。系统 prompt 对原文注入已有防御，但还缺少 evidence 内容净化、taint 标记和专门的 prompt-injection 回归集。

### 6.5 安全桌面运行时

BrowserWindow 启用 sandbox、contextIsolation 并关闭 nodeIntegration；阻止跨来源导航和新窗口，外部链接只允许 HTTPS/mailto，权限请求默认拒绝。CSP 禁止非本地脚本，敏感模型请求只在主进程发起。

### 6.6 工程与发布门禁

项目提供 Vitest、React Testing Library、临时目录存储集成测试、Electron smoke、1000 篇/每篇 5 小节存储基准和 gzip 预算脚本。GitHub Actions 的发布链为类型检查、测试、smoke、生产构建、包体预算、存储基准、npm audit 和 Windows 安装包；任一步失败都不会发布。

2026-07-24 本机验证中，类型检查、生产构建、Electron smoke、gzip 预算和存储基准均通过。基准数据为：1000 篇笔记、每篇 5 小节，保存确认 P95 9.6ms、搜索 P95 72.9ms、checkpoint 事件循环延迟 15.9ms。三项分别低于 100ms、150ms 和 50ms 门槛。

单元/集成测试门禁未完全通过：25 项测试中 24 项通过，`deletes dependent conversations when a note is deleted` 在断言后清理临时目录时出现 `ENOTEMPTY`。这更接近存储异步生命周期/测试 teardown 竞态，而不是级联删除断言错误，但在 CI 语义上仍是失败，因此当前代码不具备“发布门禁全绿”的事实基础。

## 7. 工程亮点与面试价值

### 7.1 journal + revision + Worker 的本地可靠保存

- 对应问题：高频编辑不能阻塞 Electron 主进程，也不能在崩溃后丢掉已经提示“接收”的变更。
- 实现：journal 先 fsync，Worker 增量 SQL，后台 checkpoint 与备份，启动重放。
- 技术价值：同时处理响应性、并发版本和崩溃一致性，而不只是调用 `writeFile`。
- 追问：为什么 journal 确认不等于 SQLite 已落盘？如何防止连续 revision 的 checkpoint 竞态？
- 回答思路：解释 received/durable checkpoint 两阶段状态和 journal 压缩条件。

实测佐证：在 1000 篇、每篇 5 小节的数据集上，保存确认 P95 9.6ms，checkpoint 期间主事件循环延迟 15.9ms。该结果证明当前架构在基准场景有效，但不能外推到超大数据库、机械硬盘或真实长期数据分布。

### 7.2 证据驱动的双模式 Agent 编排

- 对应问题：长资料由单 Agent 同时阅读、规划、写作和校验会遗漏且难定位失败。
- 实现：快速三阶段与深度五 Agent 流程，Evidence ID 约束，本地 merger，最多一次重写。
- 技术价值：把不可控生成拆成可记录、可限额、可验证的步骤。
- 追问：为什么 Merger 不用模型？
- 回答思路：合并是确定性结构变换，本地代码更便宜、可测且不会引入新事实。

### 7.3 renderer 不持有已保存 API Key

- 对应问题：即使启用 contextIsolation，如果把密钥返回前端，XSS 仍可能读取。
- 实现：safeStorage、专用 set/clear/test IPC、旧明文自动迁移、同步包排除密钥。
- 技术价值：安全边界从“禁止 Node”推进到“最小化敏感数据暴露”。
- 追问：safeStorage 不可用怎么办？
- 回答思路：当前代码拒绝明文降级并向用户报告错误，优先保证秘密不落明文。

### 7.4 一套 chunk 数据服务搜索与 RAG

- 对应问题：全局搜索和 AI 召回如果各自实现，会出现排序不一致和重复维护。
- 实现：note_chunks、term cache、rankChunks 和统一 RagSource。
- 技术价值：先用可解释关键词基线打通完整引用链，再为混合检索保留演进点。
- 追问：为什么没有直接上向量数据库？
- 回答思路：当前数据规模和本地优先约束下先验证 lexical baseline，避免过早引入模型成本和索引一致性问题。

### 7.5 对话记忆与知识回写闭环

- 对应问题：历史消息无限增长会增加上下文和成本，聊天结果又容易“聊完即丢”。
- 实现：分批摘要、摘要计数、增量蒸馏、本地去重 merge。
- 技术价值：把一次性问答变成长期知识资产。
- 追问：如何避免重复写入？
- 回答思路：只传递未摘要/最近消息，并对 tags、列表和 section heading 做确定性合并。

### 7.6 真实 Token 与费用校准分离

- 对应问题：为贴合 Dashboard 而修改 token 会破坏事实数据，且历史值无法恢复。
- 实现：Provider token 原样保存，校准只乘费用；旧记录单独标记和展示。
- 技术价值：体现 AI 产品的数据口径治理，而不只是展示一个总数。
- 追问：价格表变化怎么办？
- 回答思路：记录 pricingVersion 和基础/最终估价，未来可按版本重新解释费用。

### 7.7 窄化 IPC 与导航安全

- 对应问题：桌面前端一旦被注入，危害可能扩大到文件系统和系统 Shell。
- 实现：发送方校验、payload 限制、协议白名单、导航阻断、权限默认拒绝、严格脚本 CSP。
- 技术价值：把 Electron 官方建议落实到具体数据入口，而不是只设置两个 BrowserWindow 开关。
- 追问：为什么 IPC 还需要 payload 校验？
- 回答思路：被攻陷 renderer 仍是非可信输入源，主进程必须维持自己的不变量。

## 8. 技术难点与解决方案

### 8.1 高频保存与 SQLite 导出成本

- 难点：sql.js SQL 和 export 都是同步计算，旧实现每次编辑重写整库。
- 方案：Worker Thread、实体级变更、相关 chunk 更新、后台 checkpoint。
- 不足：export 仍是整库字节导出。
- 下一步：继续压测数据库增长曲线，必要时评估 native SQLite，但不在当前轮次贸然切换。
- 面试表达：强调优化的是热路径和主线程阻塞，而不是宣称 sql.js 已变成真正页级持久化。

### 8.2 崩溃恢复与队列竞态

- 难点：journal、Worker revision、SQLite metadata 和 UI 状态可能处于不同阶段。
- 方案：串行 coordinator、baseRevision、checkpointedRevision、最新 revision 循环等待和启动重放。
- 不足：Worker 发生不可恢复的实体应用失败后，目前更适合提示重启，而不是在线重建 Worker 状态。
- 下一步：增加 Worker health 状态和从 journal 主动重建机制。
- 面试表达：讲清楚“确认写 journal”和“确认 checkpoint”的不同承诺。

### 8.3 长文档质量与调用成本同时受控

- 难点：chunk 越小调用越多，越大又容易漏证据；深度模式主题数会放大 Writer/Enricher 调用。
- 方案：固定资源上限、并发度 3、预计/实际调用数、每步一次重试和总预算。
- 不足：单个 chunk 最终失败时当前任务整体失败，没有部分成功预览。
- 下一步：持久化 EvidenceBatch 并支持人工选择“跳过失败块/重试该块”。
- 面试表达：说明预算控制是编排的一部分，不是事后看账单。

### 8.4 模型输出不稳定

- 难点：模型可能返回代码块、畸形 JSON、缺字段或不存在的 Evidence ID。
- 方案：JSON 提取、本地结构检查、Evidence 白名单、归一化、有限重试和本地 fallback。
- 不足：当前是手写 schema 检查，缺少统一 Zod/JSON Schema 定义和原始响应调试视图。
- 下一步：统一 schema registry 和脱敏 trace。
- 面试表达：模型输出始终是不可信输入，落库前必须经过确定性代码。

### 8.5 旧数据兼容与密钥迁移

- 难点：需要保持 SQLite、旧 JSON、v1 同步包和旧明文设置可读，同时不能再次暴露密钥。
- 方案：版本迁移备份、schema v5/v6、sync v1/v2 reader、loadSafeSnapshot。
- 不足：跨更多历史版本时，当前迁移仍会变得集中。
- 下一步：把每个 schema migration 拆成独立幂等函数并记录执行结果。
- 面试表达：迁移不是改 CREATE TABLE，而是备份、兼容读、失败处理和验证的完整链。

### 8.6 前端复杂交互的一致性

- 难点：学科切换、空主题、搜索结果、层级移动、删除撤销和自动保存容易互相影响。
- 方案：领域纯函数、reducer、明确 subject selection 和 retry 状态。
- 不足：App.tsx 仍协调多个领域，端到端交互测试覆盖仍需扩充。
- 下一步：继续拆分 `useRagChat`、`useConversationMemory`、`useSyncPackage` 和 settings hook。
- 面试表达：渐进式拆分优先保持数据兼容和用户操作语义。

## 9. 当前不足与技术债

### 9.1 同步导入后的 revision 失配

- 问题：同步包导入在主进程推进 revision，但结果类型和 UI 状态不接收新 revision。
- 代码位置：`electron-src/main.cts` 的 `sync:import-package`、`src/types.ts` 的 `SyncImportResult`、`src/hooks/useAutosave.ts`。
- 影响：导入后的下一次自动保存可能稳定触发 `REVISION_CONFLICT`，用户只能看到保存失败，重试不会自动解决 stale baseRevision。
- 改进：让导入返回 `{data, revision}`，为 `useAppData/useAutosave` 提供原子 `replaceSnapshot`；遇到冲突时 reload 最新 snapshot 并显式 rebase 或提示用户决策。
- 优先级：P0，发布前修复。

### 9.2 存储后台任务缺少统一关闭协议

- 问题：`storage-core` 会后台 schedule checkpoint，但没有 `close()/awaitIdle()`；测试只删除临时目录。
- 代码位置：`electron-src/storage-core.cts` 的 `scheduleCheckpoint()`，`tests/storage.integration.test.ts` 的 `afterEach`。
- 影响：本轮 25 项测试中 1 项因 `ENOTEMPTY` 失败，当前 release workflow 会被阻断；类似问题也可能影响应用退出前最后一次 flush 的可证明性。
- 改进：提供幂等 `close()`，内部等待 journal、checkpoint、persist 队列并关闭 DB；测试 teardown 必须先 close/flush，再清理目录；Electron `before-quit` 也应显式等待或记录退出策略。
- 优先级：P0，发布门禁阻断。

### 9.3 Agent 业务编排仍集中在主入口

- 问题：`electron-src/main.cts` 约 2167 行，同时承载 Agent runtime、prompt 拼装、归一化、本地 fallback、三种导入模式和 IPC handler。
- 影响：职责边界在设计上存在、在代码文件上仍耦合；修改一种模式可能影响其他 IPC，单元测试也难以隔离。
- 改进：拆为 `agent-runtime`、`fast-import-pipeline`、`deep-import-pipeline`、`normalizers`、`local-fallbacks`，主入口只做装配。
- 优先级：P1。

### 9.4 sql.js checkpoint 仍是全库 export

- 问题：增量 SQL 只优化内存数据库热路径，持久化仍执行 `db.export()` 并原子替换整个文件。
- 影响：数据量和附件型内容增长后，Worker 内存峰值、写放大和 checkpoint 时长都会线性上升；当前 1000 篇基准不能代表多年数据。
- 改进：增加按数据库体积、会话长度和 chunk 数分层的长稳基准；达到阈值后评估 native SQLite WAL，而不是只比较单次搜索延迟。
- 优先级：P1。

### 9.5 Agent schema 校验浅且分散

- 问题：`validateAgentOutput()` 主要检查顶层对象和少量数组，字段长度、嵌套类型、枚举、任务 ID 与 Validator rewrite 目标没有统一 schema。
- 影响：畸形输出可能在后续 normalizer 中被静默降级，质量问题难区分是模型、prompt 还是结构错误；Agent 数量增加后约束会漂移。
- 改进：建立 Zod/JSON Schema registry，用同一 schema 生成运行时校验、类型和错误摘要；保存脱敏 validation failure。
- 优先级：P1。

### 9.6 Evidence 仍有间接 prompt injection 风险

- 问题：不可信文档经过 Ingestor 后，其文本被放入 `<VERIFIED_EVIDENCE>`，但“verified”只代表 ID 在集合内，不代表内容安全可信。
- 影响：恶意文档可能通过 evidenceText/detail 将指令传递给 Orchestrator/Writer；目前缺少对抗测试来证明系统 prompt 足以阻断。
- 改进：保留 `taintedSource=true` 语义、限制/转义控制性文本、在每一阶段重复声明 evidence 仍是数据，并建立注入语料回归测试。
- 优先级：P1（安全与内容可信度）。

### 9.7 Agent 任务只记录摘要，不能精确恢复

- 问题：数据库保存 run/step 状态和截断摘要，但未保存 EvidenceBatch、Plan、Draft 等可执行 artifact。
- 影响：启动只会把 running 标记为 interrupted；用户重新选择文件会重新付费，不能从失败 step 继续，也无法复现质量问题。
- 改进：版本化 artifact 表、prompt/model/schema 版本、幂等 step key 和人工恢复 UI。
- 优先级：P2。

### 9.8 RAG 质量上限与评估缺失

- 问题：检索是最多 32 个 term 的启发式计数，没有同义词、BM25/FTS5、embedding、rerank，也没有 recall/faithfulness 数据集。
- 影响：搜索性能达标不等于召回质量达标；跨语言、别名和概念型问题容易漏召回。
- 改进：先建立固定查询—相关 chunk 标注集，再比较 lexical、FTS5 和 hybrid；引用 UI 应区分“检索命中”与“回答真正采用”。
- 优先级：P2。

### 9.9 费用表与校准策略需要治理

- 问题：价格和 `DASHBOARD_CALIBRATION` 硬编码在 `model-provider.cts`，更新时间由代码字符串表达；OpenAI-compatible 并不保证遵循 OpenAI 定价。
- 影响：费用展示可能随模型价格变化或第三方 Endpoint 而失真，校准倍率也难解释为通用规则。
- 改进：把价格来源、适用 Provider/Endpoint、有效期和倍率配置化；未知兼容服务默认只展示 token，不估算费用。
- 优先级：P2。

### 9.10 测试与生产观测仍不完整

- 问题：已有领域、存储、安全合同和 smoke 测试，但缺少同步 revision 回归、Agent pipeline fixture、prompt injection、React 主流程和长时间稳定性测试；生产侧主要是 console。
- 影响：当前测试数量小且偏底层，复杂 UI/Agent 组合回归和用户数据故障难定位。
- 改进：补同步导入后编辑 E2E、失败/取消/重试矩阵、固定 AI fixtures、结构化脱敏日志、数据库健康检查和诊断包。
- 优先级：P1（同步回归），其余 P2。

### 9.11 桌面发布能力未完全产品化

- 问题：当前代码未体现代码签名、自动更新、正式恢复 UI 和发布后遥测策略。
- 影响：Windows 安装信任、升级迁移和故障恢复仍依赖人工流程。
- 改进：先定义签名与更新通道，再做可回滚 schema/应用升级；恢复 UI 应建立在现有 backup/journal 之上。
- 优先级：P2。

## 10. 可继续开发的高价值方向

### 10.0 先完成 revision 与存储生命周期闭环

这是进入新功能前最值得优先完成的可靠性工作：让所有“替换整库”的路径都返回并同步 revision，为存储实现 `close()/awaitIdle()`，补充同步导入后继续编辑以及应用退出时最后一次保存的回归测试。涉及 `storage.cts`、`storage-core.cts`、sync IPC、`useAppData/useAutosave` 和测试基建。完成后能把当前架构从“核心机制成立”提升到“跨入口一致性成立”，也是最有说服力的工程复盘材料。

### 10.1 可恢复 Agent 工作流

持久化 EvidenceBatch、SubjectPlan 和 Draft artifact，使 interrupted run 能从人工选择的 step 恢复，并在恢复前展示预计新增费用。需要改 Agent schema、storage 和 Import UI。价值是把长导入从“一次请求”升级为真正的可恢复工作流。

### 10.2 关键词 + embedding 混合 RAG

在现有 note_chunks 基线上增加 embedding provider、向量索引版本和混合候选合并，同时保留 lexical score 作为解释信号。挑战是本地/远程 embedding 成本、增量索引和模型切换一致性。完成后问答质量和项目展示价值都会明显提高。

### 10.3 AI 输出评估体系

建立固定导入语料，评估 evidence coverage、faithfulness、结构完整度、重复率、费用和耗时；把 Prompt/模型/价格表版本写入报告。需要扩展测试夹具和 Agent trace。它能把 Prompt 调整从主观试错升级为可比较工程。

### 10.4 学习画像与复习调度

新增 review_items、review_events 和 mastery snapshot，根据笔记、对话与答题表现生成间隔复习计划。技术挑战是掌握度模型、可解释调度和隐私数据生命周期。它能让产品从知识整理工具升级为学习系统。

### 10.5 本地备份恢复与诊断中心

把现有 journal/backup 机制做成用户可见的恢复点，增加数据库健康检查、导出脱敏诊断和 Worker 状态。它直接提升桌面产品可信度，也能展示可靠性工程能力。

## 11. 面试讲述稿

### 1 分钟版本

LearnAgent 是一个本地优先的 AI 学习桌面应用，用 Electron、React、TypeScript 和 sql.js 构建。它把 Markdown 导入、分层笔记、关键词 RAG、长期对话记忆、知识回写和模型费用统计做成完整闭环。最核心的工程点有两个：一是 revision + fsync journal + Worker 增量 SQL，让高频编辑不会直接阻塞主进程，并能恢复已确认变更；二是证据驱动的快/深双模式 Agent 流水线，把长文档拆成抽证据、规划、写作、增强和校验步骤，同时限制调用预算。密钥通过 safeStorage 管理，renderer 不持有已保存 API Key，IPC、导航和外链也都有主进程校验。

### 3 分钟版本

项目背景是普通 AI 笔记工具往往只解决一次生成，用户长期使用后还会遇到资料太长、笔记如何组织、历史知识怎么召回、对话如何沉淀、模型失败怎么办以及成本是否可控等问题。我把数据模型设计成学科、显式主题、层级笔记、会话记忆和用量记录，并用 SQLite 保存。

前端修改不会每次传整库，而是生成带 baseRevision 的实体变更。主进程先把变更 fsync 到 journal，再由 Worker Thread 对受影响实体和 note chunks 做增量 SQL，后台导出 SQLite 并原子替换。这样 UI 可以区分变更已接收和真正已落盘，崩溃后还能重放 journal。

文档导入提供快速、深度和离线三种模式。深度模式先按 chunk 抽 Evidence，再规划主题和写作任务，Writer/Enricher 并发生成，Validator 最多触发一次定向重写，最后由本地代码合并。每一步都记录 run/step、调用数和 usage；输入文档被视为不可信数据，输出也要经过结构与 Evidence ID 校验。

安全方面，BrowserWindow 使用 sandbox/contextIsolation，preload 只暴露窄化 Bridge，IPC 校验发送方和 payload；远程模型只允许 HTTPS，Ollama HTTP 只允许本机；API Key 用 safeStorage 加密并从旧数据迁移。本轮实测中类型检查、构建、smoke、包体和性能预算通过，但存储测试因后台 checkpoint 生命周期竞态未全绿，而且同步导入后存在 revision 未回传的闭环缺口。因此下一步不是先扩新功能，而是先修 revision 与 storage close 协议，再做可恢复 Agent artifact、统一 schema 和混合 RAG。

## 12. 代码证据索引

- `src/App.tsx`：前端跨领域编排、学科切换、会话、同步和设置入口。
- `src/domain/library.ts`：主题合并、层级修复、移动、删除与撤销的纯函数。
- `src/hooks/useAutosave.ts`：实体 diff、revision 保存状态和 flush 重试。
- `src/hooks/useKnowledgeImport.ts`：导入预检、模式选择、进度与知识地图落库。
- `electron-src/preload.cts`：renderer 可访问能力的完整白名单。
- `electron-src/ipc-security.cts`：IPC sender、大小和对象结构校验。
- `electron-src/window-security.cts`：sandbox、导航、窗口、权限和外链协议策略。
- `electron-src/secrets.cts`、`key-migration.cts`：safeStorage 与旧明文密钥迁移。
- `electron-src/model-provider.cts`：Endpoint 策略、取消/超时、退避重试、错误脱敏和 usage 记账。
- `electron-src/agent-registry.cts`：各 Agent 的职责和稳定 system prompt。
- `electron-src/import-limits.cts`：文件、字符、chunk 和调用估算上限。
- `electron-src/main.cts`：快速/深度/离线编排、Agent 输出归一化和 IPC handler。
- `electron-src/storage.cts`：主进程 journal/revision 协调与 Worker RPC。
- `electron-src/storage-core.cts`：schema、迁移、增量 SQL、chunk 索引、恢复与 checkpoint。
- `electron-src/sync-package.cts`：同步包 v1/v2 校验、合并和层级修复。
- `electron-src/main.cts` 的 `sync:import-package`：证明导入会调用 `saveData()` 推进 revision，但返回对象没有 revision。
- `src/hooks/useAutosave.ts`：证明 renderer 使用 hook 内部 revision ref 提交 baseRevision，冲突后仅进入 error/retry，不做 reload/rebase。
- `tests/storage.integration.test.ts`：revision、journal 恢复、增量索引、级联删除和 v4 迁移测试代码。
- `tests/security-and-contracts.test.ts`：IPC、URL、Provider、同步、导入限制和密钥迁移测试代码。
- `.github/workflows/release.yml`：发布门禁顺序。
- `scripts/storage-benchmark.cjs`、`scripts/check-bundle-budget.cjs`：性能和包体预算验收代码；2026-07-24 本机实测分别通过。

## 13. 给后续 AI 笔记系统的导入提示

建议生成的核心笔记主题：

1. revision + journal + Worker 的本地持久化协议。
2. sql.js 实体级增量更新与 checkpoint 取舍。
3. 证据驱动的快/深双模式 Agent 编排。
4. Prompt injection、模型输出和 IPC 三层不可信输入边界。
5. safeStorage 密钥迁移与 renderer 最小暴露。
6. chunk scoring 如何同时服务搜索和 RAG。
7. 会话记忆与知识回写闭环。
8. 真实 Token、费用校准和历史口径治理。
9. 同步导入 revision 失配：跨入口一致性为何比单路径正确更难。
10. 异步存储生命周期：为什么测试 teardown 能暴露架构接口缺口。

适合扩展成面试问题的难点：连续 revision 的 checkpoint 竞态、journal 何时可压缩、Agent 调用预算、Evidence ID 校验、层级循环修复、旧数据库与同步包兼容。

适合转成优化路线的技术债：revision 回传与 rebase、storage close/awaitIdle、main.cts 继续拆分、可恢复 Agent artifact、统一 schema registry、间接 prompt injection 回归、混合 RAG、Worker 自愈、结构化诊断和桌面签名/更新。

信息不足时不要编造：当前没有真实用户规模、线上故障率、生产设备性能分布、真实 RAG 准确率、代码签名状态、自动更新实现或云同步服务。本轮基准只代表 2026-07-24 当前机器与脚本固定数据集，不能外推为线上 SLA。
