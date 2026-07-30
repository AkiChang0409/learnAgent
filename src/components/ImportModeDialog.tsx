import { useCallback, useRef } from 'react';
import { Gauge, Laptop, Lightbulb, SearchCheck, X } from 'lucide-react';
import type { MarkdownImportMode, MarkdownSourceSelection } from '../types';
import type { AgentPersonaId, AgentPersonaSummary, AiProvider } from '../types';
import { useModalFocus } from '../hooks/useModalFocus';
import { PersonaSelector } from './PersonaSelector';

const MODES: Array<{ id: MarkdownImportMode; title: string; detail: string; icon: typeof Gauge }> = [
  { id: 'fast', title: '快速分析', detail: '证据抽取、整体推理与深度评审；适合一般资料。', icon: Gauge },
  { id: 'deep', title: '深度分析', detail: '规划因果与数据流、分主题写作、拓展和边界校验；耗时和调用更多。', icon: SearchCheck },
  { id: 'offline', title: '离线整理', detail: '不调用模型，按标题和原文生成基础知识地图。', icon: Laptop }
];

export function ImportModeDialog({
  selection,
  personas = [],
  personaId = 'learning-notes',
  provider = 'local',
  onPersonaChange = () => undefined,
  onStart,
  onClose,
  onOpenTips
}: {
  selection: MarkdownSourceSelection | null;
  personas?: AgentPersonaSummary[];
  personaId?: AgentPersonaId;
  provider?: AiProvider;
  onPersonaChange?: (value: AgentPersonaId) => void;
  onStart: (mode: MarkdownImportMode) => void;
  onClose: () => void;
  onOpenTips: () => void;
}) {
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useModalFocus(Boolean(selection), dialogRef, close, firstOptionRef);
  if (!selection) return null;
  const selectedPersona = personas.find((persona) => persona.id === personaId);
  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="dialog import-mode-dialog" role="dialog" aria-modal="true" aria-labelledby="import-mode-title">
        <header className="dialog-head">
          <div>
            <h2 id="import-mode-title">选择导入模式</h2>
            <p>{selection.fileName} · {selection.characterCount.toLocaleString()} 字符 · {selection.chunkCount} 块</p>
          </div>
          <button className="icon-button ghost" type="button" onClick={onClose} aria-label="关闭"><X size={17} /></button>
        </header>
        <div className="import-mode-options">
          {personas.length > 0 && (
            <PersonaSelector
              personas={personas}
              value={personaId}
              provider={provider}
              onChange={onPersonaChange}
            />
          )}
          <aside className="import-project-tip">
            <Lightbulb size={18} />
            <span>
              <strong>导入项目资料？</strong>
              <small>官方建议先用 Codex Skill 生成包含架构、数据流和代码证据的技术分析 Markdown。</small>
            </span>
            <button type="button" className="link-button" onClick={onOpenTips}>查看方案</button>
          </aside>
          {MODES.map(({ id, title, detail, icon: Icon }) => {
            const unsupported = selectedPersona ? !selectedPersona.executionProfiles.includes(id) : false;
            const modelBlocked = provider === 'local' && Boolean(selectedPersona?.requiresModelForProfessionalAnalysis);
            return (
              <button
                ref={id === 'fast' ? firstOptionRef : undefined}
                key={id}
                type="button"
                className="import-mode-option"
                disabled={unsupported || modelBlocked}
                onClick={() => onStart(id)}
              >
                <Icon size={20} />
                <span><strong>{title}</strong><small>{detail}</small></span>
                <em>{modelBlocked ? '需配置模型' : unsupported ? '当前模式不支持' : `${selection.estimatedCalls[id]} 次调用`}</em>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
