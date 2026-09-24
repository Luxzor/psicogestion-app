import type { InputHTMLAttributes, ReactNode } from 'react';
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { FieldError } from './FormFeedback';

type AuthFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  errorId: string;
  hint?: ReactNode;
};

export function AuthField({ label, error, errorId, hint, type, ...inputProps }: AuthFieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const currentType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <label className="field">
      <span>{label}</span>
      <div className="field-input-wrapper">
        <input
          type={currentType}
          {...inputProps}
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
        />
        {isPassword && (
          <button
            type="button"
            className="field-toggle-password"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
      {hint ? <span className="field-hint">{hint}</span> : null}
      <FieldError id={errorId} message={error} />
    </label>
  );
}
