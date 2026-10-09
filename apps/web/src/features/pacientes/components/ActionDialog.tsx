import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { LoaderCircle } from 'lucide-react';

export type DialogAction = {
  label: string;
  busyLabel?: string;
  variant: 'primary' | 'secondary';
  onClick: () => void;
  initialFocus?: boolean;
  busy?: boolean;
  disabled?: boolean;
};

/**
 * Diálogo modal con el mismo comportamiento que ConfirmDialog y AlertDialog de la Iteración 1:
 * foco inicial configurable, foco atrapado con Tab y cierre con Esc.
 */
export function ActionDialog({
  id,
  role = 'dialog',
  title,
  children,
  actions,
  notice,
  onEscape,
}: {
  id: string;
  role?: 'dialog' | 'alertdialog';
  title: string;
  children: ReactNode;
  actions: DialogAction[];
  notice?: ReactNode;
  onEscape?: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const initialIndex = Math.max(
    0,
    actions.findIndex((action) => action.initialFocus),
  );

  useEffect(() => {
    dialog.current
      ?.querySelectorAll<HTMLButtonElement>('.dialog-actions button')
      [initialIndex]?.focus();
  }, [initialIndex]);

  useEffect(() => {
    if (!onEscape) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onEscape]);

  function trapFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const focusable = dialog.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialog}
        className="dialog"
        role={role}
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onKeyDown={trapFocus}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        <div id={`${id}-description`}>{children}</div>
        {notice}
        <div className="dialog-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`button button--${action.variant}`}
              disabled={action.disabled || action.busy}
              onClick={action.onClick}
            >
              {action.busy ? (
                <>
                  <LoaderCircle size={16} className="spin" aria-hidden="true" />
                  {action.busyLabel ?? action.label}
                </>
              ) : (
                action.label
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
