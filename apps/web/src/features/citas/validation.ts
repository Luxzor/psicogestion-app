import { isTherapistEligibleForAppointment } from '../terapeutas/validation';
import {
  bloquesADuracion,
  cabeEnHorario,
  CIERRE_MINUTOS,
  duracionABloques,
  enHoraClinica,
  esDomingo,
  hoyEnClinica,
  toInicioIso,
  yaPaso,
} from './horario';
import type {
  Cita,
  CitaErrorCode,
  CitaEstado,
  CitaFormErrors,
  CitaFormValues,
  CitaPayload,
  CitaUpdatePayload,
} from './types';

/**
 * EDT 5.2.1. Reglas del modelo de citas en el cliente (PG-DSN-003 4.5 y 5.4 a 5.6). Repiten las
 * del servidor para dar el mensaje antes de enviar; el servidor y las restricciones de la base
 * siguen siendo la autoridad final (empalmes, recursos inactivos y versión). Los textos siguen
 * la maqueta PG-DSN-003-INT v0.1.0 y el catálogo de 5.6.
 */

/** ADR-17: «C» + año de dos dígitos + 6 dígitos, igual que cita_folio_formato. */
export const FOLIO_PATTERN = /^C\d{2}\d{6}$/;

/** Pestañas de la lista (PG-DSN-003 5.5, RF 5.2.2). */
export const CITA_TABS: ReadonlyArray<{ estado: CitaEstado; label: string }> = [
  { estado: 'Pendiente', label: 'Pendientes' },
  { estado: 'Cancelada', label: 'Canceladas' },
  { estado: 'Vencida', label: 'Vencidas' },
];

/** Catálogo de mensajes de interfaz (PG-DSN-003 5.6). */
export const CITA_MENSAJES: Record<CitaErrorCode, string> = {
  HORARIO_INVALIDO: 'Las citas son de 07:00 a 17:00, en bloques de 30 minutos.',
  CITA_EN_EL_PASADO: 'Elige una fecha y hora posteriores al momento actual.',
  PACIENTE_NO_ENCONTRADO: 'No encontramos al paciente indicado.',
  TERAPEUTA_NO_ENCONTRADO: 'No encontramos al terapeuta indicado.',
  SALA_NO_ENCONTRADA: 'No encontramos la sala indicada.',
  CITA_NO_ENCONTRADA: 'No existe una cita con ese folio. Revísalo e intenta de nuevo.',
  PACIENTE_INACTIVO_NO_ASIGNABLE: 'Ese paciente está dado de baja. Reactívalo antes de agendar.',
  TERAPEUTA_INACTIVO_NO_ASIGNABLE:
    'Ese terapeuta está dado de baja y no puede asignarse a citas nuevas.',
  SALA_INACTIVA: 'Esta sala fue eliminada. Elige otra.',
  SALA_OCUPADA: 'Esa sala ya está reservada a esa hora. Elige otro horario.',
  TERAPEUTA_OCUPADO: 'El terapeuta ya tiene una cita a esa hora.',
  PACIENTE_OCUPADO: 'El paciente ya tiene una cita a esa hora.',
  CITA_NO_MODIFICABLE: 'Esta cita ya no está pendiente: solo puede consultarse.',
  CITA_YA_CANCELADA: 'Esa cita ya fue cancelada.',
  CONFLICTO_VERSION: 'Otra persona modificó esta cita. Revisa los cambios y vuelve a intentar.',
};

export const CITA_EXITO = {
  agendada: (folio: string) => `Cita agendada con éxito. Folio ${folio}.`,
  modificada: 'Cita modificada.',
  cancelada: (folio: string) => `Cita ${folio} cancelada.`,
  confirmarCancelacion: (folio: string) =>
    `¿Cancelar la cita ${folio}? Esta acción libera el horario.`,
  sinCorreo: 'El paciente no tiene correo registrado: no se envió la confirmación.',
  falloCorreo: 'La cita se guardó, pero no se pudo enviar la confirmación.',
  errorConexion: 'No se pudo guardar. Tus datos se conservan; reintenta.',
} as const;

/** Mensaje de interfaz para un código del servidor, o null si no es del modelo de citas. */
export function mensajeDeError(codigo: string) {
  return (CITA_MENSAJES as Record<string, string>)[codigo] ?? null;
}

/** Por analogía con RF 2.3.5, un paciente dado de baja no se asigna (CA-5.1-03). */
export const isPatientEligibleForAppointment = (paciente: { activo: boolean }) =>
  Boolean(paciente.activo);

export { isTherapistEligibleForAppointment };

/** Contexto que el formulario necesita para validar más allá de los valores capturados. */
export type CitaValidationContext = {
  modo: 'nuevo' | 'editar';
  /** Estado de los recursos elegidos, si ya se conocen. */
  paciente?: { activo: boolean } | null;
  terapeuta?: { activo: boolean } | null;
  sala?: { activo: boolean } | null;
  /** Valores con los que se abrió la cita al modificar: un recurso que no cambió no se revalida. */
  inicial?: CitaFormValues;
  ahora?: Date;
};

/**
 * Valida el formulario de agendar o modificar (PG-DSN-003 5.4 y 5.5; RF 5.1.2 a 5.1.4, RF 5.3.4).
 * Devuelve un objeto con el primer mensaje de cada campo; vacío si todo es válido.
 */
