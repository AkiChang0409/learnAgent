import { Activity, Check, Coins, Download, Eye, EyeOff, Loader2, PlugZap, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import type { AiProvider, AiSettings, TokenUsageRecord } from '../types';
import { applyProviderPreset, providerDisplayName } from '../services/settings';

const operationLabels: Record<string, string> = {
  'generate-note': '生成笔记',
  'chat-with-note': '笔记对话',
  'summarize-conversation': '阶段记忆',
  'distill-conversation-to-note': '沉淀笔记',
  'test-connection': '连接测试',
  unknown: '未知调用'
};

function formatInteger(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatCost(value: number | null) {
  if (value === null) return '未知';
  if (value < 0.000001) return '< $0.000001';
  return `$${value.toFixed(6)}`;
}

function summarizeUsage(records: TokenUsageRecord[]) {
  return records.reduce(
    (summary, record) => ({
      inputTokens: summary.inputTokens + record.inputTokens,
      outputTokens: summary.outputTokens + record.outputTokens,
      totalTokens: summary.totalTokens + record.totalTokens,
      cachedInputTokens: summary.cachedInputTokens + record.cachedInputTokens,
      reasoningTokens: summary.reasoningTokens + record.reasoningTokens,
      estimatedCostUsd:
        summary.estimatedCostUsd === null || record.estimatedCostUsd === null
          ? null
          : summary.estimatedCostUsd + record.estimatedCostUsd
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 0 as number | null
    }
  );
}

export function SettingsModal({
  settings,
  usageRecords,
  dataPath,
  isTesting,
  isSyncing,
  onClose,
  onChange,
  onTestConnection,
  onExportSync,
  onImportSync
}: {
  settings: AiSettings;
  usageRecords: TokenUsageRecord[];
  dataPath: string;
  isTesting: boolean;
  isSyncing: boolean;
  onClose: () => void;
  onChange: (settings: AiSettings) => void;
  onTestConnection: () => void;
  onExportSync: () => void;
  onImportSync: () => void;
}) {
  const [showApiKey, setShowApiKey] = useState(false);
  const isLocal = settings.provider === 'local';
  const isOpenAICompatible = settings.provider === 'openai-compatible';
  const usageSummary = summarizeUsage(usageRecords || []);
  const recentUsageRecords = [...(usageRecords || [])].slice(-5).reverse();

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

        <section className="usage-card">
          <div className="usage-card-heading">
            <div>
              <span className="eyebrow">Usage</span>
              <h3>Token 与费用</h3>
            </div>
            <Coins size={19} />
          </div>
          <div className="usage-stats">
            <div>
              <span>总 Token</span>
              <strong>{formatInteger(usageSummary.totalTokens)}</strong>
            </div>
            <div>
              <span>输入</span>
              <strong>{formatInteger(usageSummary.inputTokens)}</strong>
            </div>
            <div>
              <span>输出</span>
              <strong>{formatInteger(usageSummary.outputTokens)}</strong>
            </div>
            <div>
              <span>估算费用</span>
              <strong>{formatCost(usageSummary.estimatedCostUsd)}</strong>
            </div>
          </div>
          <div className="usage-details-row">
            <span>缓存输入：{formatInteger(usageSummary.cachedInputTokens)}</span>
            <span>推理 Token：{formatInteger(usageSummary.reasoningTokens)}</span>
          </div>
          <div className="usage-list">
            {recentUsageRecords.length ? (
              recentUsageRecords.map((record) => (
                <div className="usage-list-item" key={record.id}>
                  <Activity size={14} />
                  <div>
                    <strong>{operationLabels[record.operation] || record.operation}</strong>
                    <span>
                      {record.model || providerDisplayName(record.provider as AiProvider)} · {formatInteger(record.totalTokens)} tokens · {formatCost(record.estimatedCostUsd)}
                    </span>
                  </div>
                  <time>{new Date(record.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                </div>
              ))
            ) : (
              <p className="usage-empty">还没有模型调用记录</p>
            )}
          </div>
          <small className="usage-note">费用基于内置 OpenAI 价格表估算，账单对账以 OpenAI Costs API / Usage Dashboard 为准。</small>
        </section>

        <button className="secondary-action reset-provider" onClick={() => switchProvider(settings.provider)} type="button">
          <RotateCcw size={16} />
          恢复当前 Provider 默认配置
        </button>

        <section className="sync-card">
          <div>
            <span className="eyebrow">Sync</span>
            <h3>同步包</h3>
            <p>导出 JSON 同步包，在另一台设备导入并按更新时间合并。API Key 不会写入同步包。</p>
          </div>
          <div className="sync-actions">
            <button className="secondary-action" onClick={onExportSync} disabled={isSyncing} type="button">
              {isSyncing ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
              导出同步包
            </button>
            <button className="secondary-action" onClick={onImportSync} disabled={isSyncing} type="button">
              {isSyncing ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
              导入并合并
            </button>
          </div>
        </section>

        <div className="data-path">
          <Save size={16} />
          <span>{dataPath}</span>
        </div>
      </section>
    </div>
  );
}
