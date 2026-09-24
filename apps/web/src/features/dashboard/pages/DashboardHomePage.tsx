import { Home } from 'lucide-react';
import type { Session } from '../../auth/types';
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';

export function DashboardHomePage({ session }: { session: Session }) {
  const nombre = session.user?.nombre_completo;

  const { hasUnsavedChanges, setHasUnsavedChanges } = useUnsavedChanges();

  return (
    <div className="page-placeholder">
      <span className="page-placeholder__icon">
        <Home size={52} />
      </span>
      <h2>¡Hola, {nombre ? `${nombre.split(' ')[0]}` : 'usuario'}!</h2>
      <p>Selecciona una opción del menú para comenzar a gestionar la clínica SEAP.</p>

      <div
        style={{
          marginTop: '2rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          opacity: 0.8,
        }}
      >
        <input
          type="checkbox"
          id="unsaved-toggle"
          checked={hasUnsavedChanges}
          onChange={(e) => setHasUnsavedChanges(e.target.checked)}
        />
        <label htmlFor="unsaved-toggle" style={{ fontSize: '0.85rem' }}>
          [Test] Simular cambios sin guardar
        </label>
      </div>
    </div>
  );
}
