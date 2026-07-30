import { CheckCircle2, CircleAlert, Loader2, Sparkles, X } from 'lucide-react';
import type { NoteGenerationProgress } from '../types';

export function NoteGenerationPanel({
  tasks,
  onDismiss
}: {
  tasks: NoteGenerationProgress[];
  onDismiss: (taskId: string) => void;
}) {
  if (!tasks.length) return null;
  const running = tasks.filter((task) => task.stage !== 'done' && task.stage !== 'error').length;

  return (
    <section className="note-generation-panel" aria-live="polite">
      <div className="note-generation-heading">
        <span><Sparkles size={16} />聚焦笔记生成{running ? ` · ${running} 项进行中` : ''}</span>
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
                  <span>{failed ? '失败' : `${percent}%`}</span>
                </div>
                <div className="note-generation-bar" aria-label={`生成进度 ${percent}%`}>
                  <span style={{ width: `${percent}%` }} />
                </div>
                <p title={task.input}>{task.error || task.input}</p>
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
