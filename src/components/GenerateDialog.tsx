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
              <span>将整理进「{targetSubject}」，提交后会在后台运行</span>
            </div>
          </div>
          <button className="icon-button ghost" onClick={onClose} aria-label="关闭" title="关闭">
            <X size={18} />
          </button>
        </div>

        <textarea
          ref={inputRef}
          className="generate-input"
          value={value}
          autoFocus
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.key === 'Enter' && (event.metaKey || event.ctrlKey)) && value.trim() && !isGenerating) {
              event.preventDefault();
              onGenerate();
            }
          }}
          placeholder="描述今天学的内容，例如：操作系统里的虚拟内存和页面置换算法，重点讲 LRU 和时钟算法…"
        />

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
            后台生成
          </button>
        </div>
      </section>
    </div>
  );
}
