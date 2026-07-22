# LearnAgent 多 Agent 编排技术设计

> 本文档专门描述 LearnAgent 的专业多 Agent 编排系统，目标是解决“大量输入材料下，单 Agent 一次性生成完整学科内容质量不足”的问题。
>
> 重点包括：
>
> - 整体编排架构
> - 每个 Agent 的职责边界
> - 每个 Agent 的 prompt 配置
> - 每个 Agent 的输入输出 schema
> - 长输入处理、质量校验、失败重试和落库流程

## 1. 设计目标

当前 LearnAgent 已具备 Markdown 导入、知识抽取和知识整理能力，但如果输入变成完整开发日志、长篇项目复盘或多文件资料，单个 Agent 很容易出现以下问题：

- 一次性承担阅读、筛选、规划、写作、补充和校验，职责过重。
- 长输入压缩后遗漏后半部分内容。
- 生成内容泛泛而谈，缺少项目证据。
- 面试题、案例、易错点和正文混在同一个 prompt 中，质量不稳定。
- 输出难以调试，无法判断是哪一步出了问题。

因此需要将导入流程升级为“证据驱动的多 Agent 流水线”：

```text
大量输入
  -> 分块
  -> 证据抽取
  -> 主题规划
  -> 单篇笔记生成
  -> 补充信息增强
  -> 质量校验
  -> 合并落库
```

核心原则：

- **Evidence first**：先从原始资料中抽取可追溯事实，再生成内容。
- **Single responsibility**：每个 Agent 只做一个任务。
- **Context scoped**：每个 Agent 只拿到完成任务必要的上下文。
- **Schema constrained**：每个 Agent 输出严格 JSON，便于校验、重试和落库。
- **Human-reviewable**：中间产物可展示、可调试、可解释。

## 2. 整体编排流程

推荐编排如下：

```text
Input files / Markdown / 开发日志
  |
  v
DocumentChunker
  - 按标题、日期、模块、长度切分
  - 生成 sourceId / chunkId / headingPath
  |
  v
document.ingestor
  - 每个 chunk 抽取 EvidenceItem[]
  |
  v
EvidenceStore
  - 合并、去重、排序、保留 sourceRef
  |
  v
subject.orchestrator
  - 基于 evidence 生成 SubjectPlan
  - 拆分 TopicPlan 和 NoteTask
  |
  v
topic.note-writer
  - 对每个 NoteTask 生成一篇 CoreNoteDraft
  |
  v
note.enricher
  - 对每篇 CoreNoteDraft 补充案例、易错点、面试问题
  |
  v
knowledge.validator
  - 检查覆盖、重复、幻觉、泛化、结构问题
  |
  v
RetryController
  - 根据 rewriteTasks 局部重跑 writer / enricher
  |
  v
subject.merger
  - 合并为 SubjectKnowledgeMap
  - 转成 Note / subNote / Conversation
```

## 3. 统一运行上下文

每个 Agent 都应该接收一个稳定的运行信封，而不是临时拼接一段纯文本。

```ts
interface AgentRunEnvelope<TTask, TEvidence> {
  runId: string;
  language: 'zh-CN';
  projectBrief: ProjectBrief;
  sourceManifest: SourceManifestItem[];
  globalConstraints: string[];
  task: TTask;
  evidence: TEvidence;
}

interface ProjectBrief {
  projectName: string;
  projectType: string;
  targetAudience: 'interview' | 'technical-review' | 'learning';
  qualityGoal: string;
}

interface SourceManifestItem {
  sourceId: string;
  fileName: string;
  fileType: 'markdown' | 'text' | 'dev-log' | 'unknown';
  chunkCount: number;
}
```

示例：

```json
{
  "projectName": "LearnAgent",
  "projectType": "本地优先 AI 学习桌面应用",
  "targetAudience": "interview",
  "qualityGoal": "提炼项目亮点、工程取舍、实现难点、可复用经验，避免普通功能说明"
}
```

`globalConstraints` 建议包含：

```json
[
  "输出使用中文。",
  "不要编造原始材料中不存在的技术细节、指标或结果。",
  "优先提炼项目亮点、技术价值、难点、解决方案和工程取舍。",
  "避免普通功能说明，内容应适合技术复盘和面试表达。",
  "所有 Agent 输出必须是 JSON 对象，不要输出 Markdown 包裹。"
]
```

## 4. 数据结构设计

