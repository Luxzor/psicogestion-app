import { z } from 'zod';

/**
 * EDT 5.2.1. Reglas de validación de la sala (PG-DSN-003 4.3.1 y 4.5; RF 4.1.2 a RF 4.1.4).
 * El servidor recorta los espacios laterales y colapsa los internos repetidos; conserva la
 * capitalización escrita. La unicidad sin distinguir mayúsculas la garantiza el índice
 * uq_sala_nombre de db/migrations/0009_sala_cita.sql.
 */
export const SALA_NOMBRE_MAX = 10;

/** Catálogo de mensajes de PG-DSN-003 5.6. */
export const SALA_MENSAJES = {
  NOMBRE_INVALIDO: 'Escribe un nombre de 1 a 10 caracteres.',
  NOMBRE_SALA_EN_USO: 'Ya existe una sala con ese nombre.',
  SALA_NO_ENCONTRADA: 'No encontramos la sala indicada.',
  SALA_INACTIVA: 'Esa sala está dada de baja y no puede usarse.',
  SALA_ACTIVA: 'La sala ya está activa.',
  SALA_CON_CITAS_PENDIENTES: (n: number) =>
    `No se puede dar de baja: tiene ${n} ${n === 1 ? 'cita pendiente' : 'citas pendientes'}. Reubícalas o cancélalas primero.`,
} as const;

/** Normalización del nombre: recorta y colapsa espacios internos repetidos. */
export const normalizarNombreSala = (value: string) => value.trim().replace(/\s+/g, ' ');

export const nombreSalaSchema = z
  .string({ error: SALA_MENSAJES.NOMBRE_INVALIDO })
  .transform(normalizarNombreSala)
  .pipe(
    z
      .string()
      .min(1, SALA_MENSAJES.NOMBRE_INVALIDO)
      .max(SALA_NOMBRE_MAX, SALA_MENSAJES.NOMBRE_INVALIDO),
  );

/** Alta de sala (RF 4.1.1, RF 4.1.2): solo el nombre. El cuerpo es estricto. */
export const createSalaSchema = z.strictObject({ nombre: nombreSalaSchema });

/** Versión leída para el control optimista (ADR-23). Sin coerción, como en terapeutas. */
export const versionSchema = z
  .number({ error: 'Indica la versión del registro que estás modificando.' })
  .int('La versión debe ser un número entero.')
  .positive('La versión debe ser un número entero positivo.');

/** Cambio de nombre con control de versión (PATCH /salas/{id}, PG-DSN-003 5.7). */
export const updateSalaSchema = z.strictObject({
  nombre: nombreSalaSchema,
  version: versionSchema,
});

export const salaIdSchema = z.uuid('El identificador de la sala no es válido.');

/** Verificación anticipada de disponibilidad de nombre (RF 4.1.4, RNF 4.1.2). */
export const salaAvailabilitySchema = z.strictObject({
  campo: z.literal('nombre'),
  valor: z
    .string({ error: SALA_MENSAJES.NOMBRE_INVALIDO })
    .transform(normalizarNombreSala),
  excluir_id: salaIdSchema.optional(),
});

export type CreateSalaInput = z.infer<typeof createSalaSchema>;
export type UpdateSalaInput = z.infer<typeof updateSalaSchema>;
export type SalaAvailabilityInput = z.infer<typeof salaAvailabilitySchema>;
