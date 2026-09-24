import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../../auth/api';
import { SubmitButton } from '../components/AuthActions';
import { AuthCard } from '../components/AuthCard';
import { AuthField } from '../components/AuthField';
import { NoticeBox } from '../components/FormFeedback';
import { PasswordRequirements } from '../components/PasswordRequirements';
import { useFormFeedback } from '../hooks/useFormFeedback';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [token] = useState(() => params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { notice, fieldErrors, isSubmitting, run } = useFormFeedback();

  useEffect(() => {
    const tokenFromUrl = params.get('token');
    if (!tokenFromUrl) return;
    
    // Validate token immediately on load
    api<{ valid: boolean }>(`/auth/restablecimiento/verificar?token=${tokenFromUrl}`)
      .then((res) => {
        if (!res.valid) {
          navigate('/iniciar-sesion?aviso=enlace-expirado', { replace: true });
        }
      })
      .catch(() => {
        navigate('/iniciar-sesion?aviso=enlace-expirado', { replace: true });
      });
  }, [navigate, params]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void run(
      async () => {
        try {
          await api('/auth/restablecimiento', { method: 'POST', body: { ...values, token } });
        } catch (error) {
          if (error && typeof error === 'object' && 'codigo' in error && error.codigo === 'ENLACE_EXPIRADO') {
            navigate('/iniciar-sesion?aviso=enlace-expirado', { replace: true });
            return;
          }
          throw error;
        }
      },
      () => navigate('/iniciar-sesion?aviso=contrasena-restablecida', { replace: true }),
    );
  }

  if (!token) {
    return (
      <AuthCard title="Enlace no válido" subtitle="Solicita un nuevo enlace de recuperación.">
        <p className="notice error">El enlace de recuperación no es válido.</p>
        <Link to="/recuperar">Solicitar un enlace nuevo</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Restablecer contraseña" subtitle="Define una nueva contraseña segura.">
      <NoticeBox notice={notice} />
      <form className="auth-form" onSubmit={submit} noValidate>
        <AuthField
          label="Nueva contraseña"
          name="nueva_contrasena"
          type="password"
          minLength={8}
          maxLength={25}
          required
          autoComplete="new-password"
          error={fieldErrors.nueva_contrasena}
          errorId="new-password-error"
          onChange={(e) => setPassword(e.target.value)}
        />
        <AuthField
          label="Confirmar contraseña"
          name="confirmar_contrasena"
          type="password"
          minLength={8}
          maxLength={25}
          required
          autoComplete="new-password"
          error={fieldErrors.confirmar_contrasena}
          errorId="reset-confirmar-contrasena-error"
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        <PasswordRequirements password={password} confirmPassword={confirmPassword} />
        <SubmitButton busy={isSubmitting}>
          {isSubmitting ? 'Actualizando...' : 'Actualizar contraseña'}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
