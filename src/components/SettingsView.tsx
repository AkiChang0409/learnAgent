import {
  Activity,
  ArrowLeft,
  Check,
  Coins,
  Database,
  Download,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Palette,
  PlugZap,
  RotateCcw,
  SlidersHorizontal,
  Upload
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AiProvider, AiSettings, ThemeId, TokenUsageRecord } from '../types';
import { applyProviderPreset, providerDisplayName } from '../services/settings';
import { THEMES } from '../theme';

type Section = 'appearance' | 'model' | 'usage' | 'data' | 'about';

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Palette }> = [
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'model', label: '模型', icon: SlidersHorizontal },
  { id: 'usage', label: '用量', icon: Coins },
  { id: 'data', label: '数据与同步', icon: Database },
  { id: 'about', label: '关于', icon: Info }
];

const operationLabels: Record<string, string> = {
  'generate-note': '生成笔记',
  'import-markdown': '导入 Markdown',
  'chat-with-note': '笔记对话',
  'summarize-conversation': '阶段记忆',
  'distill-conversation-to-note': '沉淀笔记',
  'analyze-emphasis': '分析重点',
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

export function SettingsView({
  settings,
  theme,
  usageRecords,
  dataPath,
  appVersion,
  isTesting,
  isSyncing,
  onBack,
  onChange,
  onSetApiKey,
  onClearApiKey,
  onThemeChange,
  onTestConnection,
  onExportSync,
  onImportSync
}: {
  settings: AiSettings;
  theme: ThemeId;
  usageRecords: TokenUsageRecord[];
  dataPath: string;
  appVersion: string;
  isTesting: boolean;
  isSyncing: boolean;
  onBack: () => void;
  onChange: (settings: AiSettings) => void;
  onSetApiKey: (value: string) => Promise<void>;
  onClearApiKey: () => Promise<void>;
  onThemeChange: (theme: ThemeId) => void;
  onTestConnection: () => void;
  onExportSync: () => void;
  onImportSync: () => void;
}) {
  const [section, setSection] = useState<Section>('appearance');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const isLocal = settings.provider === 'local';
  const isOpenAICompatible = settings.provider === 'openai-compatible';

  const verifiedUsageRecords = (usageRecords || []).filter((record) => record.tokenAccountingVersion !== 'legacy-dashboard-calibrated-v1');
  const legacyUsageRecords = (usageRecords || []).filter((record) => record.tokenAccountingVersion === 'legacy-dashboard-calibrated-v1');
  const usageSummary = summarizeUsage(verifiedUsageRecords);
  const legacyUsageSummary = summarizeUsage(legacyUsageRecords);
  const recentUsageRecords = [...(usageRecords || [])].slice(-8).reverse();
  const legacyUsageCount = legacyUsageRecords.length;

  function update(patch: Partial<AiSettings>) {
    onChange({ ...settings, ...patch });
  }

  function switchProvider(provider: AiProvider) {
    onChange(applyProviderPreset(settings, provider));
  }

  return (
    <div className="settings-view">
      <header className="settings-topbar">
        <button className="ghost-action" onClick={onBack} type="button">
          <ArrowLeft size={16} />
          返回笔记
        </button>
        <h1>设置</h1>
      </header>

      <div className="settings-body">
        <nav className="settings-nav">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={section === id ? 'active' : ''}
              onClick={() => setSection(id)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {section === 'appearance' && (
            <section className="settings-section">
              <h2>外观风格</h2>
              <p className="settings-desc">选择贯穿整个应用的视觉主题，随时可切换。</p>
              <div className="theme-picker">
                {THEMES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`theme-option ${theme === item.id ? 'active' : ''}`}
                    onClick={() => onThemeChange(item.id)}
                    aria-pressed={theme === item.id}
                  >
                    <span className="theme-swatches" aria-hidden="true">
                      {item.swatches.map((color, index) => (
                        <span className="theme-swatch" key={index} style={{ background: color }} />
                      ))}
                    </span>
                    <span className="theme-option-text">
                      <strong>{item.name}</strong>
                      <span>{item.tagline}</span>
                    </span>
                    <Check className="theme-check" size={18} />
                  </button>
                ))}
              </div>
            </section>
          )}

          {section === 'model' && (
            <section className="settings-section">
              <h2>AI 模型</h2>
              <p className="settings-desc">配置生成、对话与检索所使用的模型服务。</p>

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
                    value={apiKeyDraft}
                    onChange={(event) => setApiKeyDraft(event.target.value)}
                    disabled={isLocal}
                    placeholder={isLocal ? 'Local fallback 不需要 API Key' : settings.apiKeyConfigured ? '已安全保存；输入新值可替换' : '输入 API Key'}
                  />
                  <button
                    className="icon-button"
                    onClick={() => setShowApiKey((value) => !value)}
                    type="button"
                    disabled={isLocal}
                    aria-label="显示或隐藏 API Key"
                    title="显示或隐藏 API Key"
                  >
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {!isLocal && (
                  <div className="secret-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={!apiKeyDraft.trim()}
                      onClick={async () => {
                        await onSetApiKey(apiKeyDraft);
                        setApiKeyDraft('');
                      }}
                    >
                      保存密钥
                    </button>
                    {settings.apiKeyConfigured && (
                      <button className="ghost-action" type="button" onClick={onClearApiKey}>清除密钥</button>
                    )}
                  </div>
                )}
              </label>

              <div className={`connection-card ${settings.lastTestStatus || 'idle'}`}>
                <div>
                  <strong>连接状态</strong>
                  <span>{settings.lastTestMessage || '尚未测试连接'}</span>
                  {settings.lastTestedAt && (
                    <small>上次测试：{new Date(settings.lastTestedAt).toLocaleString('zh-CN')}</small>
                  )}
                </div>
                <button className="secondary-action" onClick={onTestConnection} disabled={isTesting} type="button">
                  {isTesting ? <Loader2 className="spin" size={16} /> : <PlugZap size={16} />}
                  测试连接
                </button>
              </div>

              <button className="ghost-action reset-provider" onClick={() => switchProvider(settings.provider)} type="button">
                <RotateCcw size={16} />
                恢复当前 Provider 默认配置
              </button>
            </section>
          )}

          {section === 'usage' && (
            <section className="settings-section">
              <h2>Token 与费用</h2>
              <p className="settings-desc">统计本地记录的模型调用量，费用为按内置价格表的估算。</p>
              <div className="usage-stats">
                <div>
                  <span>真实 Token 合计</span>
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
              {legacyUsageCount ? (
                <div className="usage-legacy-summary">
                  <strong>旧 Dashboard 校准记录（不计入上方合计）</strong>
                  <span>{legacyUsageCount} 条 · {formatInteger(legacyUsageSummary.totalTokens)} 历史 Token · {formatCost(legacyUsageSummary.estimatedCostUsd)}</span>
                </div>
              ) : null}
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
                          {record.model || providerDisplayName(record.provider as AiProvider)} ·{' '}
                          {formatInteger(record.totalTokens)} tokens · {formatCost(record.estimatedCostUsd)}
                          {record.tokenAccountingVersion === 'legacy-dashboard-calibrated-v1' ? ' · 旧校准记录' : ''}
                        </span>
                      </div>
                      <time>
                        {new Date(record.createdAt).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </time>
                    </div>
                  ))
                ) : (
                  <p className="usage-empty">还没有模型调用记录</p>
                )}
              </div>
              <small className="usage-note">
                Token 均保存 Provider 返回的真实值；校准倍率只作用于费用估价。
                {legacyUsageCount ? ` 另有 ${legacyUsageCount} 条旧记录曾按 Dashboard 口径校准，已单独标记。` : ''}
              </small>
            </section>
          )}

          {section === 'data' && (
            <section className="settings-section">
              <h2>数据与同步</h2>
              <p className="settings-desc">导出 JSON 同步包，在另一台设备导入并按更新时间合并。API Key 不会写入同步包。</p>
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
              <label className="full-field">
                <span>本地数据文件</span>
                <code className="data-path">{dataPath || '未知路径'}</code>
              </label>
            </section>
          )}

          {section === 'about' && (
            <section className="settings-section">
              <h2>关于 LearnAgent</h2>
              <p className="settings-desc">一个本地优先的学习笔记与 AI 助手应用。你的笔记只保存在本机。</p>
              <div className="about-grid">
                <div>
                  <span>版本</span>
                  <strong>v{appVersion}</strong>
                </div>
                <div>
                  <span>存储方式</span>
                  <strong>本地 SQLite</strong>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
