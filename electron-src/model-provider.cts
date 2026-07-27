const { randomUUID } = require('node:crypto');

const OPENAI_PRICES_PER_MILLION: Array<[string, { input: number; cachedInput: number; output: number }]> = [
  ['gpt-4.1-mini', { input: 0.4, cachedInput: 0.1, output: 1.6 }],
  ['gpt-4.1', { input: 2, cachedInput: 0.5, output: 8 }],
  ['gpt-4o-mini', { input: 0.15, cachedInput: 0.075, output: 0.6 }],
  ['gpt-4o', { input: 2.5, cachedInput: 1.25, output: 10 }],
  ['gpt-5.6-sol', { input: 5, cachedInput: 0.5, output: 30 }],
  ['gpt-5.6-terra', { input: 2.5, cachedInput: 0.25, output: 15 }],
  ['gpt-5.6-luna', { input: 1, cachedInput: 0.1, output: 6 }],
  ['gpt-5.6', { input: 5, cachedInput: 0.5, output: 30 }],
  ['chat-latest', { input: 5, cachedInput: 0.5, output: 30 }],
  ['o4-mini', { input: 1.1, cachedInput: 0.275, output: 4.4 }],
  ['o3', { input: 1, cachedInput: 0.25, output: 4 }]
];

const DASHBOARD_CALIBRATION = {
  modelPrefix: 'gpt-4.1-mini',
  projectCostUsd: 0.36,
  totalCostUsd: 0.57,
  recordedEstimatedCostUsd: 0.182022
};

const DEFAULT_MODEL_TIMEOUT_MS = 60_000;
const LONG_RUNNING_MODEL_TIMEOUT_MS = 300_000;

function modelRequestTimeoutMs(operation) {
  return operation === 'import-markdown'
    ? LONG_RUNNING_MODEL_TIMEOUT_MS
    : DEFAULT_MODEL_TIMEOUT_MS;
}

function normalizeModelName(model) {
  return String(model || '').trim().toLowerCase();
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? inputTokens + outputTokens) || 0;
  const inputDetails = usage.input_tokens_details || usage.prompt_tokens_details || {};
  const outputDetails = usage.output_tokens_details || usage.completion_tokens_details || {};
  const cachedInputTokens = Number(inputDetails.cached_tokens ?? inputDetails.cache_read_tokens ?? 0) || 0;
  const reasoningTokens = Number(outputDetails.reasoning_tokens ?? 0) || 0;
  if (!inputTokens && !outputTokens && !totalTokens) return null;
  return { inputTokens, outputTokens, totalTokens, cachedInputTokens, reasoningTokens };
}

function estimateOpenAiCost(model, usage) {
  const name = normalizeModelName(model);
  const price = OPENAI_PRICES_PER_MILLION.find(([prefix]) => name === prefix || name.startsWith(`${prefix}-`))?.[1];
  if (!price || !usage) return { estimatedCostUsd: null, priceSource: 'unknown' };
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const value = ((usage.inputTokens - cached) / 1_000_000) * price.input
    + (cached / 1_000_000) * price.cachedInput
    + (usage.outputTokens / 1_000_000) * price.output;
  return { estimatedCostUsd: Number(value.toFixed(8)), priceSource: 'built-in-openai-api-pricing-2026-07-21' };
}

function validateModelEndpoint(value, provider) {
  const endpoint = new URL(String(value || ''));
  if (provider === 'ollama') {
    const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(endpoint.hostname);
    if (!loopback || !['http:', 'https:'].includes(endpoint.protocol)) {
      throw new Error('Ollama Endpoint 仅允许本机 HTTP/HTTPS 地址');
    }
  } else if (endpoint.protocol !== 'https:') {
    throw new Error('远程模型 Endpoint 必须使用 HTTPS');
  }
  return endpoint.toString();
}