### 4.1 EvidenceItem

`EvidenceItem` 是整个编排系统最关键的中间产物。后续所有主题规划、笔记生成和校验都应该基于它。

```ts
interface EvidenceItem {
  id: string;
  kind:
    | 'feature'
    | 'module'
    | 'architecture'
    | 'workflow'
    | 'technical-decision'
    | 'challenge'
    | 'solution'
    | 'tradeoff'
    | 'data-model'
    | 'security'
    | 'performance'
    | 'testing'
    | 'deployment'
    | 'risk'
    | 'future-work';
  title: string;
  detail: string;
  topicHint: string;
  importance: 1 | 2 | 3 | 4 | 5;
  evidenceText: string;
  sourceRef: {
    sourceId: string;
    chunkId: string;
    headingPath: string[];
  };
}
```

设计要点：

- `id` 用于后续引用和追踪。
- `kind` 帮助 orchestrator 判断主题结构。
- `importance` 帮助控制优先级。
- `evidenceText` 保留短证据，避免后续 Agent 编造。
- `sourceRef` 支持回溯原始 chunk。

### 4.2 SubjectPlan

`SubjectPlan` 是 orchestrator 的输出，不是最终笔记。

```ts
interface SubjectPlan {
  subject: string;
  title: string;
  overviewIntent: string;
  globalTags: string[];
  topics: TopicPlan[];
  coverageNotes: string[];
}

interface TopicPlan {
  id: string;
  title: string;
  intent: string;
  priority: 1 | 2 | 3 | 4 | 5;
  requiredEvidenceIds: string[];
  noteTasks: NoteTask[];
}

interface NoteTask {
  id: string;
  title: string;
  objective: string;
  mustCover: string[];
  expectedSections: string[];
  requiredEvidenceIds: string[];
  avoid: string[];
}
```

设计要点：

- Orchestrator 只负责规划，不写正文。
- 每个 `NoteTask` 应该能独立交给 writer。
- `mustCover` 是 validator 后续检查覆盖率的依据。
- `avoid` 用于减少重复和跑题。

### 4.3 CoreNoteDraft

```ts
interface CoreNoteDraft {
  taskId: string;
  title: string;
  subject: string;
  topic: string;
  tags: string[];
  summary: string;
  sections: Array<{
    heading: string;
    content: string;
  }>;
  cases: string[];
  pitfalls: string[];
  interviewQuestions: string[];
  usedEvidenceIds: string[];
}
```

说明：

- writer 主要生成 `summary` 和 `sections`。
- `cases`、`pitfalls`、`interviewQuestions` 可先为空，由 enricher 专门补。
- `usedEvidenceIds` 用于 validator 检查内容依据。

### 4.4 NoteEnrichment

```ts
interface NoteEnrichment {
  noteTaskId: string;
  cases: string[];
  pitfalls: string[];
  interviewQuestions: string[];
  suggestedTags: string[];
  enrichmentRationale: string;
  usedEvidenceIds: string[];
}
```

### 4.5 ValidationReport

```ts
interface ValidationReport {
  ok: boolean;
  score: number;
  issues: Array<{
    severity: 'blocker' | 'major' | 'minor';
    targetId: string;
    type:
      | 'missing-evidence'
      | 'unsupported-claim'
      | 'missing-coverage'
      | 'duplicate-content'
      | 'too-generic'
      | 'bad-structure'
      | 'weak-interview-question';
    message: string;
    suggestedFix: string;
    relatedEvidenceIds: string[];
  }>;
  rewriteTasks: Array<{
    agentId: 'topic.note-writer' | 'note.enricher';
    targetId: string;
    instruction: string;
    requiredEvidenceIds: string[];
  }>;
}
```

## 5. Agent 设计

### 5.1 document.ingestor

#### 职责

`document.ingestor` 负责读取单个 chunk，并抽取可追踪的项目事实卡片。

它只做事实抽取，不做：

- 主题规划
- 笔记正文写作
- 面试题生成
- 总结文章
- 原文没有的推理扩展

#### 输入

```ts
interface IngestorTask {
  sourceId: string;
  fileName: string;
  chunkId: string;
  chunkIndex: number;
  chunkCount: number;
  headingPath: string[];
  chunkText: string;
}
```

#### 输出

```ts
interface EvidenceBatch {
  sourceId: string;
  chunkId: string;
  chunkSummary: string;
  evidenceItems: EvidenceItem[];
}
```

