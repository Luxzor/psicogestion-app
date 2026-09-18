import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../../auth/api';
import { AuthActions, SubmitButton } from '../components/AuthActions';
import { AuthCard } from '../components/AuthCard';
import { AuthField } from '../components/AuthField';
import { NoticeBox } from '../components/FormFeedback';
import { useFormFeedback } from '../hooks/useFormFeedback';

type VerifyNavigationState = { correo?: string };

export function VerifyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const email =
    typeof (location.state as VerifyNavigationState | null)?.correo === 'string'
      ? (location.state as VerifyNavigationState).correo
      : '';
  const { notice, setNotice, fieldErrors, isSubmitting, run } = useFormFeedback();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void run(
      () => api('/auth/verificacion', { method: 'POST', body: values }),
      () => navigate('/iniciar-sesion?aviso=cuenta-verificada', { replace: true }),
    );
  }

  function resend() {
    void run(
      () =>
        api('/auth/verificacion/reenviar', {
          method: 'POST',
          body: { correo_institucional: email },
        }),
      () =>
        setNotice({
          type: 'success',
          text: 'Si la cuenta está pendiente, enviamos un nuevo código.',
        }),
    );
  }

  return (
    <AuthCard
      title="Verifica tu correo"
      subtitle="Ingresa el código de seis dígitos enviado a tu correo institucional."
    >
      <NoticeBox notice={notice} />
      <form className="auth-form" onSubmit={submit} noValidate>
        <AuthField
          label="Correo institucional"
          name="correo_institucional"
          type="email"
          defaultValue={email}
          required
          error={fieldErrors.correo_institucional}
          errorId="verify-correo-error"
        />
        <AuthField
          label="Código de verificación"
          name="codigo"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoComplete="one-time-code"
          error={fieldErrors.codigo}
          errorId="codigo-error"
        />
        <SubmitButton busy={isSubmitting}>
          {isSubmitting ? 'Verificando...' : 'Verificar cuenta'}
        </SubmitButton>
      </form>
      <button
        className="text-button"
        type="button"
        onClick={resend}
        disabled={!email || isSubmitting}
      >
        Reenviar código
      </button>
      <AuthActions>
        <Link to="/registro">Corregir correo o crear otra cuenta</Link>
      </AuthActions>
    </AuthCard>
  );
}
