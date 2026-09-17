import type { FormEvent } from 'react';
import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../../auth/api';
import { AuthCard } from '../components/AuthCard';
import { FieldError, NoticeBox } from '../components/FormFeedback';
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
    <AuthCard title="Iniciar sesión">
      <p>Accede con tu correo institucional o teléfono y contraseña.</p>
      <NoticeBox notice={notice} />
      <form onSubmit={submit} noValidate>
        <label>
          Correo institucional o teléfono
          <input
            name="identificador"
            required
            autoComplete="username"
            aria-invalid={Boolean(fieldErrors.identificador)}
            aria-describedby="identificador-error"
          />
          <FieldError id="identificador-error" message={fieldErrors.identificador} />
        </label>
        <label>
          Contraseña
          <input
            name="contrasena"
            type="password"
            required
            autoComplete="current-password"
            aria-invalid={Boolean(fieldErrors.contrasena)}
            aria-describedby="login-contrasena-error"
          />
          <FieldError id="login-contrasena-error" message={fieldErrors.contrasena} />
        </label>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Ingresando…' : 'Entrar'}
        </button>
      </form>
      <p className="link-line">
        <Link to="/recuperar">¿Olvidaste tu contraseña?</Link> ·{' '}
        <Link to="/registro">Crear cuenta</Link>
      </p>
    </AuthCard>
  );
}
