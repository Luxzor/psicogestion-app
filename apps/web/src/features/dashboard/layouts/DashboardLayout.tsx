import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../../auth/components/ConfirmDialog';
import type { Session } from '../../auth/types';
import '../styles/dashboard.css';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { AlertDialog } from '../../../components/AlertDialog';
import { IdleWarningDialog } from '../../../components/IdleWarningDialog';
import { useUnsavedChanges } from '../../../contexts/UnsavedChangesContext';
import { useIdleTimer } from '../../../hooks/useIdleTimer';

interface DashboardLayoutProps {
  session: Session;
  onLogout: () => Promise<void>;
  onIdleTimeout?: () => void;
}

export function DashboardLayout({ session, onLogout, onIdleTimeout }: DashboardLayoutProps) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const { hasUnsavedChanges } = useUnsavedChanges();

  const handleIdleTimeout = () => {
    if (onIdleTimeout) {
      onIdleTimeout();
    } else {
      void onLogout().finally(() => {
        navigate('/iniciar-sesion?aviso=inactividad', { replace: true });
      });
    }
  };

  const { showWarning, remainingSeconds, stayActive } = useIdleTimer({
    enabled: Boolean(session),
    onTimeout: handleIdleTimeout,
  });

  const handleLogoutClick = () => {
    if (hasUnsavedChanges) {
      setShowAlert(true);
    } else {
      setConfirming(true);
    }
  };

  return (
    <div className={`dashboard${collapsed ? ' is-collapsed' : ''}`}>
      <Sidebar
        session={session}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        onLogout={handleLogoutClick}
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

      {showAlert && (
        <AlertDialog
          title="Acción pendiente"
          description="Tienes cambios sin guardar. Por favor termina o descarta la acción actual para poder cerrar sesión."
          onClose={() => setShowAlert(false)}
        />
      )}

      {showWarning && (
        <IdleWarningDialog remainingSeconds={remainingSeconds} onStayActive={stayActive} />
      )}
    </div>
  );
}