#### System Prompt

```text
你是 LearnAgent 的 document.ingestor，负责从开发日志、Markdown 文档或项目说明中抽取可追踪的项目事实。

你的任务只包括“抽取事实卡片”，不要写成总结文章，不要做最终主题规划，不要补充原文没有的信息。

抽取时优先保留这些内容：
1. 项目功能和用户流程。
2. 模块边界和架构设计。
3. 关键技术决策、取舍、约束和原因。
4. 遇到的工程难点、解决方案和替代方案。
5. 数据模型、检索、Agent 编排、模型调用、失败兜底、安全、性能、部署等实现细节。
6. 可以在面试中体现项目价值的证据。

要求：
- 每条 evidence 都必须来自输入文本。
- 不要编造不存在的技术栈、指标、难点或结论。
- 如果原文只描述功能，要提取功能事实，不要强行上升成架构亮点。
- evidenceText 必须是输入中的短摘录或忠实改写，用于后续追溯。
- 只输出 JSON 对象，不要输出 Markdown。

输出 JSON 字段：
sourceId, chunkId, chunkSummary, evidenceItems。
```

#### User Prompt 模板

```text
项目背景：
{{projectBriefJson}}

输入文件：
- sourceId: {{sourceId}}
- fileName: {{fileName}}
- chunkId: {{chunkId}}
- chunkIndex: {{chunkIndex}} / {{chunkCount}}
- headingPath: {{headingPathJson}}

全局质量目标：
{{qualityGoal}}

请从下面 chunk 中抽取 evidenceItems。

原文 chunk：
{{chunkText}}
```

#### 运行建议

- 对每个 chunk 独立运行。
- 可串行，后续可并发。
- 每个 chunk 失败时只重试当前 chunk。
- 本地 fallback 可用标题和段落规则生成低质量 evidence。

### 5.2 subject.orchestrator

#### 职责

`subject.orchestrator` 负责基于全部 evidence 规划知识地图。

它只做：

- 学科识别
- 主题划分
- 笔记任务拆解
- 证据分配
- 覆盖缺口说明

它不写完整正文。

#### 输入

```ts
interface OrchestratorTask {
  evidenceItems: EvidenceItem[];
  preferredTopicCount?: number;
  preferredNoteCountPerTopic?: number;
}
```

#### 输出

```ts
type OrchestratorOutput = SubjectPlan;
```

#### System Prompt

```text
你是 LearnAgent 的 subject.orchestrator，负责把项目 evidence cards 规划成一套适合技术复盘和面试表达的知识地图。

你的任务是“规划”，不是写正文。你需要决定：
1. 这个项目应该归为哪个 subject。
2. 应拆成哪些 topics。
3. 每个 topic 下应该生成哪些 note。
4. 每篇 note 必须覆盖哪些 evidence。
5. 哪些内容不要重复写。

评审视角：
- 面试官不需要普通功能清单，更关注架构判断、工程难点、AI 应用设计、数据流、失败处理、扩展性和真实产品问题。
- 如果 evidence 支持，应优先规划能体现技术价值的主题。
- 如果 evidence 不足，不要编造，只在 coverageNotes 中说明缺口。

约束：
- 每个 topic 应有清晰边界。
- 每篇 note 聚焦一个技术能力或项目亮点。
- requiredEvidenceIds 必须来自输入 evidence。
- avoid 用于提醒 writer 不要重复或跑题。
- 不要写完整笔记正文。
- 只输出 JSON 对象，不要输出 Markdown。
```

#### User Prompt 模板

```text
项目背景：
{{projectBriefJson}}

输入来源：
{{sourceManifestJson}}

全局质量目标：
{{qualityGoal}}

可用 evidence cards：
{{evidenceItemsJson}}

请生成 SubjectPlan。

规划要求：
- 面向 {{targetAudience}}。
- 优先体现项目亮点、技术价值、难点和解决方案。
- 控制主题数量，避免碎片化。
- 每个 noteTask 都必须能用 requiredEvidenceIds 支撑。
- 如果某些关键主题证据不足，请写入 coverageNotes。
```

#### 运行建议

- Orchestrator 可以拿全部 evidence，但不要拿原始全文。
- 如果 evidence 太多，先按 importance 和 kind 压缩，再保留高价值 evidence。
- 输出后应做本地 schema 校验，确保所有 `requiredEvidenceIds` 都存在。

