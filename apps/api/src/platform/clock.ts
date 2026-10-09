import { env } from '../config/env.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fecha del día (YYYY-MM-DD) en la zona horaria de la clínica. */
export function todayInClinic(now = new Date(), timeZone = env.CLINIC_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Devuelve los componentes de una fecha ISO si existe en el calendario. */
export function parseIsoDate(value: string) {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Años cumplidos en la fecha de referencia; ambas fechas en formato ISO válido. */
export function ageOn(birthDate: string, referenceDate: string) {
  const birth = parseIsoDate(birthDate);
  const reference = parseIsoDate(referenceDate);
  if (!birth || !reference) return Number.NaN;
  let age = reference.year - birth.year;
  if (
    reference.month < birth.month ||
    (reference.month === birth.month && reference.day < birth.day)
  ) {
    age -= 1;
  }
  return age;
}
