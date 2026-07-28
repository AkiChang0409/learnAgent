import { useCallback, useRef, useState } from 'react';
import { Check, Clipboard, Lightbulb, ShieldCheck, X } from 'lucide-react';
import { useModalFocus } from '../hooks/useModalFocus';
import codebaseTechnicalAnalysisSkill from '../content/codebase-technical-analysis-writer.md?raw';

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

export function TipsDialog({ open, onClose, onCopied }: {
  open: boolean;
  onClose: () => void;
  onCopied: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const close = useCallback(() => onClose(), [onClose]);
  useModalFocus(open, dialogRef, close, closeRef);

  if (!open) return null;

  async function handleCopy() {
    try {
      await copyText(codebaseTechnicalAnalysisSkill);
      setCopyState('copied');
      onCopied();
      window.setTimeout(() => setCopyState('idle'), 2200);
    } catch {
      setCopyState('error');
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
              <span className="tip-index">TIP 01</span>
            </div>
            <h3>先用 Codex 生成项目技术分析 Markdown</h3>
            <p className="tip-summary">
              直接导入普通 README 往往缺少架构、数据流和代码证据。把这份 Skill 放进你的 Codex 项目，
              让 Codex 先读代码并生成高质量分析文档，再导入 LearnAgent，项目笔记会更完整、可靠。
            </p>

            <ol className="tip-steps">
              <li><strong>1</strong><span>复制下方完整 Skill 内容</span></li>
              <li><strong>2</strong><span>保存为 <code>.agents/skills/codebase-technical-analysis-writer/SKILL.md</code></span></li>
              <li><strong>3</strong><span>将生成的 Markdown 导入 LearnAgent</span></li>
            </ol>

            <div className="tip-actions">
              <button className="primary-action" type="button" onClick={() => void handleCopy()}>
                {copyState === 'copied' ? <Check size={16} /> : <Clipboard size={16} />}
                {copyState === 'copied' ? '已复制' : copyState === 'error' ? '复制失败，请展开预览手动复制' : '复制 Skill 内容'}
              </button>
            </div>

            <details className="tip-preview">
              <summary>预览 Skill 内容</summary>
              <pre>{codebaseTechnicalAnalysisSkill}</pre>
            </details>
          </article>
        </div>
      </section>
    </div>
  );
}
