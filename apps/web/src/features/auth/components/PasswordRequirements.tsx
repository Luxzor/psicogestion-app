import type { FC } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';

interface PasswordRequirementsProps {
  password?: string;
  confirmPassword?: string;
}

const Requirement = ({ met, text }: { met: boolean; text: string }) => (
  <li className={`password-req ${met ? 'is-met' : ''}`}>
    <span aria-hidden="true" className="password-req-icon">
      {met ? <CheckCircle2 size={16} /> : <Circle size={16} />}
    </span>
    {text}
  </li>
);

export const PasswordRequirements: FC<PasswordRequirementsProps> = ({
  password = '',
  confirmPassword = '',
}) => {
  const hasMinLength = password.length >= 8;
  const hasNumber = /\d/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  if (!password && !confirmPassword) return null;

  return (
    <ul className="password-requirements" aria-label="Requisitos de contraseña">
      <Requirement met={hasMinLength} text="Mínimo 8 caracteres" />
      <Requirement met={hasUppercase} text="Al menos una letra mayúscula" />
      <Requirement met={hasNumber} text="Al menos un número" />
      <Requirement met={hasSpecial} text={'Al menos un carácter especial (!@#$%^&*(),.?":{}|<>)'} />
      <Requirement met={passwordsMatch} text="Las contraseñas coinciden" />
    </ul>
  );
};
