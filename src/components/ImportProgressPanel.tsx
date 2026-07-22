import { CheckCircle2, FileText, Loader2 } from 'lucide-react';
import type { MarkdownImportProgress } from '../types';

export function ImportProgressPanel({ progress }: { progress: MarkdownImportProgress | null }) {
  if (!progress) return null;
  const percent = Math.max(0, Math.min(progress.percent ?? 0, 100));
  const isDone = progress.stage === 'done';
  const isError = progress.stage === 'error';

  return (
    <section className={`import-progress ${isDone ? 'done' : ''} ${isError ? 'error' : ''}`}>
      <div className="import-progress-icon">
        {isDone ? <CheckCircle2 size={18} /> : isError ? <FileText size={18} /> : <Loader2 className="spin" size={18} />}
      </div>
      <div className="import-progress-body">
        <div className="import-progress-row">
          <strong>{progress.message}</strong>
          <span>{isError ? '失败' : `${percent}%`}</span>
        </div>
        <div className="import-progress-bar" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="import-progress-meta">
          {progress.fileName && <span>{progress.fileName}</span>}
          {progress.total ? <span>{progress.current || 0}/{progress.total}</span> : null}
          {progress.detail && <span>{progress.detail}</span>}
        </div>
      </div>
    </section>
  );
}
