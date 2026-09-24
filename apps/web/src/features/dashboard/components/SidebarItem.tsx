import { NavLink } from 'react-router-dom';

interface SidebarItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  collapsed?: boolean;
}

export function SidebarItem({ to, icon, label, badge, collapsed }: SidebarItemProps) {
  return (
    <li>
      <NavLink
        to={to}
        end={to === '/inicio'}
        title={collapsed ? label : undefined}
        className={({ isActive }) => `sidebar-item${isActive ? ' is-active' : ''}`}
      >
        <span className="sidebar-item__icon">{icon}</span>
        {!collapsed && <span className="sidebar-item__label">{label}</span>}
        {!collapsed && badge != null && badge > 0 && (
          <span className="sidebar-item__badge">{badge}</span>
        )}
      </NavLink>
    </li>
  );
}
