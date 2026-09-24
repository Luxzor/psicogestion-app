import {
  CalendarDays,
  ClipboardList,
  DoorOpen,
  Home,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
  UserSquare2,
} from 'lucide-react';
import type { Session } from '../../auth/types';
import { SidebarItem } from './SidebarItem';
import { useTheme } from '../hooks/useTheme';

import logoHeadLight from '../../../../assets/logo_head_light.png';
import logoHeadDark from '../../../../assets/logo_head_dark.png';
import logoSeapLight from '../../../../assets/PsicoGestión_light.png';
import logoSeapDark from '../../../../assets/PsicoGestión_dark.png';

interface SidebarProps {
  session: Session;
  collapsed: boolean;
  onToggle: () => void;
  onLogout: () => void;
}

function initials(name?: string) {
  if (!name) return 'U';
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function Sidebar({ session, collapsed, onToggle, onLogout }: SidebarProps) {
  const nombre = session.user?.nombre_completo;
  const c = collapsed;
  const { theme } = useTheme();

  const logoHead = theme === 'dark' ? logoHeadDark : logoHeadLight;
  const logoText = theme === 'dark' ? logoSeapDark : logoSeapLight;

  return (
    <aside className={`sidebar${c ? ' is-collapsed' : ''}`}>
      {/* Brand + collapse toggle */}
      <div className="sidebar__brand">
        {!c && (
          <>
            <img src={logoHead} alt="Logo" className="sidebar__logo-img" />
            <img src={logoText} alt="PsicoGestión" className="sidebar__text-img" />
          </>
        )}
        <button
          type="button"
          className="sidebar__collapse-btn"
          onClick={onToggle}
          aria-label={c ? 'Expandir menú' : 'Colapsar menú'}
        >
          {c ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* Main nav */}
      <div className="sidebar__section">
        {!c && <p className="sidebar__section-label">Menú principal</p>}
        <ul className="sidebar__nav">
          <SidebarItem collapsed={c} to="/inicio" icon={<Home size={18} />} label="Inicio" />
          <SidebarItem
            collapsed={c}
            to="/inicio/agenda"
            icon={<CalendarDays size={18} />}
            label="Agenda"
          />
          <SidebarItem
            collapsed={c}
            to="/inicio/citas"
            icon={<ClipboardList size={18} />}
            label="Citas"
          />
          <SidebarItem
            collapsed={c}
            to="/inicio/pacientes"
            icon={<Users size={18} />}
            label="Pacientes"
          />
          <SidebarItem
            collapsed={c}
            to="/inicio/terapeutas"
            icon={<UserSquare2 size={18} />}
            label="Terapeutas"
          />
          <SidebarItem
            collapsed={c}
            to="/inicio/salas"
            icon={<DoorOpen size={18} />}
            label="Salas"
          />
        </ul>
      </div>

      {/* Sistema */}
      <div className="sidebar__section">
        {!c && <p className="sidebar__section-label">Sistema</p>}
        <ul className="sidebar__nav">
          <SidebarItem
            collapsed={c}
            to="/inicio/configuracion"
            icon={<Settings size={18} />}
            label="Configuración"
          />
        </ul>
      </div>

      {/* Account */}
      <div className="sidebar__footer">
        {!c && (
          <p className="sidebar__section-label" style={{ padding: '0 0.45rem 0.4rem' }}>
            Cuenta
          </p>
        )}
        <div className="sidebar__user">
          <div className="sidebar__avatar" title={c ? (nombre ?? 'Usuario') : undefined}>
            {initials(nombre)}
          </div>
          {!c && (
            <div className="sidebar__user-info">
              <div className="sidebar__user-name">{nombre ?? 'Usuario'}</div>
              <div className="sidebar__user-role">Personal clínico</div>
            </div>
          )}
        </div>
        <button
          type="button"
          className="sidebar-item"
          title={c ? 'Cerrar sesión' : undefined}
          style={{ justifyContent: c ? 'center' : undefined, marginTop: '0.2rem' }}
          onClick={onLogout}
        >
          <span className="sidebar-item__icon">
            <LogOut size={18} />
          </span>
          {!c && <span className="sidebar-item__label">Cerrar sesión</span>}
        </button>
      </div>
    </aside>
  );
}
