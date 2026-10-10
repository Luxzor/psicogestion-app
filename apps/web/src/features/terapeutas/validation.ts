import type { TherapistFieldKey, TherapistFormValues, TherapistPayload } from './types';

export const PHONE_PATTERN = /^[0-9]{10}$/;
export const CEDULA_PATTERN = /^[0-9]{7,8}$/;
export const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export const NAME_MAX = 50;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
export const MIN_PHOTO_DIMENSION = 200; // 200 px

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

/** Aplica la máscara dd/mm/aaaa mientras se escribe. */
export function maskDate(text: string) {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

/** Normaliza lo que se escribe en cada campo. */
export function normalizeInput(field: TherapistFieldKey, value: string) {
  switch (field) {
    case 'telefono':
    case 'cedula':
      return value.replace(/\D/g, '');
    case 'fechaNacimiento':
      return maskDate(value);
    default:
      return value;
  }
}

/** Mensaje de formato del campo o cadena vacía si es válido. */
export function validateField(
  field: TherapistFieldKey,
  values: TherapistFormValues,
  today = todayIso(),
) {
  const value = values[field].trim();
  switch (field) {
    case 'nombre': {
      const collapsed = value.replace(/\s+/g, ' ');
      if (!collapsed) return 'Escribe el nombre completo.';
      if (collapsed.length > NAME_MAX) return 'El nombre no puede tener más de 50 caracteres.';
      return '';
    }
    case 'telefono':
      if (!value) return 'Escribe el teléfono.';
      if (!PHONE_PATTERN.test(value)) return 'El teléfono debe tener exactamente 10 dígitos.';
      return '';
    case 'correo':
      if (!value) return 'Escribe el correo electrónico.';
      if (value.length > 100) return 'El correo no puede tener más de 100 caracteres.';
      if (!EMAIL_PATTERN.test(value.toLowerCase())) {
        return 'Escribe un correo con formato válido, por ejemplo nombre@dominio.mx.';
      }
      return '';
    case 'fechaNacimiento': {
      if (!value) return 'Escribe la fecha de nacimiento.';
      const parsed = parseDisplayDate(value);
      if (parsed.error === 'formato') return 'Escribe la fecha como dd/mm/aaaa.';
      if (parsed.error || !parsed.iso) return 'Esa fecha no existe en el calendario.';
      if (parsed.iso >= today) return 'La fecha de nacimiento debe ser anterior a hoy.';
      return '';
    }
    case 'cedula':
      if (!value) return 'Escribe la cédula profesional.';
      if (!CEDULA_PATTERN.test(value)) return 'La cédula debe tener 7 u 8 dígitos.';
      return '';
  }
}

/** Valida tamaño, formato y dimensiones de la fotografía en el cliente (RF 2.1.11 a 2.1.13, CA-2.1-05). */
export async function validatePhoto(
  file: File,
): Promise<{ error?: string; width?: number; height?: number }> {
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    return { error: 'Usa una fotografía JPEG o PNG.' };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { error: 'La fotografía no puede pesar más de 5 MB.' };
  }

  let width = 0;
  let height = 0;

  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close?.();
    } else {
      // Fallback para entornos donde createImageBitmap no está disponible (ej. jsdom)
      const url = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          width = img.naturalWidth || img.width;
          height = img.naturalHeight || img.height;
          URL.revokeObjectURL(url);
          resolve();
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('No se pudo cargar la imagen'));
        };
        img.src = url;
      });
    }
  } catch {
    return { error: 'Usa una fotografía JPEG o PNG.' };
  }

  if (width < MIN_PHOTO_DIMENSION || height < MIN_PHOTO_DIMENSION) {
    return {
      error: `La fotografía debe medir al menos ${MIN_PHOTO_DIMENSION} x ${MIN_PHOTO_DIMENSION} píxeles (la tuya mide ${width} x ${height}).`,
      width,
      height,
    };
  }

  return { width, height };
}

export function toPayload(values: TherapistFormValues): TherapistPayload {
  const correo = values.correo.trim().toLowerCase();
  return {
    nombre_completo: values.nombre.trim().replace(/\s+/g, ' '),
    telefono: values.telefono.trim(),
    correo_electronico: correo,
    fecha_nacimiento: parseDisplayDate(values.fechaNacimiento.trim()).iso ?? '',
    cedula_profesional: values.cedula.trim(),
  };
}
