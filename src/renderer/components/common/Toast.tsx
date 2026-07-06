import { useEffect } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import clsx from 'clsx';
import { useUiStore } from '../../stores/ui.store';

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const colorMap = {
  success: 'text-success-400',
  error: 'text-danger-400',
  warning: 'text-warning-400',
  info: 'text-primary-400',
};

export function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts);
  const removeToast = useUiStore((s) => s.removeToast);

  return (
    <div
      className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type];
        return (
          <ToastItem
            key={toast.id}
            id={toast.id}
            type={toast.type}
            message={toast.message}
            Icon={Icon}
            colorClass={colorMap[toast.type]}
            onDismiss={removeToast}
          />
        );
      })}
    </div>
  );
}

function ToastItem({ id, type, message, Icon, colorClass, onDismiss }: {
  id: string; type: string; message: string; Icon: any; colorClass: string; onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), 4000);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      className={clsx(
        'glass-panel rounded-lg px-4 py-3 flex items-start gap-3 animate-slide-down shadow-lg',
      )}
    >
      <Icon size={18} className={clsx('mt-0.5 flex-shrink-0', colorClass)} aria-hidden="true" />
      <p className="text-sm text-surface-200 flex-1">{message}</p>
      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label="Dismiss notification"
        className="text-surface-500 hover:text-surface-300"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
