import { useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { Session } from '../types';

export function HomePage({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const triggerButton = useRef<HTMLButtonElement>(null);

  function closeDialog() {
    setConfirming(false);
    queueMicrotask(() => triggerButton.current?.focus());
  }

  return (
    <main className="app-shell">
      <header>
        <div>
          <strong>PsicoGestión</strong>
          <span>SEAP · UADY</span>
        </div>
        <button
          ref={triggerButton}
          className="secondary"
          type="button"
          onClick={() => setConfirming(true)}
        >
          Cerrar sesión
        </button>
      </header>
      <section className="welcome">
        <h1>
          Bienvenida{session.user?.nombre_completo ? `, ${session.user.nombre_completo}` : ''}
        </h1>
        <p>
          Tu sesión está activa. Los módulos clínicos se incorporarán en las siguientes iteraciones.
        </p>
      </section>
      {confirming && (
        <ConfirmDialog
          title="¿Cerrar sesión?"
          description="Se eliminarán los datos de esta sesión en este equipo."
          onCancel={closeDialog}
          onConfirm={() => void onLogout()}
        />
      )}
    </main>
  );
}
