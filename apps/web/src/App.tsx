import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './auth/api';
import { HomePage } from './features/auth/pages/HomePage';
import { LoginPage } from './features/auth/pages/LoginPage';
import { RecoveryPage } from './features/auth/pages/RecoveryPage';
import { RegisterPage } from './features/auth/pages/RegisterPage';
import { ResetPasswordPage } from './features/auth/pages/ResetPasswordPage';
import { VerifyPage } from './features/auth/pages/VerifyPage';
import type { Session } from './features/auth/types';

function Protected({
  session,
  onLogout,
}: {
  session: Session | null;
  onLogout: () => Promise<void>;
}) {
  return session ? (
    <HomePage session={session} onLogout={onLogout} />
  ) : (
    <Navigate to="/iniciar-sesion" replace />
  );
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
    } finally {
      setSession(null);
      navigate('/iniciar-sesion');
    }
  };

  return (
    <Routes>
      <Route path="/registro" element={<RegisterPage />} />
      <Route path="/verificar" element={<VerifyPage />} />
      <Route path="/iniciar-sesion" element={<LoginPage onLogin={setSession} />} />
      <Route path="/recuperar" element={<RecoveryPage />} />
      <Route path="/restablecer" element={<ResetPasswordPage />} />
      <Route path="/inicio" element={<Protected session={session} onLogout={logout} />} />
      <Route path="*" element={<Navigate to={session ? '/inicio' : '/iniciar-sesion'} replace />} />
    </Routes>
  );
}
