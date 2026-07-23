import { useCallback, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useModalFocus } from '../hooks/useModalFocus';

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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const close = useCallback(() => onCancel(), [onCancel]);
  useModalFocus(Boolean(request), dialogRef, close, cancelRef);

  if (!request) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        ref={dialogRef}
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
          <button className="ghost-action" type="button" ref={cancelRef} onClick={onCancel}>
            {request.cancelLabel || '取消'}
          </button>
          <button
            className="danger-action"
            type="button"
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
