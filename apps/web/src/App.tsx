import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './auth/api';
import { LoginPage } from './features/auth/pages/LoginPage';
import { RecoveryPage } from './features/auth/pages/RecoveryPage';
import { RegisterPage } from './features/auth/pages/RegisterPage';
import { ResetPasswordPage } from './features/auth/pages/ResetPasswordPage';
import { VerifyPage } from './features/auth/pages/VerifyPage';
import type { Session } from './features/auth/types';
import { AgendaPage } from './features/agenda/pages/AgendaPage';
import { CitasPage } from './features/citas/pages/CitasPage';
import { ConfiguracionPage } from './features/configuracion/pages/ConfiguracionPage';
import { DashboardHomePage } from './features/dashboard/pages/DashboardHomePage';
import { DashboardLayout } from './features/dashboard/layouts/DashboardLayout';
import { PacientesPage } from './features/pacientes/pages/PacientesPage';
import { SalasPage } from './features/salas/pages/SalasPage';
import { TerapeutasPage } from './features/terapeutas/pages/TerapeutasPage';

function ProtectedLayout({
  session,
  onLogout,
}: {
  session: Session | null;
  onLogout: () => Promise<void>;
}) {
  if (!session) return <Navigate to="/iniciar-sesion" replace />;
  return <DashboardLayout session={session} onLogout={onLogout} />;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof fetch !== 'function') return;
    const controller = new AbortController();
    void api<{ access_token: string }>('/auth/refresh', {
      method: 'POST',
      signal: controller.signal,
    })
      .then((result) => setSession({ token: result.access_token }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, []);

  const logout = async () => {
    if (!session) return;
    try {
      await api('/auth/sesion', { method: 'DELETE', accessToken: session.token });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setSession(null);
      navigate('/iniciar-sesion');
    }
  };

  return (
    <Routes>
      {/* Auth */}
      <Route path="/registro" element={<RegisterPage />} />
      <Route path="/verificar" element={<VerifyPage />} />
      <Route path="/iniciar-sesion" element={<LoginPage onLogin={setSession} />} />
      <Route path="/recuperar" element={<RecoveryPage />} />
      <Route path="/restablecer" element={<ResetPasswordPage />} />

      {/* Dashboard */}
      <Route path="/inicio" element={<ProtectedLayout session={session} onLogout={logout} />}>
        <Route index element={<DashboardHomePage session={session!} />} />
        <Route path="agenda" element={<AgendaPage />} />
        <Route path="citas" element={<CitasPage />} />
        <Route path="pacientes" element={<PacientesPage />} />
        <Route path="terapeutas" element={<TerapeutasPage />} />
        <Route path="salas" element={<SalasPage />} />
        <Route path="configuracion" element={<ConfiguracionPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to={session ? '/inicio' : '/iniciar-sesion'} replace />} />
    </Routes>
  );
}
