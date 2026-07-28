---
name: codebase-technical-analysis-writer
description: Generate high-density technical analysis documents from any codebase. Use when the user asks to read a repository and produce project technical documentation, interview-oriented project analysis, architecture review notes, codebase-derived project highlights, implementation-to-requirement mapping, technical debt analysis, or source material for an AI note/learning system. Trigger for requests like "analyze this project", "write a technical project document from code", "extract interview highlights from this repo", or "create import-ready project analysis notes".
---

# Codebase Technical Analysis Writer

## Purpose

Use this skill to inspect an arbitrary code repository and produce a deep Markdown technical analysis document. The output is not a README, directory listing, marketing page, or feature checklist. It is source material for project review, technical interviews, architecture evaluation, and downstream AI note generation.

The document must explain what the project does, why it exists, how requirements map to implementation, where the technical value is, what tradeoffs were made, what is weak, and how the project can evolve.

## Operating Principles

- Read code first. Do not rely on README alone.
- Do not invent features, metrics, architecture, or complexity not supported by code.
- Mark reasonable inference explicitly with `可推断`.
- Mark missing evidence with `当前代码未体现`.
- Prefer mechanism over adjectives. Do not write vague claims such as “提升效率” unless the implementation mechanism is explained.
- Explain why a design exists, not only what files exist.
- Connect user/business needs to concrete implementation paths.
- Write for a technical interviewer or architecture reviewer.
- If the project is small, say so plainly; do not inflate ordinary CRUD/configuration into advanced architecture.

## Repository Reading Workflow

1. Scan project structure and identify runtime shape: app, service, library, CLI, desktop app, mobile app, infrastructure, plugin, or mixed system.
2. Inspect project metadata and build configuration: package manifests, dependency files, framework configs, CI/CD, deployment config, scripts.
3. Identify entrypoints: app bootstrap, server routes, CLI commands, Electron main/preload, worker handlers, library exports, or framework conventions.
4. Read core types, schemas, domain models, state containers, API contracts, events, messages, and persistence models.
5. Trace the main user, system, or API workflows from entrypoint to result.
6. Trace data flow across modules: validation, transformation, storage, retrieval, rendering, external calls, background jobs.
7. Inspect important cross-cutting mechanisms: auth, permissions, config, secrets, error handling, retry/fallback, logging, caching, queues, sync, search, AI/Agent/RAG, tests, packaging.
8. Distill real highlights, real difficulties, and real technical debt from code evidence.
9. Write the final Markdown document. Do not include exploration logs or command output unless needed as evidence.
10. Self-check the output before finalizing.

## What To Analyze

Prioritize these surfaces when present:

- Project configuration, dependencies, scripts, build and release setup.
- Application or library entrypoints.
- Routing, API, controller, IPC, CLI, worker, or command handlers.
- Core types, schemas, domain entities, DTOs, database schema, migrations.
- Persistence, file system usage, cache, search, sync, import/export.
- Service layer, workflow orchestration, background jobs, queues, async tasks.
- Frontend pages, components, state management, UX state, forms, editor surfaces.
- Backend services, auth, authorization, integrations, external APIs.
- AI, Agent, RAG, prompt/model calling, tool execution, memory, evaluation.
- Error handling, fallback, retries, validation, boundary conditions.
- Tests, build, CI/CD, packaging, deployment, observability.

Do not mechanically summarize every file. Focus on modules that explain product behavior, architecture, data flow, or engineering value.

## Required Output Structure

Produce a Chinese Markdown document with this structure:

```markdown
# 项目技术深度分析文档：<项目名>

## 1. 项目定位与真实需求

## 2. 核心用户流程 / 业务流程

## 3. 总体技术架构

## 4. 关键模块分析

## 5. 数据模型与数据流

## 6. 核心技术机制

## 7. 工程亮点与面试价值

## 8. 技术难点与解决方案

## 9. 当前不足与技术债

## 10. 可继续开发的高价值方向

## 11. 面试讲述稿

## 12. 代码证据索引

## 13. 给后续 AI 笔记系统的导入提示
```

Default length target: at least 5000 Chinese characters unless the project is genuinely small. If the project is small, still produce a complete document and explicitly state that observable complexity is limited.

## Section Requirements

### 1. 项目定位与真实需求

Explain:

- What the project is.
- What real problem it solves.
- Target users or usage scenarios.
- What needs are explicit in code and what is only inferred.
- How business/user needs map to visible code behavior.

### 2. 核心用户流程 / 业务流程

For each major workflow, include:

- User/system goal.
- Entry point.
- Modules involved.
- Data movement.
- Final result.
- Key files, functions, types, routes, commands, or handlers.

