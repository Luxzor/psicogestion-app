import { env } from '../../config/env.js';
import { parseIsoDate } from '../../platform/clock.js';

/**
 * EDT 5.2.1. Rejilla horaria de las citas (PG-DSN-003 ADR-15). Los bloques no son una tabla: son
 * intervalos de 30 minutos de 07:00 a 17:00 en la hora de la clínica, calculados aquí. La cita
 * guarda su rango continuo [inicio, fin) como timestamptz, y la base vuelve a verificar las mismas
 * reglas con las restricciones cita_rejilla_30min, cita_mismo_dia y cita_horario_operativo de
 * db/migrations/0009_sala_cita.sql.
 *
 * Si el cliente confirma que la agenda llega a las 19:00 (H3-08, TP3-02), el cambio va aquí, en la
 * constante equivalente del cliente y en una migración nueva para cita_horario_operativo.
 */
export const BLOQUE_MINUTOS = 30;
/** 07:00 en minutos desde la medianoche. */
export const APERTURA_MINUTOS = 7 * 60;
/** 17:00 en minutos desde la medianoche: ninguna cita puede terminar después. */
export const CIERRE_MINUTOS = 17 * 60;
/** Duración permitida de una cita, en bloques de 30 minutos (Propuesta TP3-02). */
export const MIN_BLOQUES = 1;
export const MAX_BLOQUES = 4;
/** Duración que ofrece por defecto la pantalla de agendar: 1 hora (PG-DSN-003 5.4). */
export const BLOQUES_POR_DEFECTO = 2;
/** Bloques de un día completo de atención: 20 de 07:00 a 17:00. */
export const BLOQUES_POR_DIA = (CIERRE_MINUTOS - APERTURA_MINUTOS) / BLOQUE_MINUTOS;

const MINUTO_MS = 60_000;

export type HorarioErrorCode = 'HORARIO_INVALIDO' | 'CITA_EN_EL_PASADO';

export type HorarioError = { codigo: HorarioErrorCode; mensaje: string };

/** Mensajes del catálogo de PG-DSN-003 5.6. */
export const HORARIO_MENSAJES = {
  HORARIO_INVALIDO: 'Las citas son de 07:00 a 17:00, en bloques de 30 minutos.',
  CITA_EN_EL_PASADO: 'Elige una fecha y hora posteriores al momento actual.',
} as const satisfies Record<HorarioErrorCode, string>;

/** Componentes de un instante en la hora de la clínica. */
export type ClinicParts = {
  /** Día en formato AAAA-MM-DD. */
  fecha: string;
  /** Minutos transcurridos desde la medianoche. */
  minutos: number;
  segundos: number;
  milisegundos: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Fecha y hora de un instante en la zona de la clínica (CLINIC_TIME_ZONE). */
export function clinicParts(instant: Date, timeZone = env.CLINIC_TIME_ZONE): ClinicParts {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    fecha: `${parts.year}-${parts.month}-${parts.day}`,
    minutos: Number(parts.hour) * 60 + Number(parts.minute),
    segundos: Number(parts.second),
    milisegundos: instant.getUTCMilliseconds(),
  };
}

/** Diferencia en milisegundos entre la hora de la clínica y UTC para ese instante. */
function offsetMs(instant: Date, timeZone: string) {
  const local = clinicParts(instant, timeZone);
  const date = parseIsoDate(local.fecha);
  if (!date) return 0;
  const asUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    Math.floor(local.minutos / 60),
    local.minutos % 60,
    local.segundos,
  );
  return asUtc - (instant.getTime() - local.milisegundos);
}

/**
 * Instante UTC que corresponde a una fecha y hora de la clínica. Mérida no tiene horario de
 * verano desde 2015, pero el cálculo no lo supone: vuelve a medir la diferencia en el resultado
 * por si la zona configurada cambia de horario ese día (PG-DSN-003 8, riesgo de huso horario).
 * Devuelve null si la fecha no existe en el calendario.
 */
