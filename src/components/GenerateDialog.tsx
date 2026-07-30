import { useCallback, useRef } from 'react';
import { Loader2, Mic, MicOff, Sparkles, X } from 'lucide-react';
import { useModalFocus } from '../hooks/useModalFocus';
import type { AgentPersonaId, AgentPersonaSummary, AiProvider } from '../types';
import { PersonaSelector } from './PersonaSelector';

export function GenerateDialog({
  open,
  value,
  targetSubject,
  isGenerating,
  isListening,
  voiceError,
  personas = [],
  personaId = 'learning-notes',
  provider = 'local',
  onChange,
  onGenerate,
  onToggleListening,
  onPersonaChange = () => undefined,
  onClose
}: {
  open: boolean;
  value: string;
  targetSubject: string;
  isGenerating: boolean;
  isListening: boolean;
  voiceError: string;
  personas?: AgentPersonaSummary[];
  personaId?: AgentPersonaId;
  provider?: AiProvider;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onToggleListening: () => void;
  onPersonaChange?: (value: AgentPersonaId) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useModalFocus(open, dialogRef, close, inputRef);

  if (!open) return null;
  const selectedPersona = personas.find((persona) => persona.id === personaId);
  const personaBlocked = provider === 'local' && Boolean(selectedPersona?.requiresModelForProfessionalAnalysis);
  const isLearningPersona = personaId === 'learning-notes';

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="generate-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="AI 专业生成"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="generate-head">
          <div className="generate-title">
            <span className="generate-icon">
              <Sparkles size={17} />
            </span>
            <div>
              <strong>{selectedPersona?.name || 'AI 生成笔记'}</strong>
              <span>将整理进「{targetSubject}」，使用当前 Persona 的专业流程生成文档</span>
            </div>
          </div>
          <button className="icon-button ghost" onClick={onClose} aria-label="关闭" title="关闭">
            <X size={18} />
          </button>
        </div>

        {personas.length > 0 && (
          <PersonaSelector
            personas={personas}
            value={personaId}
            provider={provider}
            executionProfile="focused"
            onChange={onPersonaChange}
          />
        )}

        <div className="generate-scope-guide" aria-label="生成标准">
          <strong>{isLearningPersona ? '单篇生成标准' : '专业分析标准'}</strong>
          <span>{isLearningPersona ? '只解决一个核心问题' : '区分事实、推断与未知'}</span>
          <span>不整段复制材料</span>
          <span>{isLearningPersona ? '解释机制、边界与迁移' : '形成领域结论与行动建议'}</span>
        </div>

        <textarea
          ref={inputRef}
          className="generate-input"
          value={value}
          maxLength={20_000}
          autoFocus
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.key === 'Enter' && (event.metaKey || event.ctrlKey)) && value.trim() && !isGenerating) {
              event.preventDefault();
              onGenerate();
            }
          }}
          placeholder={personaId === 'job-description-analyst'
            ? '粘贴岗位描述；如需个人匹配分析，请同时提供真实经历。没有简历时只会分析岗位要求与准备方向。'
            : personaId === 'codebase-technical-analyst'
              ? '粘贴由 Codex Skill 生成的代码分析材料，并说明最关注的架构、数据流或技术取舍。'
              : '写下一个主题或核心问题，也可以粘贴材料并说明最想理解的部分。'}
        />

        <div className="generate-input-meta">
          <span>{personaBlocked ? '当前专业 Persona 需要先在设置中配置模型。' : 'AI 会先排除无关内容；材料越长，越建议明确“只讲什么”。'}</span>
          <span>{value.length.toLocaleString()} / 20,000</span>
        </div>

        <div className="generate-actions">
          <button
            className={`icon-button ghost ${isListening ? 'danger' : ''}`}
            type="button"
            onClick={onToggleListening}
            title="语音输入"
            aria-label="语音输入"
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          {voiceError && <span className="voice-error">{voiceError}</span>}
          <span className="generate-hint">Ctrl/⌘ + Enter 生成</span>
          <button className="primary-action" onClick={onGenerate} disabled={!value.trim() || isGenerating || personaBlocked}>
            {isGenerating ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
            {isLearningPersona ? '生成聚焦笔记' : '开始专业分析'}
          </button>
        </div>
      </section>
    </div>
  );
}
