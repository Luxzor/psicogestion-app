import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
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
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const { hasUnsavedChanges } = useUnsavedChanges();

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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
        {!isOnline && (
          <div
            className="notice warning notice--block"
            style={{ margin: '0.6rem 1.2rem 0', borderRadius: '10px' }}
            role="status"
          >
            <WifiOff size={16} aria-hidden="true" />
            <div className="notice__body">
              <strong>Sin conexión a la red.</strong> Si estás en una red escolar o pública,
              asegúrate de haber completado el inicio de sesión en su portal para poder guardar
              cambios.
            </div>
          </div>
        )}
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