export function clinicDateTimeToUtc(
  fecha: string,
  minutos: number,
  timeZone = env.CLINIC_TIME_ZONE,
) {
  const date = parseIsoDate(fecha);
  if (!date || !Number.isInteger(minutos) || minutos < 0 || minutos > 24 * 60) return null;
  const naive = Date.UTC(date.year, date.month - 1, date.day) + minutos * MINUTO_MS;
  const first = naive - offsetMs(new Date(naive), timeZone);
  const second = naive - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** Fin exclusivo de una cita a partir de su inicio y su duración en bloques. */
export function calcularFin(inicio: Date, duracionBloques: number) {
  return new Date(inicio.getTime() + duracionBloques * BLOQUE_MINUTOS * MINUTO_MS);
}

/** Duración en bloques de un rango guardado; útil al modificar solo la hora de inicio. */
export function duracionEnBloques(inicio: Date, fin: Date) {
  return Math.round((fin.getTime() - inicio.getTime()) / (BLOQUE_MINUTOS * MINUTO_MS));
}

/** Indica si la duración es un número entero de 1 a 4 bloques. */
export function duracionValida(duracionBloques: number) {
  return (
    Number.isInteger(duracionBloques) &&
    duracionBloques >= MIN_BLOQUES &&
    duracionBloques <= MAX_BLOQUES
  );
}

/**
 * Verifica las reglas de horario de una cita (PG-DSN-003 4.5 y 5.7.1): rejilla de 30 minutos,
 * dentro de 07:00 a 17:00, en el mismo día, con 1 a 4 bloques y no en el pasado. Devuelve el
 * primer error encontrado o null. Las mismas reglas, salvo la del pasado, las garantiza la base.
 */
export function evaluarHorario(
  inicio: Date,
  duracionBloques: number,
  ahora: Date = new Date(),
  timeZone = env.CLINIC_TIME_ZONE,
): HorarioError | null {
  const invalido = {
    codigo: 'HORARIO_INVALIDO',
    mensaje: HORARIO_MENSAJES.HORARIO_INVALIDO,
  } as const;
  if (Number.isNaN(inicio.getTime()) || !duracionValida(duracionBloques)) return invalido;

  const start = clinicParts(inicio, timeZone);
  if (start.segundos !== 0 || start.milisegundos !== 0) return invalido;
  if (start.minutos % BLOQUE_MINUTOS !== 0) return invalido;
  if (start.minutos < APERTURA_MINUTOS) return invalido;

  const fin = calcularFin(inicio, duracionBloques);
  const end = clinicParts(fin, timeZone);
  if (end.fecha !== start.fecha || end.minutos > CIERRE_MINUTOS) return invalido;

  if (inicio.getTime() < ahora.getTime()) {
    return { codigo: 'CITA_EN_EL_PASADO', mensaje: HORARIO_MENSAJES.CITA_EN_EL_PASADO };
  }
  return null;
}

export type BloqueHorario = { inicio: Date; fin: Date };

/**
 * Los 20 bloques de 30 minutos de un día de atención, de 07:00 a 17:00 en la hora de la clínica
 * (RF 4.3.2 y RF 5.1.3). Devuelve null si la fecha no existe.
 */
export function bloquesDelDia(fecha: string, timeZone = env.CLINIC_TIME_ZONE) {
  if (!parseIsoDate(fecha)) return null;
  const bloques: BloqueHorario[] = [];
  for (let minutos = APERTURA_MINUTOS; minutos < CIERRE_MINUTOS; minutos += BLOQUE_MINUTOS) {
    const inicio = clinicDateTimeToUtc(fecha, minutos, timeZone);
    if (!inicio) return null;
    bloques.push({ inicio, fin: calcularFin(inicio, 1) });
  }
  return bloques;
}

/** Inicio y fin exclusivo del día de atención, útiles para consultar las citas de una fecha. */
export function ventanaDelDia(fecha: string, timeZone = env.CLINIC_TIME_ZONE) {
  const desde = clinicDateTimeToUtc(fecha, APERTURA_MINUTOS, timeZone);
  const hasta = clinicDateTimeToUtc(fecha, CIERRE_MINUTOS, timeZone);
  return desde && hasta ? { desde, hasta } : null;
}
