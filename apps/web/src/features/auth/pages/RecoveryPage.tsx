import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../auth/api';
import { AuthCard } from '../components/AuthCard';
import { FieldError, NoticeBox } from '../components/FormFeedback';
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
    <AuthCard title="Recuperar cuenta">
      <p>Te enviaremos un enlace de un solo uso que vence en 10 minutos.</p>
      <NoticeBox notice={notice} />
      <form onSubmit={submit} noValidate>
        <label>
          Correo institucional
          <input
            name="correo_institucional"
            type="email"
            required
            autoComplete="email"
            aria-invalid={Boolean(fieldErrors.correo_institucional)}
            aria-describedby="recovery-correo-error"
          />
          <FieldError id="recovery-correo-error" message={fieldErrors.correo_institucional} />
        </label>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Enviando…' : 'Enviar enlace'}
        </button>
      </form>
      <p className="link-line">
        <Link to="/iniciar-sesion">Volver al inicio de sesión</Link>
      </p>
    </AuthCard>
  );
}
