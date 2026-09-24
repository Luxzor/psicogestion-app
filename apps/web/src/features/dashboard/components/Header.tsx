import { Moon, Sun } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';

const ROUTE_LABELS: Record<string, string> = {
  '/inicio': 'Inicio',
  '/inicio/agenda': 'Agenda',
  '/inicio/citas': 'Citas',
  '/inicio/pacientes': 'Pacientes',
  '/inicio/terapeutas': 'Terapeutas',
  '/inicio/salas': 'Salas',
  '/inicio/configuracion': 'Configuración',
};

export function Header() {
  const { pathname } = useLocation();
  const { theme, toggle } = useTheme();
  const pageLabel = ROUTE_LABELS[pathname] ?? 'Inicio';

  return (
    <header className="dashboard-header">
      <nav className="dashboard-header__breadcrumb" aria-label="Ubicación actual">
        <span>SEAP</span>
        <span aria-hidden="true">›</span>
        <strong>{pageLabel}</strong>
      </nav>

      <div className="dashboard-header__actions">
        <button
          type="button"
          className="icon-btn"
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          onClick={toggle}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
}