### 5.3 topic.note-writer

#### 职责

`topic.note-writer` 负责根据一个 `NoteTask` 写一篇核心技术笔记。

它只写当前任务，不做全局规划，不补充面试题。

#### 输入

```ts
interface NoteWriterTask {
  subjectPlan: Pick<SubjectPlan, 'subject' | 'title' | 'overviewIntent' | 'globalTags'>;
  topicPlan: TopicPlan;
  noteTask: NoteTask;
  evidencePack: EvidenceItem[];
}
```

#### 输出

```ts
type NoteWriterOutput = CoreNoteDraft;
```

#### System Prompt

```text
你是 LearnAgent 的 topic.note-writer，负责根据一个明确的 NoteTask 写出一篇高质量项目技术笔记。

你只写当前这一篇 note，不要扩展到其他主题，不要重做主题规划。

写作目标：
- 面向技术复盘和面试表达。
- 重点讲清楚这个能力为什么重要、项目中如何实现、解决了什么问题、有什么工程取舍。
- 内容必须基于提供的 evidence pack。
- 可以做合理归纳，但不能编造 evidence 中不存在的实现、指标或结果。

写作风格：
- 中文。
- 专业、具体、工程化。
- 避免“提高效率、优化体验”这类空泛表达，必须说明具体机制。
- 每个 section 聚焦一个清晰问题。
- 适合落库为长期学习笔记。

约束：
- 只输出 JSON 对象，不要输出 Markdown。
- usedEvidenceIds 必须列出实际使用的 evidence id。
- 如果 evidence 不足以支撑某个 mustCover，请在对应 section 中明确写“当前材料未提供细节”，不要编造。
```

#### User Prompt 模板

```text
项目背景：
{{projectBriefJson}}

所属主题：
{{topicPlanJson}}

当前写作任务：
{{noteTaskJson}}

全局写作约束：
{{globalConstraintsJson}}

当前任务可用 evidence pack：
{{evidenceItemsJson}}

请生成一篇 CoreNoteDraft。

特别注意：
- 只写当前 noteTask。
- 必须覆盖 mustCover。
- 不要写 avoid 中禁止重复的内容。
- sections 应该体现“问题 -> 方案 -> 实现机制 -> 价值/取舍”的技术逻辑。
- 不要生成泛泛的项目介绍。
```

#### 运行建议

- 每个 `NoteTask` 单独运行一次 writer。
- Writer 可并发，但要限制并发数，避免模型请求过载。
- 如果 validator 指出某篇 note 泛化或缺覆盖，只重跑对应 task。

### 5.4 note.enricher

#### 职责

`note.enricher` 负责给核心笔记补充案例、易错点、面试问题和标签。

它不重写正文。

#### 输入

```ts
interface NoteEnricherTask {
  noteTask: NoteTask;
  coreNoteDraft: CoreNoteDraft;
  evidencePack: EvidenceItem[];
}
```

#### 输出

```ts
type NoteEnricherOutput = NoteEnrichment;
```

#### System Prompt

```text
你是 LearnAgent 的 note.enricher，负责把一篇项目技术笔记增强成适合面试复盘和深入学习的材料。

你不重写正文，只补充：
1. cases：项目中的具体场景、流程或实现案例。
2. pitfalls：容易被误解、容易答泛、容易踩坑的点。
3. interviewQuestions：面试官可能追问的问题，必须能考察技术深度。
4. suggestedTags：可帮助检索和复习的标签。

要求：
- 所有补充都必须基于核心笔记和 evidence pack。
- 面试问题不要停留在“介绍一下某功能”，要追问设计原因、边界、替代方案、失败处理、扩展方向。
- 易错点要指出具体误区，而不是泛泛写“注意安全性”。
- 案例要尽量贴合项目实现。
- 如果证据不足，宁可少写，不要编造。
- 只输出 JSON 对象，不要输出 Markdown。
```

#### User Prompt 模板

```text
项目背景：
{{projectBriefJson}}

当前核心笔记：
{{coreNoteDraftJson}}

当前任务 evidence pack：
{{evidenceItemsJson}}

原始写作任务：
{{noteTaskJson}}

请生成 NoteEnrichment。

质量要求：
- cases 2-4 条。
- pitfalls 3-5 条。
- interviewQuestions 4-8 条。
- 每个问题尽量能引出项目技术价值或工程取舍。
- 不要重复正文原句。
```

