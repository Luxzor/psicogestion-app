import { z } from 'zod';
import { parseIsoDate } from '../../platform/clock.js';
import { versionSchema } from '../salas/schemas.js';
import { MAX_BLOQUES, MIN_BLOQUES } from './horario.js';

/**
 * EDT 5.2.1. Reglas de validación de la cita (PG-DSN-003 4.3.2 y 4.5). El esquema valida la
 * forma del cuerpo; las reglas de horario que tienen un código propio (HORARIO_INVALIDO y
 * CITA_EN_EL_PASADO, 5.7.1) se evalúan con evaluarHorario() de horario.ts, y las de asignación
 * (recurso inexistente, inactivo u ocupado) con el repositorio dentro de la transacción.
 */

/** RF 5.2.2: estados de la cita, en el mismo orden que el tipo cita_estado de la base. */
export const CITA_ESTADOS = ['Pendiente', 'Cancelada', 'Vencida'] as const;
export type CitaEstado = (typeof CITA_ESTADOS)[number];

/** ADR-17: «C» + año de dos dígitos + 6 dígitos, igual que la restricción cita_folio_formato. */
export const FOLIO_PATTERN = /^C\d{2}\d{6}$/;
export const FOLIO_LENGTH = 9;

const uuidField = (message: string) =>
  z
    .string({ error: message })
    .trim()
    .pipe(z.uuid(message))
    .transform((value) => value.toLowerCase());

const idPaciente = uuidField('Selecciona un paciente.');
const idTerapeuta = uuidField('Selecciona un terapeuta.');
const idSala = uuidField('Elige una sala.');

/**
 * Inicio en ISO 8601 con zona (por ejemplo 2026-10-26T15:00:00Z o 2026-10-26T09:00:00-06:00).
 * Se convierte a Date; la conversión a la hora de la clínica la hace horario.ts.
 */
const inicio = z
  .string({ error: 'Elige la fecha y la hora de inicio.' })
  .trim()
  .pipe(z.iso.datetime({ offset: true, error: 'Elige la fecha y la hora de inicio.' }))
  .transform((value) => new Date(value));

/** Duración en bloques de 30 minutos, de 1 a 4 (Propuesta TP3-02). Sin coerción. */
const duracionBloques = z
  .number({ error: 'Elige la duración de la cita.' })
  .int('La duración debe ser de 30 minutos a 2 horas, en bloques de 30 minutos.')
  .min(MIN_BLOQUES, 'La duración debe ser de 30 minutos a 2 horas, en bloques de 30 minutos.')
  .max(MAX_BLOQUES, 'La duración debe ser de 30 minutos a 2 horas, en bloques de 30 minutos.');

/**
 * Alta de cita (POST /citas, PG-DSN-003 5.7). No acepta `estado` ni `folio`: la cita nace
 * Pendiente (RF 5.1.5) y la base asigna el folio (ADR-17). El cuerpo es estricto.
 */
export const createCitaSchema = z.strictObject({
  id_paciente: idPaciente,
  id_terapeuta: idTerapeuta,
  id_sala: idSala,
  inicio,
  duracion_bloques: duracionBloques,
});

/** Campos que la modificación puede cambiar (RF 5.3.3). */
export const EDITABLE_FIELDS = [
  'id_paciente',
  'id_terapeuta',
  'id_sala',
  'inicio',
  'duracion_bloques',
  'estado',
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * Modificación parcial con control de versión optimista (PATCH /citas/{id}, ADR-23). Solo con
 * `version` y ningún campo pasa el esquema; el servicio responde 400 SIN_CAMBIOS en ese caso,
 * como en pacientes y terapeutas.
 */
export const updateCitaSchema = z.strictObject({
  id_paciente: idPaciente.optional(),
  id_terapeuta: idTerapeuta.optional(),
  id_sala: idSala.optional(),
  inicio: inicio.optional(),
  duracion_bloques: duracionBloques.optional(),
  estado: z.enum(CITA_ESTADOS, { error: 'El estatus no es válido.' }).optional(),
  version: versionSchema,
});

/** Cancelación (POST /citas/{id}/cancelar, ADR-20): solo la versión leída. */
export const cancelCitaSchema = z.strictObject({ version: versionSchema });

export const citaIdSchema = z.uuid('El identificador de la cita no es válido.');

/** Folio escrito por la persona (RF 5.4.2): sin distinguir mayúsculas ni espacios laterales. */
export const folioSchema = z
  .string({ error: 'Escribe el folio de la cita.' })
  .trim()
  .min(1, 'Escribe el folio de la cita.')
  .transform((value) => value.toUpperCase())
  .pipe(
    z.string().regex(FOLIO_PATTERN, 'El folio no tiene un formato válido. Ejemplo: C26000118.'),
  );

/** Fecha de calendario AAAA-MM-DD para los filtros `desde`/`hasta` del listado (RF 5.2.3). */
const fechaFiltro = (mensaje: string) =>
  z
    .string({ error: mensaje })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.')
    .refine((value) => Boolean(parseIsoDate(value)), 'La fecha no es válida.');

export const CITA_LIST_DEFAULT_PAGE = 1;
export const CITA_LIST_DEFAULT_PAGE_SIZE = 25;
export const CITA_LIST_MAX_PAGE_SIZE = 100;

/**
 * Listado de citas (GET /citas, RF 5.2.1–5.2.3, RNF 5.1.4). `desde` y `hasta` llegan como
 * fechas de calendario ya resueltas por quien pide el filtro (el periodo día, semana o mes de
 * RF 5.2.3 se resuelve antes de llegar aquí); el servicio las interpreta en CLINIC_TIME_ZONE.
 * `folio` reutiliza folioSchema: normaliza a mayúsculas y exige el formato exacto.
 */
export const citaListQuerySchema = z
  .strictObject({
    estado: z.enum(CITA_ESTADOS, { error: 'El estado solicitado no es válido.' }).optional(),
    id_sala: idSala.optional(),
    id_terapeuta: idTerapeuta.optional(),
    desde: fechaFiltro('La fecha "desde" no es válida.').optional(),
    hasta: fechaFiltro('La fecha "hasta" no es válida.').optional(),
    folio: folioSchema.optional(),
    pagina: z.coerce
      .number({ error: 'La página debe ser un número entero.' })
      .int('La página debe ser un número entero.')
      .min(1, 'La página debe ser mayor o igual a 1.')
      .default(CITA_LIST_DEFAULT_PAGE),
    tamano: z.coerce
      .number({ error: 'El tamaño de página debe ser un número entero.' })
      .int('El tamaño de página debe ser un número entero.')
      .min(1, 'El tamaño de página debe ser mayor o igual a 1.')
      .max(
        CITA_LIST_MAX_PAGE_SIZE,
        `El tamaño de página no puede ser mayor que ${CITA_LIST_MAX_PAGE_SIZE}.`,
      )
      .default(CITA_LIST_DEFAULT_PAGE_SIZE),
  })
  .refine((value) => !value.desde || !value.hasta || value.desde <= value.hasta, {
    error: 'La fecha "desde" no puede ser posterior a "hasta".',
    path: ['desde'],
  });

export type CreateCitaInput = z.infer<typeof createCitaSchema>;
export type UpdateCitaInput = z.infer<typeof updateCitaSchema>;
export type CancelCitaInput = z.infer<typeof cancelCitaSchema>;
export type CitaListQueryInput = z.infer<typeof citaListQuerySchema>;
