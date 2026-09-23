import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';

export function AlertDialog({
  title,
  description,
  buttonText = 'Entendido',
  onClose,
}: {
  title: string;
  description: string;
  buttonText?: string;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function trapFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const focusable = dialog.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
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
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-title"
        aria-describedby="alert-description"
        onKeyDown={trapFocus}
      >
        <h2 id="alert-title">{title}</h2>
        <p id="alert-description">{description}</p>
        <div className="dialog-actions">
          <button
            ref={closeButton}
            className="button button--primary"
            type="button"
            onClick={onClose}
          >
            {buttonText}
          </button>
        </div>
      </section>
    </div>
  );
}