#### 运行建议

- 每篇 note 运行一次 enricher。
- 如果 evidence 少，可以少写补充项，但不能编造。
- Enricher 的输出和 writer 的正文由 merger 合并。

### 5.5 knowledge.validator

#### 职责

`knowledge.validator` 负责从技术评审和面试官视角检查生成结果。

它不直接修改内容，只输出质量报告和局部重写任务。

#### 输入

```ts
interface ValidatorTask {
  subjectPlan: SubjectPlan;
  evidenceItems: EvidenceItem[];
  notes: Array<{
    core: CoreNoteDraft;
    enrichment: NoteEnrichment;
  }>;
}
```

#### 输出

```ts
type ValidatorOutput = ValidationReport;
```

#### System Prompt

```text
你是 LearnAgent 的 knowledge.validator，负责以严格技术评审和面试官视角检查生成的知识地图。

你不负责润色，也不直接重写内容。你只输出质量报告和必要的局部重写任务。

检查重点：
1. 是否覆盖 SubjectPlan 和 NoteTask 的 mustCover。
2. 是否所有关键结论都有 evidence 支撑。
3. 是否存在 evidence 中没有的实现细节、指标或夸大说法。
4. 多篇 note 是否重复讲同一内容。
5. 是否过于普通，缺少项目工程细节。
6. 面试问题是否能考察技术深度，而不是普通问答。
7. cases、pitfalls 是否具体、可复习、可讲述。

评分标准：
- 90-100：可直接落库。
- 75-89：有少量可接受问题。
- 60-74：需要局部重写。
- 60 以下：结构或事实质量不合格。

只输出 JSON 对象，不要输出 Markdown。
```

#### User Prompt 模板

```text
项目背景：
{{projectBriefJson}}

主题规划：
{{subjectPlanJson}}

全部 evidence：
{{evidenceItemsJson}}

已生成笔记：
{{notesWithEnrichmentJson}}

请生成 ValidationReport。

要求：
- 如果发现 unsupported claim，必须指出对应 note 或 section。
- 如果发现 missing coverage，必须关联原始 noteTask.mustCover。
- rewriteTasks 只针对确实需要重写的局部内容。
- 不要因为风格偏好要求重写，重点关注事实、覆盖、结构和技术深度。
```

#### 运行建议

- 第一版可把 validator 作为可选步骤。
- 如果 `score >= 75` 且无 blocker，可以落库。
- 如果存在 blocker，优先按 `rewriteTasks` 局部重跑。
- 重试次数建议最多 1-2 次，避免无限循环和成本失控。

### 5.6 subject.merger

#### 职责

`subject.merger` 负责把通过校验的结果合并为应用当前可落库的 `SubjectKnowledgeMap`。

建议优先用本地代码实现，不需要模型。

#### 输入

```ts
interface MergerInput {
  subjectPlan: SubjectPlan;
  notes: Array<{
    core: CoreNoteDraft;
    enrichment: NoteEnrichment;
  }>;
  validationReport?: ValidationReport;
}
```

#### 输出

```ts
interface SubjectKnowledgeMap {
  subject: string;
  title: string;
  overview: string;
  tags: string[];
  topics: Array<{
    title: string;
    summary: string;
    notes: MarkdownImportNoteDraft[];
  }>;
}
```

#### 合并规则

- `subject`、`title`、`topics` 来自 `SubjectPlan`。
- note 的 `summary` 和 `sections` 来自 `CoreNoteDraft`。
- note 的 `cases`、`pitfalls`、`interviewQuestions` 来自 `NoteEnrichment`。
- `tags` 合并 `CoreNoteDraft.tags` 和 `NoteEnrichment.suggestedTags`，去重。
- 如果存在 blocker，可以阻止落库或只落库通过的 note。
- `usedEvidenceIds` 暂时不进入 UI，可以作为调试字段保存在 job step 里。

## 6. Prompt 配置落地方式

建议把 Agent 配置从当前 `AGENT_REGISTRY` 扩展成更结构化的形式：

```ts
interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  outputSchemaName: string;
  operation: TokenUsageOperation;
  fallback?: 'local-rule' | 'skip' | 'fail';
}
```

示例：

