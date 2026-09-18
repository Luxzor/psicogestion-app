import type { FormEvent } from 'react';
import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../../auth/api';
import { AuthActions, SubmitButton } from '../components/AuthActions';
import { AuthCard } from '../components/AuthCard';
import { AuthField } from '../components/AuthField';
import { NoticeBox } from '../components/FormFeedback';
import { useFormFeedback } from '../hooks/useFormFeedback';
import type { Notice, Session } from '../types';

const notices: Record<string, Notice> = {
  'cuenta-verificada': { type: 'success', text: 'Cuenta verificada. Ya puedes iniciar sesión.' },
  'contrasena-restablecida': {
    type: 'success',
    text: 'Tu contraseña fue actualizada. Ya puedes iniciar sesión.',
  },
};

export function LoginPage({ onLogin }: { onLogin: (session: Session) => void }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { notice, setNotice, fieldErrors, isSubmitting, run } = useFormFeedback();
  const navigationNotice = notices[params.get('aviso') ?? ''] ?? null;

  useEffect(() => {
    if (!navigationNotice) return;
    setNotice(navigationNotice);
    setParams({}, { replace: true });
  }, [navigationNotice, setNotice, setParams]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void run(
      () =>
        api<{
          access_token: string;
          usuario: { nombre_completo: string; rol: string };
        }>('/auth/login', { method: 'POST', body: values }),
      (result) => {
        onLogin({ token: result.access_token, user: result.usuario });
        navigate('/inicio');
      },
    );
  }

  return (
    <AuthCard
      title="Iniciar sesión"
      subtitle="Accede con tu correo institucional o teléfono y contraseña."
    >
      <NoticeBox notice={notice} />
      <form className="auth-form" onSubmit={submit} noValidate>
        <AuthField
          label="Correo institucional o teléfono"
          name="identificador"
          required
          autoComplete="username"
          error={fieldErrors.identificador}
          errorId="identificador-error"
        />
        <AuthField
          label="Contraseña"
          name="contrasena"
          type="password"
          required
          autoComplete="current-password"
          error={fieldErrors.contrasena}
          errorId="login-contrasena-error"
        />
        <SubmitButton busy={isSubmitting}>{isSubmitting ? 'Ingresando...' : 'Entrar'}</SubmitButton>
      </form>
      <AuthActions>
        <Link to="/recuperar">Olvidé mi contraseña</Link>
        <Link to="/registro">Crear cuenta</Link>
      </AuthActions>
    </AuthCard>
  );
}
