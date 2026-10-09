import type { ReactNode } from 'react';
import { forwardRef } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';

type NoticeType = 'error' | 'success' | 'info';

const ICONS = { error: CircleAlert, success: CircleCheck, info: Info };

type FormNoticeProps = {
  type: NoticeType;
  children: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
};

/** Aviso de PG-DSN-002-INT: role="alert" para errores y role="status" para lo demás. */
export const FormNotice = forwardRef<HTMLDivElement, FormNoticeProps>(function FormNotice(
  { type, children, actions, onClose },
  ref,
) {
  const Icon = ICONS[type];
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={`notice notice--block ${type}`}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? undefined : 'polite'}
    >
      <Icon size={17} aria-hidden="true" />
      <div className="notice__body">
        {children}
        {actions ? <div className="notice__actions">{actions}</div> : null}
      </div>
      {onClose ? (
        <button type="button" className="notice__close" aria-label="Cerrar aviso" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
});
