import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
  request,
  onCancel
}: {
  request: ConfirmRequest | null;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, onCancel]);

  if (!request) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={request.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirm-head">
          <div className="confirm-icon">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h2>{request.title}</h2>
            <p>{request.message}</p>
          </div>
        </div>
        <div className="confirm-actions">
          <button className="ghost-action" type="button" onClick={onCancel}>
            {request.cancelLabel || '取消'}
          </button>
          <button
            className="danger-action"
            type="button"
            ref={confirmRef}
            onClick={() => {
              request.onConfirm();
              onCancel();
            }}
          >
            {request.confirmLabel || '删除'}
          </button>
        </div>
      </section>
    </div>
  );
}
