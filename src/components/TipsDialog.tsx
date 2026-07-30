import { useCallback, useRef, useState } from 'react';
import { Check, Clipboard, Download, Lightbulb, MessageSquareText, ShieldCheck, X } from 'lucide-react';
import { useModalFocus } from '../hooks/useModalFocus';
import { PROJECT_ANALYSIS_TIP } from '../content/tips';

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('无法访问剪贴板');
}

function downloadText(fileName: string, value: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function TipsDialog({ open, onClose, onCopied }: {
  open: boolean;
  onClose: () => void;
  onCopied: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [promptCopyState, setPromptCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const close = useCallback(() => onClose(), [onClose]);
  useModalFocus(open, dialogRef, close, closeRef);

  if (!open) return null;

  async function handleCopy() {
    try {
      await copyText(PROJECT_ANALYSIS_TIP.content);
      setCopyState('copied');
      onCopied();
      window.setTimeout(() => setCopyState('idle'), 2200);
    } catch {
      setCopyState('error');
    }
  }

  async function handlePromptCopy() {
    try {
      await copyText(PROJECT_ANALYSIS_TIP.codexPrompt);
      setPromptCopyState('copied');
      window.setTimeout(() => setPromptCopyState('idle'), 2200);
    } catch {
      setPromptCopyState('error');
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="tips-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tips-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="tips-head">
          <div className="tips-title">
            <span><Lightbulb size={20} /></span>
            <div>
              <h2 id="tips-title">小贴士</h2>
              <p>让导入资料更适合生成结构化笔记</p>
            </div>
          </div>
          <button ref={closeRef} className="icon-button ghost" type="button" onClick={onClose} aria-label="关闭小贴士">
            <X size={18} />
          </button>
        </header>

        <div className="tips-body">
          <article className="tip-card">
            <div className="tip-card-top">
              <span className="tip-badge"><ShieldCheck size={13} /> 官方推荐</span>
              <span className="tip-index">TIP {String(PROJECT_ANALYSIS_TIP.index).padStart(2, '0')}</span>
            </div>
            <h3>{PROJECT_ANALYSIS_TIP.title}</h3>
            <p className="tip-summary">{PROJECT_ANALYSIS_TIP.summary}</p>
            <p className="tip-version">Skill v{PROJECT_ANALYSIS_TIP.version} · 更新于 {PROJECT_ANALYSIS_TIP.updatedAt}</p>

            <ol className="tip-steps">
              {PROJECT_ANALYSIS_TIP.steps.map((step, index) => (
                <li key={step}><strong>{index + 1}</strong><span>{step}</span></li>
              ))}
            </ol>

            <div className="tip-actions">
              <button className="primary-action" type="button" onClick={() => void handleCopy()}>
                {copyState === 'copied' ? <Check size={16} /> : <Clipboard size={16} />}
                {copyState === 'copied' ? '已复制' : copyState === 'error' ? '复制失败，请展开预览手动复制' : '复制 Skill 内容'}
              </button>
              <button className="secondary-action" type="button" onClick={() => downloadText(PROJECT_ANALYSIS_TIP.fileName, PROJECT_ANALYSIS_TIP.content)}>
                <Download size={16} />
                下载 SKILL.md
              </button>
              <button className="secondary-action" type="button" onClick={() => void handlePromptCopy()}>
                {promptCopyState === 'copied' ? <Check size={16} /> : <MessageSquareText size={16} />}
                {promptCopyState === 'copied' ? '指令已复制' : promptCopyState === 'error' ? '指令复制失败' : '复制 Codex 指令'}
              </button>
            </div>

            <details className="tip-preview">
              <summary>预览 Skill 内容</summary>
              <pre>{PROJECT_ANALYSIS_TIP.content}</pre>
            </details>
          </article>
        </div>
      </section>
    </div>
  );
}
