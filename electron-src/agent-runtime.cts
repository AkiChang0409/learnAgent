const { composePersonaSystem, resolvePersona } = require('./persona-registry.cjs');

function personaOperationFor(operation) {
  if (operation === 'generate-note') return 'generate';
  if (operation === 'import-markdown') return 'import';
  if (operation === 'chat-with-note') return 'chat';
  if (operation === 'summarize-conversation') return 'memory';
  if (operation === 'distill-conversation-to-note') return 'distill';
  return null;
}

function createAgentRuntime({
  callModel,
  agentRegistry,
  extractJson,
  normalizeAgentOutput,
  validateAgentOutput,
  isAgentOutputError,
  markAgentOutputParseError
}) {
  async function runAgent(settings, agentId, userContent, operation, options: { json?: boolean; personaRef?: { id: string; version: number } } = {}) {
    const agent = agentRegistry[agentId];
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    const personaOperation = personaOperationFor(operation);
    const persona = resolvePersona(options.personaRef || settings.__personaRef, {
      allowDefault: true,
      operation: personaOperation || undefined
    });
    const modelResult = await callModel(
      settings,
      composePersonaSystem(persona, agent.system, personaOperation),
      [{ role: 'user', content: userContent }],
      operation
    );
    let json = null;
    if (options.json) {
      try {
        json = normalizeAgentOutput(agentId, extractJson(modelResult.content));
      } catch (error) {
        if (isAgentOutputError(error)) throw error;
        throw markAgentOutputParseError(error, agentId);
      }
      validateAgentOutput(agentId, json);
    }
    return {
      agentId,
      agentName: agent.name,
      content: modelResult.content,
      json,
      usageRecord: modelResult.usageRecord,
      personaRef: { id: persona.id, version: persona.version }
    };
  }

  return { runAgent };
}

module.exports = { createAgentRuntime, personaOperationFor };
