import { Moon, Sun } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';

const ROUTE_LABELS: Record<string, string> = {
  '/inicio': 'Inicio',
  '/inicio/agenda': 'Agenda',
  '/inicio/citas': 'Citas',
  '/inicio/pacientes': 'Pacientes',
  '/inicio/terapeutas': 'Terapeutas',
  '/inicio/salas': 'Salas',
  '/inicio/configuracion': 'Configuración',
  '/inicio/pacientes/nuevo': 'Nuevo paciente',
  '/inicio/terapeutas/nuevo': 'Nuevo terapeuta',
};

const PARENT_ROUTES: Record<string, { label: string; to: string }> = {
  '/inicio/pacientes/nuevo': { label: 'Pacientes', to: '/inicio/pacientes' },
  '/inicio/terapeutas/nuevo': { label: 'Terapeutas', to: '/inicio/terapeutas' },
};

export function Header() {
  const { pathname } = useLocation();
  const { theme, toggle } = useTheme();
  const pageLabel = ROUTE_LABELS[pathname] ?? 'Inicio';
  const parent = PARENT_ROUTES[pathname];

  return (
    <header className="dashboard-header">
      <nav className="dashboard-header__breadcrumb" aria-label="Ubicación actual">
        <span>SEAP</span>
        <span aria-hidden="true">›</span>
        {parent ? (
          <>
            <Link to={parent.to} className="crumb-link">
              {parent.label}
            </Link>
            <span aria-hidden="true">›</span>
          </>
        ) : null}
        <strong aria-current="page">{pageLabel}</strong>
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
