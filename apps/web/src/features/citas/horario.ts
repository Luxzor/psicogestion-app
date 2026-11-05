/**
 * EDT 5.2.1. Rejilla horaria de las citas en el cliente (PG-DSN-003 ADR-15). Son las mismas
 * constantes de apps/api/src/modules/citas/horario.ts: bloques de 30 minutos de 07:00 a 17:00 en
 * la hora de la clínica, citas de 1 a 4 bloques (30 minutos a 2 horas) y 1 hora por defecto.
 *
 * Las horas se manejan como minutos desde la medianoche en la zona de la clínica, para no depender
 * de la zona del navegador; solo al enviar se convierten a un instante ISO 8601.
 */
export const CLINIC_TIME_ZONE = 'America/Merida';
export const BLOQUE_MINUTOS = 30;
export const APERTURA_MINUTOS = 7 * 60;
export const CIERRE_MINUTOS = 17 * 60;
export const MIN_BLOQUES = 1;
export const MAX_BLOQUES = 4;

/** Duraciones de la barra «Duración» de la maqueta, en minutos. */
export const DURACIONES = [30, 60, 90, 120] as const;
export const DURACION_POR_DEFECTO = 60;

const pad = (value: number) => String(value).padStart(2, '0');

/** 540 a «09:00». */
export const minutosAHora = (minutos: number) =>
  `${pad(Math.floor(minutos / 60))}:${pad(minutos % 60)}`;

/** «09:00» a 540; null si el texto no es una hora válida. */
export function horaAMinutos(hora: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Etiqueta de una duración: «30 min», «1 h», «1 h 30 min», «2 h». */
export function etiquetaDuracion(minutos: number) {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (!horas) return `${resto} min`;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

export const duracionABloques = (minutos: number) => minutos / BLOQUE_MINUTOS;
export const bloquesADuracion = (bloques: number) => bloques * BLOQUE_MINUTOS;

/** Inicio de cada uno de los 20 bloques del día, en minutos: 420, 450, ..., 990. */
export const BLOQUES_DEL_DIA: readonly number[] = Array.from(
  { length: (CIERRE_MINUTOS - APERTURA_MINUTOS) / BLOQUE_MINUTOS },
  (_, index) => APERTURA_MINUTOS + index * BLOQUE_MINUTOS,
);

/** Indica si una cita que empieza en `inicio` con esa duración cabe en la rejilla y el horario. */
export function cabeEnHorario(inicio: number, duracion: number) {
  const bloques = duracionABloques(duracion);
  return (
    Number.isInteger(inicio) &&
    inicio % BLOQUE_MINUTOS === 0 &&
    inicio >= APERTURA_MINUTOS &&
    Number.isInteger(bloques) &&
    bloques >= MIN_BLOQUES &&
    bloques <= MAX_BLOQUES &&
    inicio + duracion <= CIERRE_MINUTOS
  );
}

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINIC_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Fecha (AAAA-MM-DD) y minutos de un instante en la hora de la clínica. */
export function enHoraClinica(instante: Date | string) {
  const date = typeof instante === 'string' ? new Date(instante) : instante;
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    fecha: `${parts.year}-${parts.month}-${parts.day}`,
    minutos: Number(parts.hour) * 60 + Number(parts.minute),
    segundos: Number(parts.second),
  };
}

function offsetMs(instante: number) {
  const local = enHoraClinica(new Date(instante));
  const [year, month, day] = local.fecha.split('-').map(Number);
  const asUtc = Date.UTC(year, month - 1, day, 0, local.minutos, local.segundos);
  return asUtc - Math.floor(instante / 1000) * 1000;
}

/**
 * Instante ISO 8601 (UTC) de una fecha y hora de la clínica, para el campo `inicio` del alta.
 * Devuelve null si la fecha no existe.
 */
export function toInicioIso(fecha: string, minutos: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  const naive = Date.UTC(year, month - 1, day, 0, minutos);
  const first = naive - offsetMs(naive);
  return new Date(naive - offsetMs(first)).toISOString();
}

/** Fecha de hoy (AAAA-MM-DD) en la zona de la clínica. */
export const hoyEnClinica = (ahora: Date = new Date()) => enHoraClinica(ahora).fecha;

/** Domingo según el calendario, sin depender de la zona del navegador. */
export function esDomingo(fecha: string) {
  const [year, month, day] = fecha.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

/** Indica si un bloque (fecha y minutos de la clínica) ya empezó en el instante `ahora`. */
export function yaPaso(fecha: string, minutos: number, ahora: Date = new Date()) {
  const actual = enHoraClinica(ahora);
  return fecha < actual.fecha || (fecha === actual.fecha && minutos < actual.minutos);
}

/** Rango legible de una cita en la hora de la clínica: «09:00 a 10:00». */
export function rangoLegible(inicio: string, fin: string) {
  return `${minutosAHora(enHoraClinica(inicio).minutos)} a ${minutosAHora(enHoraClinica(fin).minutos)}`;
}

/**
 * Primer día de la semana: lunes, la misma constante y el mismo motivo que
 * apps/api/src/modules/citas/horario.ts (semana ISO-8601 y semana laboral de la clínica,
 * PG-PLI-003 2.6). El servidor no resuelve "semana" ni "mes": recibe `desde` y `hasta` ya
 * calculados, así que la cuenta se repite aquí. 0 = domingo … 6 = sábado.
 */
export const PRIMER_DIA_SEMANA = 1;

/** Día de la semana (0 = domingo) de una fecha AAAA-MM-DD, sin depender de la zona del navegador. */
function diaSemana(fecha: string) {
  const [year, month, day] = fecha.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Suma (o resta) días de calendario a una fecha AAAA-MM-DD, en UTC. */
export function sumarDias(fecha: string, dias: number) {
  const [year, month, day] = fecha.split('-').map(Number);
  const resultado = new Date(Date.UTC(year, month - 1, day + dias));
  return `${resultado.getUTCFullYear()}-${pad(resultado.getUTCMonth() + 1)}-${pad(resultado.getUTCDate())}`;
}

export type CitaPeriodoFiltro = 'todo' | 'dia' | 'semana' | 'mes';

/**
 * Rango [desde, hasta] (ambas fechas incluidas) de un periodo de RF 5.2.3 alrededor de `fecha`.
 * `desde`/`hasta` van directo al query de GET /citas; el servidor los interpreta en
 * CLINIC_TIME_ZONE (ver citaListQuerySchema). Para "todo" no hay rango: devuelve null.
 */
export function rangoDelPeriodo(periodo: CitaPeriodoFiltro, fecha: string) {
  if (periodo === 'todo') return null;
  if (periodo === 'dia') return { desde: fecha, hasta: fecha };
  if (periodo === 'semana') {
    const offset = (diaSemana(fecha) - PRIMER_DIA_SEMANA + 7) % 7;
    const desde = sumarDias(fecha, -offset);
    return { desde, hasta: sumarDias(desde, 6) };
  }
  const [year, month] = fecha.split('-');
  const ultimoDia = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return { desde: `${year}-${month}-01`, hasta: `${year}-${month}-${pad(ultimoDia)}` };
}
