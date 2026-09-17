import { describe, expect, it } from 'vitest';
import { registerSchema } from '../src/modules/auth/schemas.js';

const validInput = {
  nombre_completo: 'Ana Pérez',
  telefono: '9991234567',
  correo_institucional: 'ana@uady.mx',
  contrasena: 'ClaveSegura1!',
  confirmar_contrasena: 'ClaveSegura1!',
  consentimiento: true,
};

describe('validación de registro', () => {
  it('acepta una cuenta institucional con contraseña segura', () => {
    expect(registerSchema.safeParse(validInput).success).toBe(true);
  });

  it('rechaza contraseñas que no cumplen la política de la ERS', () => {
    expect(
      registerSchema.safeParse({
        ...validInput,
        contrasena: 'clavesinsegura',
        confirmar_contrasena: 'clavesinsegura',
      }).success,
    ).toBe(false);
  });

  it('rechaza correos no institucionales y teléfonos distintos de diez dígitos', () => {
    expect(
      registerSchema.safeParse({ ...validInput, correo_institucional: 'ana@gmail.com' }).success,
    ).toBe(false);
    expect(registerSchema.safeParse({ ...validInput, telefono: '999123' }).success).toBe(false);
  });

  it('explica en español el límite máximo del nombre completo', () => {
    const result = registerSchema.safeParse({
      ...validInput,
      nombre_completo: 'A'.repeat(51),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe(
      'El nombre completo debe tener máximo 50 caracteres.',
    );
  });
});