```ts
const AGENT_REGISTRY = {
  'document.ingestor': {
    id: 'document.ingestor',
    name: '文档证据抽取 Agent',
    description: '从单个 chunk 中抽取 EvidenceItem',
    systemPrompt: DOCUMENT_INGESTOR_SYSTEM,
    outputSchemaName: 'EvidenceBatch',
    operation: 'import-markdown',
    fallback: 'local-rule'
  },
  'subject.orchestrator': {
    id: 'subject.orchestrator',
    name: '主题规划 Agent',
    description: '基于 evidence 生成 SubjectPlan',
    systemPrompt: SUBJECT_ORCHESTRATOR_SYSTEM,
    outputSchemaName: 'SubjectPlan',
    operation: 'import-markdown',
    fallback: 'local-rule'
  }
};
```

Prompt 组织建议：

```text
systemPrompt
  - Agent 身份
  - 职责边界
  - 质量标准
  - 禁止事项
  - 输出 JSON 要求

userPrompt
  - projectBrief
  - sourceManifest
  - 当前 task
  - 当前 evidence
  - 具体执行要求
```

不要把所有规范都堆进 user prompt。稳定规则放 system prompt，动态任务放 user prompt。

## 7. 长输入处理策略

### 7.1 分块

推荐优先级：

1. Markdown 标题。
2. 开发日志日期。
3. 模块边界。
4. 字符或 token 长度。

chunk 元信息：

```ts
interface DocumentChunk {
  sourceId: string;
  chunkId: string;
  chunkIndex: number;
  chunkCount: number;
  headingPath: string[];
  text: string;
}
```

建议 chunk 大小：

- 普通模型：6000-9000 字符。
- 大上下文模型：12000-18000 字符。
- 不建议无限放大 chunk，因为 ingestor 需要稳定抽取事实，而不是读完整文档。

### 7.2 Evidence 去重

多个开发日志可能重复描述同一件事。EvidenceStore 应做轻量去重：

- title 相似
- detail 相似
- source 不同但 topicHint 相同
- kind 相同且证据内容高度重合

去重后保留：

- 更具体的 detail
- 更高 importance
- 多个 sourceRef

第一版可以不做复杂语义去重，只做字符串相似和同标题合并。

### 7.3 Evidence Pack 构造

Writer 和 enricher 不拿全部 evidence，而是拿当前任务相关的 evidence pack。

构造规则：

```text
noteTask.requiredEvidenceIds
  + topicPlan.requiredEvidenceIds 中高 importance 的 evidence
  + 少量 architecture / technical-decision 全局 evidence
```

这样 writer 能理解当前任务的局部上下文，也不会丢失项目全局背景。

## 8. 编排伪代码

```ts
async function importKnowledgeWithAgents(files, settings) {
  const runId = createId('agent_run');
  const chunks = chunkFiles(files);

  const evidenceBatches = [];
  for (const chunk of chunks) {
    const batch = await runAgentJson('document.ingestor', {
      runId,
      projectBrief,
      sourceManifest,
      globalConstraints,
      task: chunk,
      evidence: null
    });
    evidenceBatches.push(batch);
  }

  const evidenceItems = normalizeAndDedupeEvidence(evidenceBatches);

  const subjectPlan = await runAgentJson('subject.orchestrator', {
    runId,
    projectBrief,
    sourceManifest,
    globalConstraints,
    task: { evidenceItems },
    evidence: evidenceItems
  });

  validateSubjectPlan(subjectPlan, evidenceItems);

  const generatedNotes = [];
  for (const topic of subjectPlan.topics) {
    for (const noteTask of topic.noteTasks) {
      const evidencePack = buildEvidencePack(noteTask, topic, evidenceItems);

      const core = await runAgentJson('topic.note-writer', {
        runId,
        projectBrief,
        sourceManifest,
        globalConstraints,
        task: { subjectPlan, topicPlan: topic, noteTask },
        evidence: evidencePack
      });

      const enrichment = await runAgentJson('note.enricher', {
        runId,
        projectBrief,
        sourceManifest,
        globalConstraints,
        task: { noteTask, coreNoteDraft: core },
        evidence: evidencePack
      });

      generatedNotes.push({ core, enrichment });
    }
  }

  const report = await runAgentJson('knowledge.validator', {
    runId,
    projectBrief,
    sourceManifest,
    globalConstraints,
    task: { subjectPlan, notes: generatedNotes },
    evidence: evidenceItems
  });

  const repairedNotes = await retryIfNeeded(report, generatedNotes, evidenceItems);

  return mergeSubjectKnowledgeMap(subjectPlan, repairedNotes, report);
}
```

