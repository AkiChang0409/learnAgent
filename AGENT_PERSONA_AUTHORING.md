# LearnAgent Agent Persona 开发规范

Agent Persona 是 LearnAgent 中经过编译、版本化和测试的专业能力包。外部 `SKILL.md` 可以作为设计输入，但不会在应用内直接执行。

## 运行模型

- Persona 决定任务目标、领域规则、产物拓扑、质量门槛以及问答/记忆/回写行为。
- `focused / fast / deep / offline` 是独立的执行策略；Persona 必须显式声明自己支持哪些策略。
- Renderer 只能读取不含 Prompt 的 Persona 目录。完整定义位于 Electron 主进程。
- 用户文档始终是不可信数据，不能覆盖平台、Persona、阶段或输出契约。

## 新增 Persona 的步骤

1. 在 `electron-src/persona-registry.cts` 中声明稳定 ID、版本、展示信息、操作能力和执行策略。
2. 定义领域 System Prompt，明确事实、推断、未知信息和禁止事项的边界。
3. 选择单文档或知识地图产物拓扑，并定义摘要名称和动态集合蓝图。
4. 复用现有聚焦、抽证据、规划、写作、增强、校验和重写阶段；只有现有阶段无法表达任务时才新增 Agent。
5. 在 `persona-quality.cts` 中加入可确定执行的本地质量门槛，模型评审不能替代安全或事实边界检查。
6. 添加固定输入夹具，验证 Prompt 组合、产物结构、质量拒绝条件、Local Provider 行为和生命周期透传。

## Persona Definition 必备字段

- `id`：发布后不可改变的 kebab-case ID。
- `version`：正整数；破坏输出语义或质量规则时升级。
- `operations`：generate、import、chat、memory、distill 的显式子集。
- `executionProfiles`：focused、fast、deep、offline 的显式子集。
- `importTopology`：single-document 或 knowledge-map。
- `summaryLabel` 与 `collectionBlueprint`：定义文档语义，不定义任意可执行 UI。
- `domainSystem` 与生命周期 Prompt：只描述领域能力，平台安全约束由 Runtime 统一添加。

## 兼容规则

- 旧笔记解析为 `learning-notes@1`。
- 已保存笔记保留生成时的 Persona ID、版本、摘要名称和动态集合。
- 切换 Persona 不重写既有正文，只影响后续 Agent 行为。
- 删除或升级 Persona 时，必须保留旧版本解析或提供显式迁移；不得静默改变旧笔记语义。
- 专业 Persona 没有可信的本地分析能力时，不得伪装成专业结果；应禁用或明确标记为原文整理。

## 发布门禁

- Registry ID/版本唯一，公开目录不泄露 Prompt。
- 未知 Persona、非法版本、不支持的执行策略在 IPC 边界被拒绝。
- 至少一个成功夹具和一个应拒绝夹具。
- 动态集合进入存储、同步、搜索与 RAG。
- 生成、导入、问答、记忆和回写保持同一个 Persona 版本。
- `npm run check`、`npm run test:unit`、`npm run build` 和 Electron smoke 全部通过。

## 示例：由 Skill 编译为一个 JD Persona

`analyze-job-description` Skill 被编译为唯一的 `job-description-analyst@1`，没有拆成多个用户可见模式。Persona 内部自动使用 JD 专属的完整信息规划、五节写作、质量评审和最多一次整体重写流程。

- 固定产物为：岗位概览、主要工作、职位要求、核心技术要求解释、福利与其他信息，以及最多两句话的“一句话判断”。
- 原文的 required / preferred / optional 强度、薪资、地点、签证和工作形式必须保留；缺失项写“JD 未说明”。
- 当前桌面 Agent Runtime 没有浏览器工具，因此 Skill 的在线调研步骤被编译为安全降级：只有输入自带可信公开来源时才能使用，否则形成“待调研项”，不能伪造公司、行业、技术或市场薪酬结论。
- Persona 仍贯穿生成、Markdown 导入、当前页问答、阶段记忆与对话回写。
