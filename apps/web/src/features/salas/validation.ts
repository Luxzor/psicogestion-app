import type { Sala, SalaPayload, SalaUpdatePayload } from './types';

/**
 * EDT 5.2.1. Reglas del nombre de la sala en el cliente (PG-DSN-003 4.5 y 5.3; RF 4.1.3). Son las
 * mismas del servidor (apps/api/src/modules/salas/schemas.ts): se recorta, se colapsan los
 * espacios internos repetidos y debe quedar de 1 a 10 caracteres. La unicidad la decide el
 * servidor (409 NOMBRE_SALA_EN_USO). Los textos siguen la maqueta PG-DSN-003-INT v0.1.0.
 */
export const SALA_NOMBRE_MAX = 10;

export const SALA_MENSAJES = {
  vacio: 'Escribe el nombre de la sala.',
  largo: (largo: number) => `El nombre puede tener máximo 10 caracteres; tiene ${largo}.`,
  hint: 'De 1 a 10 caracteres.',
  enUso: 'Ya existe una sala con ese nombre.',
  conCitas: (n: number) =>
    `No se puede dar de baja: tiene ${n} ${n === 1 ? 'cita pendiente' : 'citas pendientes'}. Reubícalas o cancélalas primero.`,
} as const;

/** Normalización que también aplica el servidor. */
export const normalizeSalaNombre = (value: string) => value.trim().replace(/\s+/g, ' ');

/** Mensaje de error del nombre o cadena vacía si es válido. */
export function validateSalaNombre(value: string) {
  const nombre = normalizeSalaNombre(value);
  if (!nombre) return SALA_MENSAJES.vacio;
  if (nombre.length > SALA_NOMBRE_MAX) return SALA_MENSAJES.largo(nombre.length);
  return '';
}

/** Clave de comparación de nombres: igual que el índice uq_sala_nombre (sin mayúsculas). */
export const salaNombreKey = (value: string) => normalizeSalaNombre(value).toLowerCase();

export const toSalaPayload = (nombre: string): SalaPayload => ({
  nombre: normalizeSalaNombre(nombre),
});

/**
 * Cuerpo del cambio de nombre, o null si el nombre normalizado no cambió (el botón Guardar se
 * habilita solo con diferencias, como en pacientes y terapeutas).
 */
export function toSalaUpdatePayload(sala: Sala, nombre: string): SalaUpdatePayload | null {
  const normalized = normalizeSalaNombre(nombre);
  if (normalized === sala.nombre) return null;
  return { nombre: normalized, version: sala.version };
}

/** Solo una sala activa puede ofrecerse al agendar (CA-4.2-01). */
export const isSalaAssignable = (sala: Pick<Sala, 'activo'>) => Boolean(sala.activo);

/** Paleta cromática para identificación visual de salas en selector (PG-DSN-003-INT). */
export const SALA_PALETTE = [
  '#002e5f',
  '#c79316',
  '#2f6f6a',
  '#7a3e5c',
  '#4f6db0',
  '#8a5a2b',
  '#3f7d3a',
  '#a04a2a',
  '#5a4fa0',
  '#2b6c8f',
] as const;

export const getSalaColor = (index: number) => SALA_PALETTE[index % SALA_PALETTE.length];

export const isoDe = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const fechaDeIso = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDias = (iso: string, n: number): string => {
  const d = fechaDeIso(iso);
  d.setDate(d.getDate() + n);
  return isoDe(d);
};

export const hhmm = (minutos: number): string =>
  `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;

export const durTxt = (minutos: number): string => {
  if (minutos < 60) return `${minutos} min`;
  if (minutos % 60) return `${Math.floor(minutos / 60)} h ${minutos % 60} min`;
  return `${minutos / 60} h`;
};

export const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

export const fmtF = (iso: string, options: Intl.DateTimeFormatOptions): string =>
  cap(new Intl.DateTimeFormat('es-MX', options).format(fechaDeIso(iso)));

export const fLarga = (iso: string): string =>
  fmtF(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const fMedia = (iso: string): string =>
  fmtF(iso, { weekday: 'short', day: 'numeric', month: 'short' });

export const fCorta = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export const INI_MINUTOS = 7 * 60;
export const FIN_MINUTOS = 17 * 60;
export const BLOQUE_INTERVALO = 30;

export const BLOQUES: readonly number[] = Array.from(
  { length: (FIN_MINUTOS - INI_MINUTOS) / BLOQUE_INTERVALO },
  (_, i) => INI_MINUTOS + i * BLOQUE_INTERVALO,
);

export const esPasado = (
  fecha: string,
  min: number,
  ahora: Date = new Date(),
): boolean => {
  const hoyIso = isoDe(ahora);
  const ahoraMin = ahora.getHours() * 60 + ahora.getMinutes();
  return fecha < hoyIso || (fecha === hoyIso && min < ahoraMin);
};
