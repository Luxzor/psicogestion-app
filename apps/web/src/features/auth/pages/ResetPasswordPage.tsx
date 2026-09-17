import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../../auth/api';
import { AuthCard } from '../components/AuthCard';
import { FieldError, NoticeBox } from '../components/FormFeedback';
import { useFormFeedback } from '../hooks/useFormFeedback';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [token] = useState(() => params.get('token') ?? '');
  const { notice, fieldErrors, isSubmitting, run } = useFormFeedback();

  useEffect(() => {
    const tokenFromUrl = params.get('token');
    if (!tokenFromUrl) return;
    navigate('/restablecer', { replace: true });
  }, [navigate, params]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void run(
      () => api('/auth/restablecimiento', { method: 'POST', body: { ...values, token } }),
      () => navigate('/iniciar-sesion?aviso=contrasena-restablecida', { replace: true }),
    );
  }

  if (!token) {
    return (
      <AuthCard title="Enlace no válido">
        <p className="notice error">El enlace de recuperación no es válido.</p>
        <Link to="/recuperar">Solicitar un enlace nuevo</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Restablecer contraseña">
      <NoticeBox notice={notice} />
      <form onSubmit={submit} noValidate>
        <label>
          Nueva contraseña
          <input
            name="nueva_contrasena"
            type="password"
            minLength={8}
            maxLength={25}
            required
            autoComplete="new-password"
            aria-invalid={Boolean(fieldErrors.nueva_contrasena)}
            aria-describedby="new-password-error"
          />
          <FieldError id="new-password-error" message={fieldErrors.nueva_contrasena} />
        </label>
        <p className="help">
          De 8 a 25 caracteres, con una mayúscula, un número y un carácter especial.
        </p>
        <label>
          Confirmar contraseña
          <input
            name="confirmar_contrasena"
            type="password"
            minLength={8}
            maxLength={25}
            required
            autoComplete="new-password"
            aria-invalid={Boolean(fieldErrors.confirmar_contrasena)}
            aria-describedby="reset-confirmar-contrasena-error"
          />
          <FieldError
            id="reset-confirmar-contrasena-error"
            message={fieldErrors.confirmar_contrasena}
          />
        </label>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Actualizando…' : 'Actualizar contraseña'}
        </button>
      </form>
    </AuthCard>
  );
}
