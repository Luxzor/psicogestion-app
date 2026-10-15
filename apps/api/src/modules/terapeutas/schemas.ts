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

/** Forma base del terapeuta, sin el alias de campos cortos del alta (EDT 4.3.4). Se extrae aparte
 * para poder derivar el esquema de edición con pick/partial (ADR-10), ya que z.preprocess no
 * expone esos métodos. */
const therapistShape = (registrationDate: () => string) =>
  z.object({
    nombre_completo: nombre,
    telefono,
    correo_electronico: correo,
    fecha_nacimiento: fechaNacimiento(registrationDate),
    cedula_profesional: cedula,
  });

/** Acepta los alias cortos "correo" y "cedula" que ya usa el formulario de registro (EDT 4.3.4). */
function aliasShorthandFields(raw: unknown) {
  if (typeof raw !== 'object' || raw === null) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  if (obj.correo_electronico === undefined && obj.correo !== undefined) {
    obj.correo_electronico = obj.correo;
  }
  if (obj.cedula_profesional === undefined && obj.cedula !== undefined) {
    obj.cedula_profesional = obj.cedula;
  }
  return obj;
}

export const createTherapistSchema = (registrationDate: () => string = () => todayInClinic()) =>
  z.preprocess(aliasShorthandFields, therapistShape(registrationDate));

export const therapistSchema = createTherapistSchema();

/**
 * Valida solo la fecha de nacimiento. Al editar, "anterior a la fecha de registro" (RF 2.1.9) se
 * mide contra la fecha de registro del propio terapeuta, no contra hoy (mismo criterio que
 * PG-DSN-002 4.5 aplica a pacientes).
 */
export const createBirthDateSchema = (registrationDate: () => string) =>
  fechaNacimiento(registrationDate);

export const therapistIdSchema = z.uuid('El identificador del terapeuta no es válido.');

/** Excluye al propio terapeuta de la verificación de unicidad al editar (RF 2.2.4). */
const excluirId = therapistIdSchema.optional();

export const therapistAvailabilitySchema = z.discriminatedUnion(
  'campo',
  [
    z.object({ campo: z.literal('telefono'), valor: telefono, excluir_id: excluirId }),
    z.object({ campo: z.literal('correo'), valor: correo, excluir_id: excluirId }),
    z.object({ campo: z.literal('correo_electronico'), valor: correo, excluir_id: excluirId }),
    z.object({ campo: z.literal('cedula'), valor: cedula, excluir_id: excluirId }),
    z.object({ campo: z.literal('cedula_profesional'), valor: cedula, excluir_id: excluirId }),
  ],
  { error: 'Indica un campo válido para verificar: telefono, correo o cedula.' },
);

/**
 * EDT 4.3.5. Parámetros del listado de terapeutas (PG-DSN-002 5.12.1 y 5.12.2). El esquema es
 * estricto: un parámetro desconocido se rechaza en lugar de ignorarse en silencio. `estado` acepta
 * "todos" además de "activos" e "inactivos", tal como permite el contrato general de la 5.12.1,
 * aunque el filtro de la pantalla (5.7) solo ofrezca dos opciones.
 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const SEARCH_MAX_LENGTH = 100;
export const SORT_ORDERS = ['nombre_completo', '-fecha_registro'] as const;
export const DEFAULT_SORT_ORDER = 'nombre_completo';
export const LIST_STATES = ['activos', 'inactivos', 'todos'] as const;
export const DEFAULT_LIST_STATE = 'activos';

export const listQuerySchema = z.strictObject({
  pagina: z.coerce
    .number({ error: 'La página debe ser un número entero.' })
    .int('La página debe ser un número entero.')
    .min(DEFAULT_PAGE, 'La página debe ser mayor o igual a 1.')
    .default(DEFAULT_PAGE),
  tamano: z.coerce
    .number({ error: 'El tamaño de página debe ser un número entero.' })
    .int('El tamaño de página debe ser un número entero.')
    .min(1, 'El tamaño de página debe ser mayor o igual a 1.')
    .max(MAX_PAGE_SIZE, `El tamaño de página no puede ser mayor que ${MAX_PAGE_SIZE}.`)
    .default(DEFAULT_PAGE_SIZE),
  q: z
    .string({ error: 'El texto de búsqueda no es válido.' })
    .max(SEARCH_MAX_LENGTH, `La búsqueda no puede tener más de ${SEARCH_MAX_LENGTH} caracteres.`)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim() ?? '';
      return trimmed === '' ? undefined : trimmed;
    }),
  orden: z
    .enum(SORT_ORDERS, { error: 'El orden solicitado no es válido.' })
    .default(DEFAULT_SORT_ORDER),
  estado: z
    .enum(LIST_STATES, { error: 'El estado solicitado no es válido: activos, inactivos o todos.' })
    .default(DEFAULT_LIST_STATE),
});

/** Campos que la edición puede modificar (RF 2.2.3, vista "Nombre Terapeuta" de RF 2.2.2). */
export const EDITABLE_FIELDS = [
  'nombre_completo',
  'telefono',
  'correo_electronico',
  'fecha_nacimiento',
  'cedula_profesional',
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

const editableSelection = Object.fromEntries(
  EDITABLE_FIELDS.map((field) => [field, true as const]),
) as Record<EditableField, true>;

/**
 * Edición parcial con control de versión optimista (ADR-10). Se deriva del esquema del alta
 * (therapistShape, sin el alias de campos cortos) para no duplicar ninguna regla de formato ni de
 * normalización: todos los campos son opcionales y el cuerpo es estricto, de modo que un campo
 * desconocido o de solo lectura se rechaza. Solo "version" (sin ningún campo editable) pasa el
 * esquema; el servicio responde 400 SIN_CAMBIOS en ese caso.
 */
export const createUpdateTherapistSchema = (
  registrationDate: () => string = () => todayInClinic(),
) =>
  therapistShape(registrationDate)
    .pick(editableSelection)
    .partial()
    .extend({
      // Sin coerción deliberadamente: un booleano o una cadena en este campo es un error del
      // cliente, no una versión válida.
      version: z
        .number({ error: 'Indica la versión del perfil que estás editando.' })
        .int('La versión debe ser un número entero.')
        .positive('La versión debe ser un número entero positivo.'),
    })
    .strict();

export const updateTherapistSchema = createUpdateTherapistSchema();

export type TherapistInput = z.infer<typeof therapistSchema>;
export type TherapistAvailabilityInput = z.infer<typeof therapistAvailabilitySchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type UpdateTherapistInput = z.infer<typeof updateTherapistSchema>;
