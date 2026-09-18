import type { InputHTMLAttributes, ReactNode } from 'react';
import { FieldError } from './FormFeedback';

type AuthFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  errorId: string;
  hint?: ReactNode;
};

export function AuthField({ label, error, errorId, hint, ...inputProps }: AuthFieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...inputProps} aria-invalid={Boolean(error)} aria-describedby={errorId} />
      {hint ? <span className="field-hint">{hint}</span> : null}
      <FieldError id={errorId} message={error} />
    </label>
  );
}
