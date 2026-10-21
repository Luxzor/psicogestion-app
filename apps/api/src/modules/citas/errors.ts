import { AppError } from '../../platform/errors.js';
import { HORARIO_MENSAJES } from './horario.js';

type DatabaseError = Error & { code?: string; constraint?: string };

/**
 * EDT 5.2.1. Códigos de error del modelo de citas (PG-DSN-003 5.7.1) con su estado HTTP, el
 * mensaje del catálogo de 5.6 y el campo del formulario donde se muestra. Los servicios de la
 * EDT 5.3 construyen sus errores con citaError() para no repetir textos.
 */
export const CITA_ERRORES = {
  HORARIO_INVALIDO: { status: 400, mensaje: HORARIO_MENSAJES.HORARIO_INVALIDO, campo: 'inicio' },
  CITA_EN_EL_PASADO: { status: 422, mensaje: HORARIO_MENSAJES.CITA_EN_EL_PASADO, campo: 'inicio' },
  PACIENTE_NO_ENCONTRADO: {
    status: 404,
    mensaje: 'No encontramos al paciente indicado.',
    campo: 'id_paciente',
  },
  TERAPEUTA_NO_ENCONTRADO: {
    status: 404,
    mensaje: 'No encontramos al terapeuta indicado.',
    campo: 'id_terapeuta',
  },
  SALA_NO_ENCONTRADA: {
    status: 404,
    mensaje: 'No encontramos la sala indicada.',
    campo: 'id_sala',
  },
  CITA_NO_ENCONTRADA: {
    status: 404,
    mensaje: 'No encontramos la cita indicada. Revisa el folio e intenta de nuevo.',
    campo: undefined,
  },
  PACIENTE_INACTIVO_NO_ASIGNABLE: {
    status: 409,
    mensaje: 'Ese paciente está dado de baja. Reactívalo antes de agendar.',
    campo: 'id_paciente',
  },
  TERAPEUTA_INACTIVO_NO_ASIGNABLE: {
    status: 409,
    mensaje: 'Ese terapeuta está dado de baja y no puede asignarse a citas nuevas.',
    campo: 'id_terapeuta',
  },
  SALA_INACTIVA: {
    status: 409,
    mensaje: 'Esa sala está dada de baja. Elige otra.',
    campo: 'id_sala',
  },
  SALA_OCUPADA: {
    status: 409,
    mensaje: 'Esa sala ya está reservada a esa hora. Elige otro horario.',
    campo: 'inicio',
  },
  TERAPEUTA_OCUPADO: {
    status: 409,
    mensaje: 'El terapeuta ya tiene una cita a esa hora.',
    campo: 'inicio',
  },
  PACIENTE_OCUPADO: {
    status: 409,
    mensaje: 'El paciente ya tiene una cita a esa hora.',
    campo: 'inicio',
  },
  CITA_NO_MODIFICABLE: {
    status: 409,
    mensaje: 'Esta cita ya no está pendiente: solo puede consultarse.',
    campo: undefined,
  },
  CITA_YA_CANCELADA: {
    status: 409,
    mensaje: 'Esa cita ya fue cancelada.',
    campo: undefined,
  },
  CONFLICTO_VERSION: {
    status: 409,
    mensaje: 'Otra persona modificó esta cita. Revisa los cambios y vuelve a intentar.',
    campo: undefined,
  },
} as const satisfies Record<string, { status: number; mensaje: string; campo?: string }>;

export type CitaErrorCode = keyof typeof CITA_ERRORES;

/** Construye el AppError de un código del catálogo, con detalles adicionales si los hay. */
export function citaError(codigo: CitaErrorCode, details?: Record<string, unknown>) {
  const { status, mensaje, campo } = CITA_ERRORES[codigo];
  return new AppError(status, codigo, mensaje, campo ? { [campo]: mensaje } : undefined, details);
}

/** Restricción EXCLUDE violada (SQLSTATE 23P01) y el recurso que ocupa el horario (ADR-16). */
const EMPALMES: Record<string, CitaErrorCode> = {
  cita_sala_sin_empalme: 'SALA_OCUPADA',
  cita_terapeuta_sin_empalme: 'TERAPEUTA_OCUPADO',
  cita_paciente_sin_empalme: 'PACIENTE_OCUPADO',
};

/** Restricciones CHECK de horario (SQLSTATE 23514). */
const HORARIO_CHECKS = new Set([
  'cita_rango_valido',
  'cita_rejilla_30min',
  'cita_mismo_dia',
  'cita_horario_operativo',
]);

/** Llaves foráneas hacia los recursos asignados (SQLSTATE 23503). */
const REFERENCIAS: Record<string, CitaErrorCode> = {
  cita_id_paciente_fkey: 'PACIENTE_NO_ENCONTRADO',
  cita_id_terapeuta_fkey: 'TERAPEUTA_NO_ENCONTRADO',
  cita_id_sala_fkey: 'SALA_NO_ENCONTRADA',
};

/**
 * Traduce las violaciones de las restricciones de la tabla cita a los códigos de PG-DSN-003
 * 5.7.1. La verificación previa del servicio solo sirve para dar un mensaje claro; la garantía
 * contra la doble reserva, incluso con dos solicitudes simultáneas, es esta restricción (ADR-16).
 * Devuelve null si el error no proviene de una restricción de cita.
 */
export function citaDatabaseError(error: unknown): AppError | null {
  const { code, constraint } = (error ?? {}) as DatabaseError;
  if (!constraint) return null;
  if (code === '23P01' && EMPALMES[constraint]) return citaError(EMPALMES[constraint]);
  if (code === '23514' && HORARIO_CHECKS.has(constraint)) return citaError('HORARIO_INVALIDO');
  if (code === '23503' && REFERENCIAS[constraint]) return citaError(REFERENCIAS[constraint]);
  return null;
}
