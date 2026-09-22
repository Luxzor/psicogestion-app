import { Home } from 'lucide-react';
import type { Session } from '../../auth/types';

export function DashboardHomePage({ session }: { session: Session }) {
  const nombre = session.user?.nombre_completo;

  return (
    <div className="page-placeholder">
      <span className="page-placeholder__icon">
        <Home size={52} />
      </span>
      <h2>¡Hola, {nombre ? `${nombre.split(' ')[0]}` : 'usuario'}!</h2>
      <p>
        Selecciona una opción del menú para comenzar a gestionar la clínica SEAP.
      </p>
    </div>
  );
}

