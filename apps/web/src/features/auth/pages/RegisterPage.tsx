import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../auth/api';
import { AuthCard } from '../components/AuthCard';
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
    <AuthCard title="Crear cuenta">
      <p>Regístrate con tu correo institucional UADY.</p>
      <NoticeBox notice={notice} />
      <form onSubmit={submit} noValidate>
        <label>
          Nombre completo
          <input
            name="nombre_completo"
            maxLength={50}
            required
            autoComplete="name"
            aria-invalid={Boolean(fieldErrors.nombre_completo)}
            aria-describedby="nombre-completo-error"
          />
          <FieldError id="nombre-completo-error" message={fieldErrors.nombre_completo} />
        </label>
        <label>
          Teléfono (10 dígitos)
          <input
            name="telefono"
            inputMode="numeric"
            pattern="[0-9]{10}"
            maxLength={10}
            required
            autoComplete="tel"
            aria-invalid={Boolean(fieldErrors.telefono)}
            aria-describedby="telefono-error"
          />
          <FieldError id="telefono-error" message={fieldErrors.telefono} />
        </label>
        <label>
          Correo institucional UADY
          <input
            name="correo_institucional"
            type="email"
            required
            autoComplete="email"
            aria-invalid={Boolean(fieldErrors.correo_institucional)}
            aria-describedby="correo-error"
          />
          <FieldError id="correo-error" message={fieldErrors.correo_institucional} />
        </label>
        <label>
          Contraseña
          <input
            name="contrasena"
            type="password"
            minLength={8}
            maxLength={25}
            required
            autoComplete="new-password"
            aria-invalid={Boolean(fieldErrors.contrasena)}
            aria-describedby="contrasena-error"
          />
          <FieldError id="contrasena-error" message={fieldErrors.contrasena} />
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
            aria-describedby="confirmar-contrasena-error"
          />
          <FieldError id="confirmar-contrasena-error" message={fieldErrors.confirmar_contrasena} />
        </label>
        <label className="checkbox">
          <input name="consentimiento" type="checkbox" required /> Confirmo que soy titular de este
          correo y acepto el aviso de privacidad.
        </label>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
      </form>
      <p className="link-line">
        ¿Ya tienes cuenta? <Link to="/iniciar-sesion">Inicia sesión</Link>
      </p>
    </AuthCard>
  );
}
