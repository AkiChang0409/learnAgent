import { Check, CircleAlert, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function ToastHost({
  toasts,
  onDismiss
}: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}) {
  if (!toasts.length) return null;

  return (
    <div className="toast-host">
      {toasts.map((toast) => (
        <article key={toast.id} className={`toast ${toast.type}`}>
          {toast.type === 'success' && <Check size={16} />}
          {toast.type === 'error' && <CircleAlert size={16} />}
          {toast.type === 'info' && <Info size={16} />}
          <span>{toast.message}</span>
          {toast.action ? (
            <button
              className="toast-action"
              onClick={() => {
                toast.action?.onClick();
                onDismiss(toast.id);
              }}
              type="button"
            >
              {toast.action.label}
            </button>
          ) : (
            <span />
          )}
          <button className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="关闭提示" title="关闭提示">
            <X size={14} />
          </button>
        </article>
      ))}
    </div>
  );
}
