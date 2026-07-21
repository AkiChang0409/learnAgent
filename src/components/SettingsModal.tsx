import { Check, Eye, EyeOff, Loader2, PlugZap, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { AiProvider, AiSettings } from '../types';
import { applyProviderPreset, providerDisplayName } from '../services/settings';

export function SettingsModal({
  settings,
  dataPath,
  isTesting,
  onClose,
  onChange,
  onTestConnection
}: {
  settings: AiSettings;
  dataPath: string;
  isTesting: boolean;
  onClose: () => void;
  onChange: (settings: AiSettings) => void;
  onTestConnection: () => void;
}) {
  const [showApiKey, setShowApiKey] = useState(false);
  const isLocal = settings.provider === 'local';
  const isOpenAICompatible = settings.provider === 'openai-compatible';

  function update(patch: Partial<AiSettings>) {
    onChange({ ...settings, ...patch });
  }

  function switchProvider(provider: AiProvider) {
    onChange(applyProviderPreset(settings, provider));
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Settings</span>
            <h2>模型与存储</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭设置" title="关闭设置">
            <Check size={18} />
          </button>
        </div>

        <div className="provider-tabs" role="tablist" aria-label="AI Provider">
          {(['local', 'ollama', 'openai-compatible'] as AiProvider[]).map((provider) => (
            <button
              key={provider}
              className={settings.provider === provider ? 'active' : ''}
              onClick={() => switchProvider(provider)}
              type="button"
            >
              {providerDisplayName(provider)}
            </button>
          ))}
        </div>

        <label>
          <span>AI Provider</span>
          <select value={settings.provider} onChange={(event) => switchProvider(event.target.value as AiProvider)}>
            <option value="local">Local fallback</option>
            <option value="ollama">Ollama</option>
            <option value="openai-compatible">OpenAI-compatible</option>
          </select>
        </label>

        <label>
          <span>Endpoint</span>
          <input
            value={settings.endpoint}
            onChange={(event) => update({ endpoint: event.target.value })}
            disabled={isLocal}
            placeholder={isLocal ? 'Local fallback 不需要 Endpoint' : '模型接口地址'}
          />
        </label>

        <label>
          <span>Model</span>
          <input
            value={settings.model}
            onChange={(event) => update({ model: event.target.value })}
            disabled={isLocal}
            placeholder={isLocal ? 'Local fallback 不需要 Model' : '模型名称'}
          />
        </label>

        <label>
          <span>{isOpenAICompatible ? 'API Key' : 'API Key（可选）'}</span>
          <div className="secret-input">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={settings.apiKey}
              onChange={(event) => update({ apiKey: event.target.value })}
              disabled={isLocal}
              placeholder={isLocal ? 'Local fallback 不需要 API Key' : '输入 API Key'}
            />
            <button className="icon-button" onClick={() => setShowApiKey((value) => !value)} type="button" disabled={isLocal} aria-label="显示或隐藏 API Key" title="显示或隐藏 API Key">
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button className="icon-button danger" onClick={() => update({ apiKey: '' })} type="button" disabled={isLocal || !settings.apiKey} aria-label="清空 API Key" title="清空 API Key">
              <Trash2 size={16} />
            </button>
          </div>
        </label>

        <div className={`connection-card ${settings.lastTestStatus || 'idle'}`}>
          <div>
            <strong>连接状态</strong>
            <span>{settings.lastTestMessage || '尚未测试连接'}</span>
            {settings.lastTestedAt && <small>上次测试：{new Date(settings.lastTestedAt).toLocaleString('zh-CN')}</small>}
          </div>
          <button className="secondary-action" onClick={onTestConnection} disabled={isTesting} type="button">
            {isTesting ? <Loader2 className="spin" size={16} /> : <PlugZap size={16} />}
            测试连接
          </button>
        </div>

        <button className="secondary-action reset-provider" onClick={() => switchProvider(settings.provider)} type="button">
          <RotateCcw size={16} />
          恢复当前 Provider 默认配置
        </button>

        <div className="data-path">
          <Save size={16} />
          <span>{dataPath}</span>
        </div>
      </section>
    </div>
  );
}