## 9. 失败处理与重试

### 9.1 JSON 解析失败

处理策略：

1. 尝试从代码块中提取 JSON。
2. 尝试截取第一个 `{` 到最后一个 `}`。
3. schema 校验失败时，调用 repair prompt。
4. repair 仍失败，则当前 step 标记 failed。

Repair prompt：

```text
下面是一个不符合 schema 的 Agent 输出。请只修复为合法 JSON，不要改变事实含义，不要新增内容。

目标 schema：
{{schemaDescription}}

原始输出：
{{rawOutput}}
```

### 9.2 单个 chunk 抽取失败

- 重试当前 chunk。
- 仍失败则记录 error step。
- 如果失败 chunk 占比低，可以继续导入并在 coverageNotes 中说明。

### 9.3 Writer 输出泛化

由 validator 生成 rewriteTask：

```json
{
  "agentId": "topic.note-writer",
  "targetId": "note_task_rag_design",
  "instruction": "当前笔记对 SQLite chunk 检索机制描述过泛，请基于 evidence e12/e18/e21 重写 sections，重点说明 note_chunks、scoreChunk、当前笔记 boost 和 fallback。",
  "requiredEvidenceIds": ["e12", "e18", "e21"]
}
```

重试时 user prompt 应额外加入：

```text
这是一次局部重写。上次输出存在以下问题：
{{validatorIssue}}

请按 rewrite instruction 重新生成当前 CoreNoteDraft。
```

### 9.4 成本控制

建议：

- 记录每个 step 的 token usage。
- Orchestrator 只运行一次。
- Writer / enricher 可按任务运行，但限制最大 note 数。
- Validator 可配置开关。
- 重试最多 1-2 次。
- 本地 fallback 不进入高质量导入，只作为可运行兜底。

## 10. Job Step 记录

为了让多 Agent 系统可调试，建议新增任务记录。

```ts
interface AgentJob {
  id: string;
  createdAt: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
  sourceFiles: string[];
  projectBrief: ProjectBrief;
  progress: {
    totalSteps: number;
    completedSteps: number;
    currentStep: string;
  };
}

interface AgentJobStep {
  id: string;
  jobId: string;
  agentId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  inputSummary: string;
  outputSummary: string;
  usageRecordId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
```

价值：

- UI 可以展示导入进度。
- 用户可以知道卡在哪个 Agent。
- 失败后可以局部重试。
- 后续可以做质量评估和成本分析。

## 11. 第一版实现范围

建议第一版先实现最小闭环：

```text
document.ingestor
  -> subject.orchestrator
  -> topic.note-writer
  -> note.enricher
  -> 本地 merger
```

Validator 可以先作为第二阶段加入。

第一版必做：

- EvidenceItem schema。
- SubjectPlan schema。
- CoreNoteDraft schema。
- NoteEnrichment schema。
- Agent prompt 配置。
- JSON schema 校验。
- 基于 requiredEvidenceIds 构造 evidence pack。
- 进度提示。

第一版暂缓：

- 复杂语义去重。
- 并发调度。
- 自动重试多轮。
- UI 展示 evidence 引用。
- 长期 job 历史管理。

## 12. 质量标准

最终生成的学科知识地图应满足：

- 每个主题边界清楚。
- 每篇笔记聚焦一个技术能力。
- 正文能说明问题、方案、实现、取舍。
- 案例和易错点具体。
- 面试问题能追问技术深度。
- 重要内容都能追溯到 evidence。
- 不把普通功能描述包装成虚假的技术亮点。
- 输入信息不足时明确说明缺口，不编造。

## 13. 总结

这套多 Agent 编排系统的关键不是“Agent 数量更多”，而是把大输入生成任务拆成可控的工程流水线：

```text
原文 -> 证据 -> 规划 -> 写作 -> 增强 -> 校验 -> 落库
```

这样做可以同时解决：

- 大输入上下文过载。
- 单 Agent 职责过重。
- 输出质量不可控。
- 内容缺少项目证据。
- 面试题和案例泛泛。
- 失败后无法局部修复。

对于 LearnAgent 这个项目来说，这会是一个非常有技术含量的演进方向：它把“AI 生成笔记”升级成“可追踪、可校验、可重试、可扩展的知识生产 Agent 系统”。
