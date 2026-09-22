import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../auth/api';
import { AuthActions, SubmitButton } from '../components/AuthActions';
import { AuthCard } from '../components/AuthCard';
import { AuthField } from '../components/AuthField';
import { FieldError, NoticeBox } from '../components/FormFeedback';
import { PasswordRequirements } from '../components/PasswordRequirements';
import { useFormFeedback } from '../hooks/useFormFeedback';

const steps = [
  { id: 'datos', label: 'Datos' },
  { id: 'acceso', label: 'Acceso' },
  { id: 'confirmacion', label: 'Confirmación' },
] as const;

export function RegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
      <ol className="stepper" aria-label="Progreso de registro">
        {steps.map((item, index) => (
          <li className={index === step ? 'is-active' : ''} key={item.id}>
            <span>{index + 1}</span>
            {item.label}
          </li>
        ))}
      </ol>
      <form className="auth-form" onSubmit={submit} noValidate>
        <section className="register-step" hidden={step !== 0}>
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
        </section>

        <section className="register-step" hidden={step !== 1}>
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
            errorId="confirmar-contrasena-error"
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <PasswordRequirements password={password} confirmPassword={confirmPassword} />
        </section>

        <section className="register-step" hidden={step !== 2}>
          <p className="step-note">
            Te enviaremos un código de verificación al correo institucional registrado.
          </p>
          <label className="checkbox">
            <input name="consentimiento" type="checkbox" required /> Confirmo que soy titular de
            este correo y acepto el aviso de privacidad.
          </label>
          <FieldError id="consentimiento-error" message={fieldErrors.consentimiento} />
        </section>

        <div className={`form-navigation ${step === 0 ? 'is-single' : ''}`}>
          {step > 0 ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setStep(step - 1)}
            >
              Atrás
            </button>
          ) : (
            <span />
          )}
          {step < steps.length - 1 ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => setStep(step + 1)}
            >
              Siguiente
            </button>
          ) : (
            <SubmitButton busy={isSubmitting}>
              {isSubmitting ? 'Creando cuenta...' : 'Crear cuenta'}
            </SubmitButton>
          )}
        </div>
      </form>
      <AuthActions>
        <span>¿Ya tienes cuenta?</span>
        <Link to="/iniciar-sesion">Inicia sesión</Link>
      </AuthActions>
    </AuthCard>
  );
}
