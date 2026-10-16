import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';

function formatRemaining(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function IdleWarningDialog({
  remainingSeconds,
  onStayActive,
}: {
  remainingSeconds: number;
  onStayActive: () => void;
}) {
  const stayButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    stayButton.current?.focus();
  }, []);

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
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-title"
        aria-describedby="idle-description"
        onKeyDown={trapFocus}
      >
        <h2 id="idle-title">Sesión por expirar</h2>
        <div id="idle-description">
          <p>
            Tu sesión se cerrará en {formatRemaining(remainingSeconds)} por inactividad. ¿Quieres
            seguir trabajando?
          </p>
          <p style={{ margin: 0 }}>
            Tiempo restante:{' '}
            <span
              className="dialog__count"
              style={{
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 800,
                color: 'var(--color-text)',
              }}
            >
              {formatRemaining(remainingSeconds)}
            </span>
          </p>
        </div>
        <div className="dialog-actions">
          <button
            ref={stayButton}
            type="button"
            className="button button--primary"
            onClick={onStayActive}
          >
            Seguir trabajando
          </button>
        </div>
      </section>
    </div>
  );
}

