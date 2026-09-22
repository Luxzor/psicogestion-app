import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { ConfirmDialog } from '../../auth/components/ConfirmDialog';
import type { Session } from '../../auth/types';
import '../styles/dashboard.css';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';

interface DashboardLayoutProps {
  session: Session;
  onLogout: () => Promise<void>;
}

export function DashboardLayout({ session, onLogout }: DashboardLayoutProps) {
  const [confirming, setConfirming] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`dashboard${collapsed ? ' is-collapsed' : ''}`}>
      <Sidebar
        session={session}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        onLogout={() => setConfirming(true)}
      />

      <div className="dashboard__main">
        <Header />
        <main className="dashboard__content">
          <Outlet />
        </main>
      </div>

      {confirming && (
        <ConfirmDialog
          title="¿Cerrar sesión?"
          description="Se eliminarán los datos de esta sesión en este equipo."
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void onLogout();
          }}
        />
      )}
    </div>
  );
}
