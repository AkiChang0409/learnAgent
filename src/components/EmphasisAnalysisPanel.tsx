import { CheckCircle2, CircleAlert, Loader2, ScanText, X } from 'lucide-react';
import type { EmphasisAnalysisProgress } from '../types';

export function EmphasisAnalysisPanel({
  tasks,
  onDismiss
}: {
  tasks: EmphasisAnalysisProgress[];
  onDismiss: (taskId: string) => void;
}) {
  if (!tasks.length) return null;
  const running = tasks.filter((task) => task.stage !== 'done' && task.stage !== 'error').length;
  return (
    <section className="note-generation-panel emphasis-analysis-panel" aria-live="polite">
      <div className="note-generation-heading">
        <span><ScanText size={16} />重点分析{running ? ` · ${running} 项进行中` : ''}</span>
      </div>
      <div className="note-generation-list">
        {tasks.map((task) => {
          const done = task.stage === 'done';
          const failed = task.stage === 'error';
          const percent = Math.max(0, Math.min(task.percent, 100));
          return (
            <article key={task.taskId} className={`note-generation-task ${done ? 'done' : ''} ${failed ? 'error' : ''}`}>
              <span className="note-generation-status">
                {done ? <CheckCircle2 size={17} /> : failed ? <CircleAlert size={17} /> : <Loader2 className="spin" size={17} />}
              </span>
              <div className="note-generation-content">
                <div className="note-generation-row">
                  <strong>{task.message}</strong>
                  <span>{failed ? '失败' : `${task.current}/${task.total}`}</span>
                </div>
                <div className="note-generation-bar" aria-label={`重点分析进度 ${percent}%`}>
                  <span style={{ width: `${percent}%` }} />
                </div>
                <p>{task.error || `${task.subject}${task.noteTitle ? ` · ${task.noteTitle}` : ''}`}</p>
              </div>
              {(done || failed) && (
                <button type="button" className="icon-button ghost" onClick={() => onDismiss(task.taskId)} aria-label="关闭任务">
                  <X size={15} />
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
