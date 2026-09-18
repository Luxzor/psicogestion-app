import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../auth/api';
import { AuthActions, SubmitButton } from '../components/AuthActions';
import { AuthCard } from '../components/AuthCard';
import { AuthField } from '../components/AuthField';
import { FieldError, NoticeBox } from '../components/FormFeedback';
import { useFormFeedback } from '../hooks/useFormFeedback';

export function RegisterPage() {
  const navigate = useNavigate();
  const { notice, fieldErrors, isSubmitting, run } = useFormFeedback();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void run(
      () =>
        api('/auth/registro', {
          method: 'POST',
          body: { ...values, consentimiento: values.consentimiento === 'on' },
        }),
      () => navigate('/verificar', { state: { correo: String(values.correo_institucional) } }),
    );
  }

  return (
    <AuthCard title="Crear cuenta" subtitle="Regístrate con tu correo institucional UADY.">
      <NoticeBox notice={notice} />
      <form className="auth-form" onSubmit={submit} noValidate>
        <AuthField
          label="Nombre completo"
          name="nombre_completo"
          maxLength={50}
          required
          autoComplete="name"
          error={fieldErrors.nombre_completo}
          errorId="nombre-completo-error"
        />
        <AuthField
          label="Teléfono (10 dígitos)"
          name="telefono"
          inputMode="numeric"
          pattern="[0-9]{10}"
          maxLength={10}
          required
          autoComplete="tel"
          error={fieldErrors.telefono}
          errorId="telefono-error"
        />
        <AuthField
          label="Correo institucional UADY"
          name="correo_institucional"
          type="email"
          required
          autoComplete="email"
          error={fieldErrors.correo_institucional}
          errorId="correo-error"
        />
        <AuthField
          label="Contraseña"
          name="contrasena"
          type="password"
          minLength={8}
          maxLength={25}
          required
          autoComplete="new-password"
          error={fieldErrors.contrasena}
          errorId="contrasena-error"
          hint="De 8 a 25 caracteres, con mayúscula, número y carácter especial."
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
          errorId="confirmar-contrasena-error"
        />
        <label className="checkbox">
          <input name="consentimiento" type="checkbox" required /> Confirmo que soy titular de este
          correo y acepto el aviso de privacidad.
        </label>
        <FieldError id="consentimiento-error" message={fieldErrors.consentimiento} />
        <SubmitButton busy={isSubmitting}>
          {isSubmitting ? 'Creando cuenta...' : 'Crear cuenta'}
        </SubmitButton>
      </form>
      <AuthActions>
        <span>¿Ya tienes cuenta?</span>
        <Link to="/iniciar-sesion">Inicia sesión</Link>
      </AuthActions>
    </AuthCard>
  );
}
