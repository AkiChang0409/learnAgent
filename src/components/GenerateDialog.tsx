import { useCallback, useRef } from 'react';
import { Loader2, Mic, MicOff, Sparkles, X } from 'lucide-react';
import { useModalFocus } from '../hooks/useModalFocus';

export function GenerateDialog({
  open,
  value,
  targetSubject,
  isGenerating,
  isListening,
  voiceError,
  onChange,
  onGenerate,
  onToggleListening,
  onClose
}: {
  open: boolean;
  value: string;
  targetSubject: string;
  isGenerating: boolean;
  isListening: boolean;
  voiceError: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onToggleListening: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useModalFocus(open, dialogRef, close, inputRef);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="generate-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="AI 生成笔记"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="generate-head">
          <div className="generate-title">
            <span className="generate-icon">
              <Sparkles size={17} />
            </span>
            <div>
              <strong>AI 生成笔记</strong>
              <span>将整理进「{targetSubject}」，先收敛范围，再生成一篇聚焦笔记</span>
            </div>
          </div>
          <button className="icon-button ghost" onClick={onClose} aria-label="关闭" title="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="generate-scope-guide" aria-label="生成标准">
          <strong>单篇生成标准</strong>
          <span>只解决一个核心问题</span>
          <span>不整段复制材料</span>
          <span>解释机制、边界与迁移</span>
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
          placeholder="写下一个主题或核心问题，也可以粘贴材料并说明最想理解的部分。例如：结合这份岗位 JD，只分析 MLOps 工程师最核心的能力链路，不要复述全部职责…"
        />

        <div className="generate-input-meta">
          <span>AI 会先排除无关内容；材料越长，越建议明确“只讲什么”。</span>
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
          <button className="primary-action" onClick={onGenerate} disabled={!value.trim() || isGenerating}>
            {isGenerating ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
            生成聚焦笔记
          </button>
        </div>
      </section>
    </div>
  );
}
