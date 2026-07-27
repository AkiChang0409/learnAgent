import { CheckCircle2, FileText, Loader2 } from 'lucide-react';
import type { MarkdownImportProgress } from '../types';

export function ImportProgressPanel({ progress, onCancel }: { progress: MarkdownImportProgress | null; onCancel?: () => void }) {
  if (!progress) return null;
  const percent = Math.max(0, Math.min(progress.percent ?? 0, 100));
  const isDone = progress.stage === 'done';
  const isError = progress.stage === 'error';
  const phaseTitle = progress.phaseTitle || progress.message;
  const taskMessage = progress.taskMessage || progress.detail || (!progress.phaseTitle ? progress.message : '');
  const phaseLabel = progress.phaseCurrent && progress.phaseTotal
    ? `第 ${progress.phaseCurrent}/${progress.phaseTotal} 步`
    : isDone ? '已完成' : isError ? '未完成' : '处理中';

  return (
    <section className={`import-progress ${isDone ? 'done' : ''} ${isError ? 'error' : ''}`}>
      <div className="import-progress-icon">
        {isDone ? <CheckCircle2 size={18} /> : isError ? <FileText size={18} /> : <Loader2 className="spin" size={18} />}
      </div>
      <div className="import-progress-body">
        <div className="import-progress-row">
          <div className="import-progress-heading">
            <span>{phaseLabel}</span>
            <strong>{phaseTitle}</strong>
          </div>
          <span>{isError ? '失败' : `${percent}%`}</span>
        </div>
        <div
          className="import-progress-bar"
          role="progressbar"
          aria-label={phaseTitle}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        {taskMessage && (
          <div className="import-progress-task">
            <span>{taskMessage}</span>
            {progress.total ? <strong>{progress.current || 0}/{progress.total}</strong> : null}
          </div>
        )}
        <div className="import-progress-meta">
          {progress.fileName && <span>{progress.fileName}</span>}
          {progress.canCancel && onCancel && <button type="button" className="ghost-action" onClick={onCancel}>取消</button>}
        </div>
      </div>
    </section>
  );
}