export function validateCitaForm(values: CitaFormValues, context: CitaValidationContext) {
  const errors: CitaFormErrors = {};
  const ahora = context.ahora ?? new Date();
  const changed = (field: keyof CitaFormValues) =>
    context.modo === 'nuevo' || !context.inicial || values[field] !== context.inicial[field];

  if (!values.id_paciente) errors.id_paciente = 'Selecciona un paciente.';
  else if (
    context.paciente &&
    !isPatientEligibleForAppointment(context.paciente) &&
    changed('id_paciente')
  ) {
    errors.id_paciente = CITA_MENSAJES.PACIENTE_INACTIVO_NO_ASIGNABLE;
  }

  if (!values.id_terapeuta) errors.id_terapeuta = 'Selecciona un terapeuta.';
  else if (
    context.terapeuta &&
    !isTherapistEligibleForAppointment(context.terapeuta) &&
    changed('id_terapeuta')
  ) {
    errors.id_terapeuta = 'Este terapeuta está dado de baja y no se puede asignar. Elige otro.';
  }

  if (!values.id_sala) errors.id_sala = 'Elige una sala.';
  else if (context.sala && !context.sala.activo && changed('id_sala')) {
    errors.id_sala = CITA_MENSAJES.SALA_INACTIVA;
  }

  if (!values.fecha) errors.fecha = 'Elige una fecha.';
  else if (!toInicioIso(values.fecha, 0)) errors.fecha = 'Elige una fecha válida.';
  else if (esDomingo(values.fecha))
    errors.fecha = 'La clínica no atiende en domingo. Elige otro día.';
  else if (context.modo === 'nuevo' && values.fecha < hoyEnClinica(ahora)) {
    errors.fecha = 'La fecha no puede ser anterior a hoy.';
  }

  if (!errors.fecha && values.id_sala) {
    if (values.inicio == null) errors.inicio = 'Elige un horario disponible.';
    else if (values.inicio + values.duracion > CIERRE_MINUTOS) {
      errors.inicio = 'La sesión debe terminar a más tardar a las 17:00.';
    } else if (!cabeEnHorario(values.inicio, values.duracion)) {
      errors.inicio = CITA_MENSAJES.HORARIO_INVALIDO;
    } else if (
      (changed('fecha') || changed('inicio')) &&
      yaPaso(values.fecha, values.inicio, ahora)
    ) {
      errors.inicio = CITA_MENSAJES.CITA_EN_EL_PASADO;
    }
  }
  return errors;
}

/** Cuerpo del alta a partir del formulario ya validado. */
export function toCitaPayload(values: CitaFormValues): CitaPayload | null {
  if (values.inicio == null) return null;
  const inicio = toInicioIso(values.fecha, values.inicio);
  if (!inicio) return null;
  return {
    id_paciente: values.id_paciente,
    id_terapeuta: values.id_terapeuta,
    id_sala: values.id_sala,
    inicio,
    duracion_bloques: duracionABloques(values.duracion),
  };
}

/** Valores del formulario de modificación a partir de una cita guardada (RF 5.3.2). */
export function toCitaFormValues(cita: Cita): CitaFormValues {
  const inicio = enHoraClinica(cita.inicio);
  return {
    id_paciente: cita.paciente.id,
    id_terapeuta: cita.terapeuta.id,
    id_sala: cita.sala.id,
    fecha: inicio.fecha,
    inicio: inicio.minutos,
    duracion: bloquesADuracion(cita.duracion_bloques),
  };
}

/**
 * Cuerpo del PATCH con solo los campos que cambiaron más la versión leída (ADR-23), o null si no
 * hay cambios. Si cambian la fecha o la hora se envía el nuevo inicio; si cambia la duración,
 * `duracion_bloques`.
 */
export function diffCitaPayload(cita: Cita, values: CitaFormValues): CitaUpdatePayload | null {
  const initial = toCitaFormValues(cita);
  const payload: CitaUpdatePayload = { version: cita.version };
  if (values.id_paciente !== initial.id_paciente) payload.id_paciente = values.id_paciente;
  if (values.id_terapeuta !== initial.id_terapeuta) payload.id_terapeuta = values.id_terapeuta;
  if (values.id_sala !== initial.id_sala) payload.id_sala = values.id_sala;
  if (
    (values.fecha !== initial.fecha || values.inicio !== initial.inicio) &&
    values.inicio != null
  ) {
    const inicio = toInicioIso(values.fecha, values.inicio);
    if (inicio) payload.inicio = inicio;
  }
  if (values.duracion !== initial.duracion) {
    payload.duracion_bloques = duracionABloques(values.duracion);
  }
  return Object.keys(payload).length > 1 ? payload : null;
}

/** Normaliza el folio que se escribe: sin espacios y en mayúsculas (RF 5.4.2). */
export const normalizeFolio = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/** Mensaje de error del folio o cadena vacía si su formato es válido. */
export function validateFolio(value: string) {
  const folio = normalizeFolio(value);
  if (!folio) return 'Escribe el folio de la cita.';
  if (!FOLIO_PATTERN.test(folio)) return 'El folio no tiene un formato válido. Ejemplo: C26000118.';
  return '';
}

/** Una cita solo se modifica o se cancela mientras está Pendiente (ADR-18, ADR-20). */
export const isCitaEditable = (cita: Pick<Cita, 'estado'>) => cita.estado === 'Pendiente';
