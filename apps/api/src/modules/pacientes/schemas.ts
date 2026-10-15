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

/**
 * Valida solo la fecha de nacimiento. Al editar, el límite de 7 años se mide contra la fecha de
 * registro del paciente y no contra hoy, porque RF 3.1.9 habla de la edad "al momento del
 * registro" (PG-DSN-002 §4.5).
 */
export const createBirthDateSchema = (registrationDate: () => string) =>
  fechaNacimiento(registrationDate);

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

export const patientIdSchema = z.uuid('El identificador del paciente no es válido.');

/** Excluye al propio paciente de la verificación de unicidad al editar (RF 3.2.5). */
const excluirId = patientIdSchema.optional();

export const availabilitySchema = z.discriminatedUnion(
  'campo',
  [
    z.object({ campo: z.literal('curp'), valor: curp, excluir_id: excluirId }),
    z.object({
      campo: z.literal('telefono'),
      valor: telefono,
      // CURP capturado en el formulario; permite ignorar al paciente dado de baja que se
      // reactivaría con ese CURP, porque su teléfono se reemplaza en la reactivación.
      curp: z
        .string()
        .transform((value) => value.replace(/\s/g, '').toUpperCase())
        .optional(),
      excluir_id: excluirId,
    }),
  ],
  { error: 'Indica un campo válido para verificar: curp o telefono.' },
);

/**
 * EDT 4.3.2 y 4.3.3. Parámetros del listado de pacientes (PG-DSN-002 §5.12.1).
 * El esquema es estricto: un parámetro desconocido se rechaza en lugar de ignorarse en silencio.
 * `estado` llega con la baja lógica (EDT 4.3.3): por omisión se listan solo los activos, que es
 * lo que la lista mostraba en la EDT 4.3.2, de modo que los clientes anteriores no cambian.
 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const SEARCH_MAX_LENGTH = 100;
export const SORT_ORDERS = ['nombre_completo', '-fecha_registro'] as const;
export const DEFAULT_SORT_ORDER = 'nombre_completo';
export const LIST_STATES = ['activos', 'inactivos'] as const;
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
    .enum(LIST_STATES, { error: 'El estado solicitado no es válido: activos o inactivos.' })
    .default(DEFAULT_LIST_STATE),
});

/**
 * EDT 4.3.3. Cuerpo de la baja lógica (RF 3.3.1). La baja no modifica ningún dato del perfil,
 * así que no recibe campos: el cuerpo es un objeto vacío y estricto, de modo que un intento de
 * colar datos (por ejemplo `activo` o `fecha_baja`) se rechaza en lugar de ignorarse.
 */
export const dischargeSchema = z.strictObject(
  {},
  { error: 'La baja no recibe datos en el cuerpo de la solicitud.' },
);

/**
 * Indica si el cuerpo de una reactivación viene vacío. Desde el perfil (EDT 4.3.3) se reactiva
 * conservando los datos anteriores y no se envía cuerpo; desde el registro (EDT 4.3.1) se envían
 * los datos capturados, que reemplazan a los anteriores.
 */
export const isEmptyBody = (body: unknown) =>
  body === undefined ||
  body === null ||
  (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0);

/** Campos que la edición puede modificar (RF 3.2.4, vista "Nombre Paciente" de RF 3.2.3). */
export const EDITABLE_FIELDS = [
  'nombre_completo',
  'curp',
  'sexo',
  'fecha_nacimiento',
  'telefono',
  'correo',
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

const editableSelection = Object.fromEntries(
  EDITABLE_FIELDS.map((field) => [field, true as const]),
) as Record<EditableField, true>;

/**
 * Edición parcial con control de versión optimista (ADR-10). Se deriva del esquema del alta para
 * no duplicar ninguna regla de formato ni de normalización: todos los campos son opcionales y el
 * cuerpo es estricto, de modo que un campo desconocido o de solo lectura se rechaza.
 */
export const createUpdatePatientSchema = (registrationDate: () => string = () => todayInClinic()) =>
  createPatientSchema(registrationDate)
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

export const updatePatientSchema = createUpdatePatientSchema();

export type PatientInput = z.infer<typeof patientSchema>;
export type AvailabilityInput = z.infer<typeof availabilitySchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;
