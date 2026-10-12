import { z } from 'zod';
import { parseIsoDate, todayInClinic } from '../../platform/clock.js';

export const PHONE_PATTERN = /^\d{10}$/;
export const CEDULA_PATTERN = /^\d{7,8}$/;
export const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
export const NAME_MAX = 50;

const nombre = z
  .string({ error: 'Escribe el nombre completo.' })
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Escribe el nombre completo.')
      .max(NAME_MAX, 'El nombre no puede tener más de 50 caracteres.'),
  );

const telefono = z
  .string({ error: 'Escribe el teléfono.' })
  .trim()
  .min(1, 'Escribe el teléfono.')
  .regex(PHONE_PATTERN, 'El teléfono debe tener exactamente 10 dígitos.');

const correo = z
  .string({ error: 'Escribe el correo electrónico.' })
  .trim()
  .min(1, 'Escribe el correo electrónico.')
  .max(100, 'El correo no puede tener más de 100 caracteres.')
  .transform((value) => value.toLowerCase())
  .pipe(
    z
      .string()
      .regex(EMAIL_PATTERN, 'Escribe un correo con formato válido, por ejemplo nombre@dominio.mx.'),
  );

const cedula = z
  .string({ error: 'Escribe la cédula profesional.' })
  .trim()
  .min(1, 'Escribe la cédula profesional.')
  .regex(CEDULA_PATTERN, 'La cédula debe tener 7 u 8 dígitos.');

const fechaNacimiento = (registrationDate: () => string) =>
  z
    .string({ error: 'Escribe la fecha de nacimiento.' })
    .trim()
    .min(1, 'Escribe la fecha de nacimiento.')
    .superRefine((value, context) => {
      const parsed = parseIsoDate(value);
      if (!parsed) {
        context.addIssue({
          code: 'custom',
          message: /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? 'Esa fecha no existe en el calendario.'
            : 'Escribe la fecha como dd/mm/aaaa.',
        });
        return;
      }
      if (parsed.year < 1900) {
        context.addIssue({ code: 'custom', message: 'Esa fecha no existe en el calendario.' });
        return;
      }
      const today = registrationDate();
      if (value >= today) {
        context.addIssue({
          code: 'custom',
          message: 'La fecha de nacimiento debe ser anterior a hoy.',
        });
      }
    });

export const createTherapistSchema = (registrationDate: () => string = () => todayInClinic()) =>
  z.preprocess(
    (raw) => {
      if (typeof raw === 'object' && raw !== null) {
        const obj = { ...(raw as Record<string, unknown>) };
        if (obj.correo_electronico === undefined && obj.correo !== undefined) {
          obj.correo_electronico = obj.correo;
        }
        if (obj.cedula_profesional === undefined && obj.cedula !== undefined) {
          obj.cedula_profesional = obj.cedula;
        }
        return obj;
      }
      return raw;
    },
    z.object({
      nombre_completo: nombre,
      telefono,
      correo_electronico: correo,
      fecha_nacimiento: fechaNacimiento(registrationDate),
      cedula_profesional: cedula,
    }),
  );

export const therapistSchema = createTherapistSchema();

export const therapistAvailabilitySchema = z.discriminatedUnion(
  'campo',
  [
    z.object({ campo: z.literal('telefono'), valor: telefono }),
    z.object({ campo: z.literal('correo'), valor: correo }),
    z.object({ campo: z.literal('correo_electronico'), valor: correo }),
    z.object({ campo: z.literal('cedula'), valor: cedula }),
    z.object({ campo: z.literal('cedula_profesional'), valor: cedula }),
  ],
  { error: 'Indica un campo válido para verificar: telefono, correo o cedula.' },
);

export const therapistIdSchema = z.uuid('El identificador del terapeuta no es válido.');

export type TherapistInput = z.infer<typeof therapistSchema>;
export type TherapistAvailabilityInput = z.infer<typeof therapistAvailabilitySchema>;
