import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../auth/api';
import { AuthActions, SubmitButton } from '../components/AuthActions';
import { AuthCard } from '../components/AuthCard';
import { AuthField } from '../components/AuthField';
import { NoticeBox } from '../components/FormFeedback';
import { useFormFeedback } from '../hooks/useFormFeedback';

export function RecoveryPage() {
  const { notice, setNotice, fieldErrors, isSubmitting, run } = useFormFeedback();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void run(
      () => api<{ mensaje: string }>('/auth/recuperacion', { method: 'POST', body: values }),
      (result) => setNotice({ type: 'success', text: result.mensaje }),
    );
  }

  return (
    <AuthCard
      title="Recuperar cuenta"
      subtitle="Te enviaremos un enlace de un solo uso que vence en 10 minutos."
    >
      <NoticeBox notice={notice} />
      <form className="auth-form" onSubmit={submit} noValidate>
        <AuthField
          label="Correo institucional"
          name="correo_institucional"
          type="email"
          required
          autoComplete="email"
          error={fieldErrors.correo_institucional}
          errorId="recovery-correo-error"
        />
        <SubmitButton busy={isSubmitting}>
          {isSubmitting ? 'Enviando...' : 'Enviar enlace'}
        </SubmitButton>
      </form>
      <AuthActions>
        <Link to="/iniciar-sesion">Volver al inicio de sesión</Link>
      </AuthActions>
    </AuthCard>
  );
}
