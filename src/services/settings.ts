import type { AiProvider, AiSettings } from '../types';

const providerDefaults: Record<AiProvider, Pick<AiSettings, 'endpoint' | 'model'>> = {
  local: {
    endpoint: '',
    model: ''
  },
  ollama: {
    endpoint: 'http://127.0.0.1:11434/api/chat',
    model: 'llama3.1'
  },
  'openai-compatible': {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4.1-mini'
  }
};

export function applyProviderPreset(current: AiSettings, provider: AiProvider): AiSettings {
  const preset = providerDefaults[provider];
  return {
    ...current,
    provider,
    endpoint: preset.endpoint,
    model: preset.model,
    lastTestStatus: 'idle',
    lastTestMessage: '切换 Provider 后尚未测试连接',
    lastTestedAt: undefined
  };
}

export function providerDisplayName(provider: AiProvider) {
  if (provider === 'local') return 'Local fallback';
  if (provider === 'ollama') return 'Ollama';
  return 'OpenAI-compatible';
}

export function modelStatusText(settings: AiSettings) {
  if (settings.provider === 'local') return '当前使用本地兜底模式';
  if (settings.lastTestStatus === 'success') return settings.lastTestMessage || '模型连接正常';
  if (settings.lastTestStatus === 'error') return settings.lastTestMessage || '模型连接失败';
  return '模型连接尚未测试';
}
