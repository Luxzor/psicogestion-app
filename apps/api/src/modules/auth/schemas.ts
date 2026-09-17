import { z } from 'zod';

const institutionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._%+-]+@([a-z0-9-]+\.)?uady\.mx$/i, 'Usa un correo institucional UADY válido.');

export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .max(25, 'La contraseña debe tener máximo 25 caracteres.')
  .regex(/[A-Z]/, 'La contraseña debe incluir una mayúscula.')
  .regex(/[0-9]/, 'La contraseña debe incluir un número.')
  .regex(/[^A-Za-z0-9]/, 'La contraseña debe incluir un carácter especial.');

export const registerSchema = z
  .object({
    nombre_completo: z
      .string()
      .trim()
      .min(1, 'El nombre completo es obligatorio.')
      .max(50, 'El nombre completo debe tener máximo 50 caracteres.'),
    telefono: z
      .string()
      .trim()
      .regex(/^\d{10}$/, 'El teléfono debe tener 10 dígitos.'),
    correo_institucional: institutionalEmail,
    contrasena: passwordSchema,
    confirmar_contrasena: z.string(),
    consentimiento: z.literal(true, { error: 'Debes confirmar que eres titular del correo.' }),
  })
  .refine((data) => data.contrasena === data.confirmar_contrasena, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmar_contrasena'],
  });

export const verificationSchema = z.object({
  correo_institucional: institutionalEmail,
  codigo: z.string().regex(/^\d{6}$/, 'El código debe tener 6 dígitos.'),
});

export const emailSchema = z.object({ correo_institucional: institutionalEmail });

export const loginSchema = z.object({
  identificador: z.string().trim().min(1, 'Ingresa tu correo institucional o teléfono.'),
  contrasena: z.string().min(1, 'Ingresa tu contraseña.'),
});

export const resetSchema = z
  .object({
    token: z.string().min(20, 'El enlace de recuperación no es válido.'),
    nueva_contrasena: passwordSchema,
    confirmar_contrasena: z.string(),
  })
  .refine((data) => data.nueva_contrasena === data.confirmar_contrasena, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmar_contrasena'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
