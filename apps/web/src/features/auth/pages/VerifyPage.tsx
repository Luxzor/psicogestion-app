import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../../auth/api';
import { AuthCard } from '../components/AuthCard';
import { FieldError, NoticeBox } from '../components/FormFeedback';
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
    <AuthCard title="Verifica tu correo">
      <p>Ingresa el código de seis dígitos enviado a tu correo institucional.</p>
      <NoticeBox notice={notice} />
      <form onSubmit={submit} noValidate>
        <label>
          Correo institucional
          <input
            name="correo_institucional"
            type="email"
            defaultValue={email}
            required
            aria-invalid={Boolean(fieldErrors.correo_institucional)}
            aria-describedby="verify-correo-error"
          />
          <FieldError id="verify-correo-error" message={fieldErrors.correo_institucional} />
        </label>
        <label>
          Código de verificación
          <input
            name="codigo"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoComplete="one-time-code"
            aria-invalid={Boolean(fieldErrors.codigo)}
            aria-describedby="codigo-error"
          />
          <FieldError id="codigo-error" message={fieldErrors.codigo} />
        </label>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Verificando…' : 'Verificar cuenta'}
        </button>
      </form>
      <button
        className="link-button"
        type="button"
        onClick={resend}
        disabled={!email || isSubmitting}
      >
        Reenviar código
      </button>
      <p className="link-line">
        <Link to="/registro">Corregir correo o crear otra cuenta</Link>
      </p>
    </AuthCard>
  );
}
