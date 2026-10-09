import { z } from 'zod';
import { ageOn, parseIsoDate, todayInClinic } from '../../platform/clock.js';

/** Estructura del CURP (RF 3.1.5): 18 caracteres alfanuméricos en mayúsculas. */
export const CURP_PATTERN =
  /^[A-Z][AEIOUX][A-Z]{2}[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9][0-9]$/;
export const PHONE_PATTERN = /^\d{10}$/;
export const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
export const MINIMUM_AGE = 7;
export const SEXOS = ['F', 'M', 'O'] as const;

const nombre = z
  .string({ error: 'Escribe el nombre completo.' })
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Escribe el nombre completo.')
      .max(50, 'El nombre no puede tener más de 50 caracteres.'),
  );

const curp = z
  .string({ error: 'Escribe el CURP.' })
  .transform((value) => value.replace(/\s/g, '').toUpperCase())
  .pipe(
    z
      .string()
      .min(1, 'Escribe el CURP.')
      .regex(CURP_PATTERN, 'El CURP no tiene un formato válido. Debe tener 18 caracteres.'),
  );

const telefono = z
  .string({ error: 'Escribe el teléfono.' })
  .trim()
  .min(1, 'Escribe el teléfono.')
  .regex(PHONE_PATTERN, 'El teléfono debe tener exactamente 10 dígitos.');

const correo = z
  .union([z.string(), z.null()], { error: 'Escribe un correo con formato válido.' })
  .optional()
  .transform((value) => {
    const normalized = value?.trim().toLowerCase() ?? '';
    return normalized === '' ? null : normalized;
  })
  .pipe(
    z
      .string()
      .max(100, 'El correo no puede tener más de 100 caracteres.')
      .regex(EMAIL_PATTERN, 'Escribe un correo con formato válido, por ejemplo nombre@dominio.mx.')
      .nullable(),
  );

/**
 * La fecha se recibe en formato ISO (AAAA-MM-DD). La interfaz la captura como dd/mm/aaaa
 * (RF 3.1.7) y la convierte antes de enviarla. Las reglas de RF 3.1.8 y RF 3.1.9 se evalúan
 * contra la fecha de registro, es decir, el día actual en la zona horaria de la clínica.
 */
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
        return;
      }
      if (ageOn(value, today) < MINIMUM_AGE) {
        context.addIssue({
          code: 'custom',
          message: `El paciente debe tener al menos ${MINIMUM_AGE} años cumplidos.`,
        });
      }
    });

export const createPatientSchema = (registrationDate: () => string = () => todayInClinic()) =>
  z.object({
    nombre_completo: nombre,
    curp,
    sexo: z.enum(SEXOS, { error: 'Selecciona el sexo.' }),
    fecha_nacimiento: fechaNacimiento(registrationDate),
    telefono,
    correo,
    consentimiento: z
      .boolean({ error: 'El consentimiento debe ser verdadero o falso.' })
      .optional()
      .default(false),
  });

export const patientSchema = createPatientSchema();

export const availabilitySchema = z.discriminatedUnion(
  'campo',
  [
    z.object({ campo: z.literal('curp'), valor: curp }),
    z.object({
      campo: z.literal('telefono'),
      valor: telefono,
      // CURP capturado en el formulario; permite ignorar al paciente dado de baja que se
      // reactivaría con ese CURP, porque su teléfono se reemplaza en la reactivación.
      curp: z
        .string()
        .transform((value) => value.replace(/\s/g, '').toUpperCase())
        .optional(),
    }),
  ],
  { error: 'Indica un campo válido para verificar: curp o telefono.' },
);

export const patientIdSchema = z.uuid('El identificador del paciente no es válido.');

export type PatientInput = z.infer<typeof patientSchema>;
export type AvailabilityInput = z.infer<typeof availabilitySchema>;
