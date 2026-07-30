const STRING_ARRAY_FIELDS: Record<string, string[]> = {
  'note.enricher': ['cases', 'pitfalls', 'interviewQuestions', 'suggestedTags', 'usedEvidenceIds'],
  'note.focus-planner': ['scopeIn', 'scopeOut', 'keyPoints', 'reasoningQuestions', 'extensionDirections'],
  'note.quality-critic': ['issues']
};

function textFromAgentValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (Array.isArray(value)) return value.map(textFromAgentValue).filter(Boolean).join('\n');
  if (typeof value !== 'object') return '';

  const preferredKeys = [
    'title', 'heading', 'question', 'name', 'summary', 'detail', 'content',
    'description', 'reason', 'answer', 'example', 'case', 'pitfall', 'suggestion'
  ];
  const preferred = preferredKeys
    .filter((key) => value[key] !== undefined && value[key] !== null)
    .map((key) => textFromAgentValue(value[key]))
    .filter(Boolean);
  if (preferred.length) return preferred.join('：');
  return '';
}

function stripListMarker(value) {
  return String(value || '').replace(/^\s*(?:[-*•]+|\d+[.)、])\s*/, '').trim();
}

function coerceAgentStringArray(value) {
  if (Array.isArray(value)) return value.map(textFromAgentValue).map(stripListMarker).filter(Boolean);
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    const lines = text.split(/\r?\n/).map(stripListMarker).filter(Boolean);
    return lines.length ? lines : [text];
  }
  const text = textFromAgentValue(value);
  return text ? [text] : [];
}

function normalizeAgentOutput(agentId, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const fields = STRING_ARRAY_FIELDS[agentId] || [];
  if (!fields.length) return value;
  const normalized = { ...value };
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      normalized[field] = coerceAgentStringArray(value[field]);
    }
  }
  return normalized;
}

function agentOutputError(message, details: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { code: 'AGENT_OUTPUT_CONTRACT', ...details });
}

function validateAgentOutput(agentId, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw agentOutputError(`${agentId} 输出不是 JSON 对象`, { agentId });
  }
  const requireArray = (key) => {
    if (!Array.isArray(value[key])) {
      throw agentOutputError(`${agentId} 输出字段 ${key} 必须是数组`, { agentId, field: key });
    }
  };
  if (agentId === 'note.generator') requireArray('sections');
  if (agentId === 'note.focus-planner') {
    requireArray('scopeIn');
    requireArray('scopeOut');
    requireArray('keyPoints');
    requireArray('reasoningQuestions');
    requireArray('extensionDirections');
    requireArray('evidenceItems');
  }
  if (agentId === 'note.quality-critic') {
    if (typeof value.ok !== 'boolean') {
      throw agentOutputError(`${agentId} 输出字段 ok 必须是布尔值`, { agentId, field: 'ok' });
    }
    requireArray('issues');
  }
  if (agentId === 'note.emphasis') {
    if (!value.summary || typeof value.summary !== 'object' || Array.isArray(value.summary)) {
      throw agentOutputError(`${agentId} 输出字段 summary 必须是对象`, { agentId, field: 'summary' });
    }
    requireArray('sections');
  }
  if (agentId === 'document.ingestor') requireArray('evidenceItems');
  if (agentId === 'project.analysis-master') requireArray('topics');
  if (agentId === 'project.analysis-critic') {
    if (typeof value.ok !== 'boolean') {
      throw agentOutputError(`${agentId} 输出字段 ok 必须是布尔值`, { agentId, field: 'ok' });
    }
    requireArray('issues');
  }
  if (agentId === 'subject.orchestrator') requireArray('topics');
  if (agentId === 'topic.note-writer') requireArray('sections');
  if (agentId === 'note.enricher') {
    requireArray('cases');
    requireArray('pitfalls');
    requireArray('interviewQuestions');
  }
  if (agentId === 'knowledge.validator') requireArray('issues');
}

function markAgentOutputParseError(error, agentId) {
  if (error && typeof error === 'object') {
    error.code = 'AGENT_OUTPUT_PARSE';
    error.agentId = agentId;
    return error;
  }
  return Object.assign(new Error(String(error || '模型输出不是有效 JSON')), {
    code: 'AGENT_OUTPUT_PARSE', agentId
  });
}

function isAgentOutputError(error) {
  return error?.code === 'AGENT_OUTPUT_CONTRACT' || error?.code === 'AGENT_OUTPUT_PARSE';
}

function buildAgentRetryPrompt(userContent, error) {
  const reason = String(error?.message || '输出不符合 JSON 契约').slice(0, 300);
  return [
    userContent,
    '<OUTPUT_CORRECTION>',
    `上一次输出未通过契约校验：${reason}`,
    '请重新输出完整且有效的 JSON 对象。必须包含要求的全部字段；数组字段必须使用 JSON 数组，即使没有内容也返回 []。',
    '不要输出 Markdown 代码块、解释、注释或 JSON 之外的任何文本。',
    '</OUTPUT_CORRECTION>'
  ].join('\n\n');
}

module.exports = {
  buildAgentRetryPrompt,
  coerceAgentStringArray,
  isAgentOutputError,
  markAgentOutputParseError,
  normalizeAgentOutput,
  validateAgentOutput
};