For libraries, SDKs, CLIs, or infrastructure projects, describe primary invocation or task flows instead of UI flows.

### 3. 总体技术架构

Explain:

- Technology stack and runtime shape.
- Main module boundaries.
- Frontend/backend/client/server/database/external-service relationships, when present.
- Main data flow.
- Why key dependencies matter.
- Architecture tradeoffs and limits.

Do not stop at a folder tree. Explain collaboration between modules.

### 4. 关键模块分析

For each important module, use:

- 模块职责
- 主要输入输出
- 核心文件 / 函数 / 类型
- 解决的具体问题
- 内部实现机制
- 与其他模块的关系
- 设计取舍
- 可优化点

### 5. 数据模型与数据流

Analyze domain objects, schemas, state objects, DTOs, messages, events, cache entries, or persistence records.

Explain:

- Core data objects and what business concepts they encode.
- Create/update/query/delete or lifecycle flows.
- Persistence, cache, migration, compatibility, sync, or conflict behavior.
- Strengths and limits of the model.

If no meaningful data model exists, state `当前代码未体现复杂数据模型` and explain why.

### 6. 核心技术机制

Choose mechanisms that actually exist in the code. Examples include:

- State management
- Workflow/task orchestration
- Plugin architecture
- Auth and authorization
- File processing
- Search/retrieval
- Cache strategy
- Queue/background jobs
- Realtime communication
- Data sync
- Error handling and retry
- Config and secrets
- Build/release
- AI/Agent/RAG/model calls
- Performance optimizations
- Security isolation
- Cross-platform adaptation

For each mechanism, explain why it is needed, how it works, what problem it solves, its limits, and how it could evolve.

### 7. 工程亮点与面试价值

This is the most important section. Summarize real technical highlights from interviewer/architecture-review perspective.

Each highlight must use:

- 亮点名称
- 对应需求或问题
- 代码中如何实现
- 为什么有技术价值
- 面试官可能追问什么
- 推荐回答思路

Requirement: at least 6 highlights for medium/large projects. For small projects, provide at least 3 and state that complexity is limited. Do not label ordinary CRUD, static pages, or boilerplate configuration as advanced highlights.

### 8. 技术难点与解决方案

Each difficulty must use:

- 难点是什么
- 为什么会出现
- 当前代码如何解决
- 方案不足
- 下一步优化
- 面试时如何讲

Requirement: at least 5 difficulties for medium/large projects. For small projects, include the observable difficulties and explain limits.

### 9. 当前不足与技术债

Each debt item must use:

- 问题是什么
- 代码中哪里体现
- 会带来什么影响
- 如何改进
- 优先级建议

Be honest. Include testing gaps, coupling, weak typing, weak validation, security issues, missing observability, incomplete error handling, performance risks, migration risks, deployment gaps, or UX state gaps when code supports them.

### 10. 可继续开发的高价值方向

Each direction must use:

- 方向名称
- 为什么值得做
- 需要改哪些模块
- 技术挑战是什么
- 做完后项目价值如何提升
- 面试或项目展示价值是什么

Avoid generic “optimize UI” suggestions unless tied to a specific architecture or workflow improvement.

### 11. 面试讲述稿

Provide:

- `1 分钟版本`: concise positioning, core capabilities, stack, main highlight.
- `3 分钟版本`: background, core flow, architecture, highlights, difficulties, solutions, future work.

Tone should be natural and professional, not README-like.

### 12. 代码证据索引

List only important evidence:

```markdown
- `path/to/file`: proves/supports <technical point>
- `path/to/file`: proves/supports <technical point>
```

If a conclusion is inferred, mark `可推断`.

### 13. 给后续 AI 笔记系统的导入提示

Summarize:

- Best note topics to generate.
- Highlights worth expanding.
- Difficulties suitable for interview questions.
- Technical debt suitable for optimization-roadmap notes.
- Areas where information is insufficient and should not be fabricated.

## Quality Bar

Before final output, verify:

- The project’s real problem is explained.
- Major workflows are traced through code.
- Architecture and data flow are explained, not just listed.
- Data model is analyzed or explicitly absent.
- Requirement-to-implementation mapping is clear.
- Technical highlights are real and code-supported.
- Difficulties and debt are specific.
- Interview script is included.
- Evidence index is included.
- The document avoids generic fluff and invented claims.

## Forbidden Output

Do not:

- Summarize only README.
- List only directories or files.
- Produce only a feature checklist.
- Invent nonexistent capabilities.
- Inflate project complexity.
- Call ordinary CRUD an architecture highlight.
- Output marketing copy.
- Output a very short document unless the project is truly tiny.
- Conclude without code evidence.
