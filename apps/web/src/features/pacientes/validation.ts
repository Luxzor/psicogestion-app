import type { PatientFormValues, PatientPayload, FieldKey } from './types';

/** Reglas de PG-ERS-001 v0.6.1, sección 3.1; el servidor vuelve a validarlas (autoridad final). */
export const CURP_PATTERN =
  /^[A-Z][AEIOUX][A-Z]{2}[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9][0-9]$/;
const PHONE_PATTERN = /^[0-9]{10}$/;
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export const NAME_MAX = 50;
export const MINIMUM_AGE = 7;

export const SEXO_OPTIONS = [
  { value: 'F', label: 'Femenino' },
  { value: 'M', label: 'Masculino' },
  { value: 'O', label: 'Otro' },
] as const;

const pad = (value: number) => String(value).padStart(2, '0');

export const isoFromDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const displayFromIso = (iso: string) => {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}/${month}/${year}` : '';
};

export const todayIso = () => isoFromDate(new Date());

/** Convierte dd/mm/aaaa a AAAA-MM-DD; distingue formato inválido de fecha inexistente. */
export function parseDisplayDate(text: string) {
  const match = DATE_PATTERN.exec(text);
  if (!match) return { error: 'formato' as const };
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    year < 1900 ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return { error: 'inexistente' as const };
  }
  return { iso: `${year}-${pad(month)}-${pad(day)}` };
}

export function ageOn(birthIso: string, referenceIso: string) {
  const [by, bm, bd] = birthIso.split('-').map(Number);
  const [ry, rm, rd] = referenceIso.split('-').map(Number);
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;
  return age;
}

/** Aplica la máscara dd/mm/aaaa mientras se escribe. */
export function maskDate(text: string) {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

/** Normaliza lo que se escribe en cada campo. */
export function normalizeInput(field: FieldKey, value: string) {
  switch (field) {
    case 'curp':
      return value.toUpperCase().replace(/\s/g, '');
    case 'telefono':
      return value.replace(/\D/g, '');
    case 'fechaNacimiento':
      return maskDate(value);
    default:
      return value;
  }
}

/** Mensaje de formato del campo o cadena vacía si es válido. */
export function validateField(field: FieldKey, values: PatientFormValues, today = todayIso()) {
  const value = values[field].trim();
  switch (field) {
    case 'nombre': {
      const collapsed = value.replace(/\s+/g, ' ');
      if (!collapsed) return 'Escribe el nombre completo.';
      if (collapsed.length > NAME_MAX) return 'El nombre no puede tener más de 50 caracteres.';
      return '';
    }
    case 'curp':
      if (!value) return 'Escribe el CURP.';
      if (!CURP_PATTERN.test(value)) {
        return 'El CURP no tiene un formato válido. Debe tener 18 caracteres.';
      }
      return '';
    case 'sexo':
      return value ? '' : 'Selecciona el sexo.';
    case 'fechaNacimiento': {
      if (!value) return 'Escribe la fecha de nacimiento.';
      const parsed = parseDisplayDate(value);
      if (parsed.error === 'formato') return 'Escribe la fecha como dd/mm/aaaa.';
      if (parsed.error || !parsed.iso) return 'Esa fecha no existe en el calendario.';
      if (parsed.iso >= today) return 'La fecha de nacimiento debe ser anterior a hoy.';
      if (ageOn(parsed.iso, today) < MINIMUM_AGE) {
        return `El paciente debe tener al menos ${MINIMUM_AGE} años cumplidos.`;
      }
      return '';
    }
    case 'telefono':
      if (!value) return 'Escribe el teléfono.';
      if (!PHONE_PATTERN.test(value)) return 'El teléfono debe tener exactamente 10 dígitos.';
      return '';
    case 'correo':
      if (!value) return '';
      if (value.length > 100) return 'El correo no puede tener más de 100 caracteres.';
      if (!EMAIL_PATTERN.test(value.toLowerCase())) {
        return 'Escribe un correo con formato válido, por ejemplo nombre@dominio.mx.';
      }
      return '';
  }
}

export function toPayload(values: PatientFormValues, consentimiento: boolean): PatientPayload {
  const correo = values.correo.trim().toLowerCase();
  return {
    nombre_completo: values.nombre.trim().replace(/\s+/g, ' '),
    curp: values.curp.trim(),
    sexo: values.sexo as PatientPayload['sexo'],
    fecha_nacimiento: parseDisplayDate(values.fechaNacimiento.trim()).iso ?? '',
    telefono: values.telefono.trim(),
    correo: correo || null,
    consentimiento,
  };
}