async function fetchWithPolicy(url, options, timeoutMs = 60_000, externalSignal = null, fetchImpl = fetch) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      return response;
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (externalSignal?.aborted) throw new Error('IMPORT_CANCELED');
        throw new Error(`模型请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
      }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }
  throw new Error('模型请求失败');
}

async function modelHttpError(label, response) {
  const raw = await response.text().catch(() => '');
  const safeBody = raw.replace(/bearer\s+[\w.-]+/gi, 'Bearer [redacted]')
    .replace(/(?:api[_-]?key|token)["'\s:=]+[\w.-]+/gi, 'credential=[redacted]').slice(0, 300);
  return new Error(`${label} request failed: ${response.status}${safeBody ? ` — ${safeBody}` : ''}`);
}

function createModelProvider(getApiKey, fetchImpl = fetch) {
  function createUsageRecord(settings, operation, rawUsage, responseId = '') {
    const usage = normalizeUsage(rawUsage);
    if (!usage) return null;
    const provider = settings?.provider || 'local';
    const cost = provider === 'openai-compatible'
      ? estimateOpenAiCost(settings?.model || '', usage)
      : { estimatedCostUsd: provider === 'ollama' ? 0 : null, priceSource: provider === 'ollama' ? 'local-runtime' : 'unknown' };
    const calibrated = provider === 'openai-compatible'
      && normalizeModelName(settings?.model).startsWith(DASHBOARD_CALIBRATION.modelPrefix);
    const calibrationMultiplier = calibrated
      ? DASHBOARD_CALIBRATION.projectCostUsd / DASHBOARD_CALIBRATION.recordedEstimatedCostUsd
      : 1;
    const finalCost = typeof cost.estimatedCostUsd === 'number'
      ? Number((cost.estimatedCostUsd * calibrationMultiplier).toFixed(8)) : cost.estimatedCostUsd;
    return {
      id: `usage_${randomUUID()}`, createdAt: new Date().toISOString(), operation, provider,
      endpoint: settings?.endpoint || '', model: settings?.model || '', ...usage,
      baseEstimatedCostUsd: cost.estimatedCostUsd, calibrationMultiplier,
      finalEstimatedCostUsd: finalCost, estimatedCostUsd: finalCost, currency: 'usd',
      priceSource: cost.priceSource, pricingVersion: '2026-07-21',
      tokenAccountingVersion: 'provider-reported-v2', responseId
    };
  }

  function aggregateUsageRecords(records, settings, operation) {
    const valid = records.filter(Boolean);
    if (!valid.length) return null;
    const costs = valid.map((item) => item.estimatedCostUsd).filter((value) => typeof value === 'number');
    const baseCosts = valid.map((item) => item.baseEstimatedCostUsd).filter((value) => typeof value === 'number');
    const finalEstimatedCostUsd = costs.length === valid.length
      ? Number(costs.reduce((sum, value) => sum + value, 0).toFixed(8)) : null;
    const baseEstimatedCostUsd = baseCosts.length === valid.length
      ? Number(baseCosts.reduce((sum, value) => sum + value, 0).toFixed(8)) : null;
    return {
      id: `usage_${randomUUID()}`, createdAt: new Date().toISOString(), operation,
      provider: settings?.provider || 'local', endpoint: settings?.endpoint || '', model: settings?.model || '',
      inputTokens: valid.reduce((sum, item) => sum + Number(item.inputTokens || 0), 0),
      outputTokens: valid.reduce((sum, item) => sum + Number(item.outputTokens || 0), 0),
      totalTokens: valid.reduce((sum, item) => sum + Number(item.totalTokens || 0), 0),
      cachedInputTokens: valid.reduce((sum, item) => sum + Number(item.cachedInputTokens || 0), 0),
      reasoningTokens: valid.reduce((sum, item) => sum + Number(item.reasoningTokens || 0), 0),
      baseEstimatedCostUsd,
      calibrationMultiplier: Number(valid[0]?.calibrationMultiplier || 1),
      finalEstimatedCostUsd,
      estimatedCostUsd: finalEstimatedCostUsd,
      currency: 'usd', priceSource: [...new Set(valid.map((item) => item.priceSource || 'unknown'))].join('+'), responseId: '',
      pricingVersion: '2026-07-21', tokenAccountingVersion: 'provider-reported-v2'
    };
  }

  async function callModel(settings, system, messages, operation = 'unknown') {
    settings = { ...settings, apiKey: settings?.apiKey || await getApiKey() };
    const provider = settings?.provider || 'local';
    const timeoutMs = modelRequestTimeoutMs(operation);
    if (provider === 'local') throw new Error('LOCAL_PROVIDER');
    const payloadMessages = [{ role: 'system', content: system }, ...messages.map(({ role, content }) => ({ role, content }))];
    if (provider === 'ollama') {
      const endpoint = validateModelEndpoint(settings?.endpoint || 'http://127.0.0.1:11434/api/chat', provider);
      const response = await fetchWithPolicy(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: settings?.model || 'llama3.1', messages: payloadMessages, stream: false }) }, timeoutMs, settings?.__abortSignal, fetchImpl);
      if (!response.ok) throw await modelHttpError('Ollama', response);
      const data = await response.json();
      return { content: data?.message?.content || '', usageRecord: createUsageRecord(settings, operation, { prompt_tokens: data?.prompt_eval_count || 0, completion_tokens: data?.eval_count || 0 }, '') };
    }
    const endpoint = validateModelEndpoint(settings?.endpoint || 'https://api.openai.com/v1/chat/completions', provider);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    const response = await fetchWithPolicy(endpoint, { method: 'POST', headers, body: JSON.stringify({ model: settings?.model || 'gpt-4.1-mini', messages: payloadMessages, temperature: 0.35 }) }, timeoutMs, settings?.__abortSignal, fetchImpl);
    if (!response.ok) throw await modelHttpError('AI', response);
    const data = await response.json();
    return { content: data?.choices?.[0]?.message?.content || '', usageRecord: createUsageRecord(settings, operation, data?.usage, data?.id || '') };
  }
  return { callModel, aggregateUsageRecords };
}

module.exports = { createModelProvider, validateModelEndpoint, normalizeUsage, estimateOpenAiCost, fetchWithPolicy, modelRequestTimeoutMs };
