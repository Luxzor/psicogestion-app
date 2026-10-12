export type TherapistFieldKey = 'nombre' | 'telefono' | 'correo' | 'fechaNacimiento' | 'cedula';

export type TherapistFormValues = Record<TherapistFieldKey, string>;

export type TherapistPayload = {
  nombre_completo: string;
  telefono: string;
  correo_electronico: string;
  fecha_nacimiento: string;
  cedula_profesional: string;
};

export type Therapist = TherapistPayload & {
  id: string;
  foto_perfil: string | null;
  foto_actualizada_en: string | null;
  activo: boolean;
  fecha_baja: string | null;
  fecha_registro: string;
  version: number;
};

export type PhotoData = {
  file: File;
  previewUrl: string;
  name: string;
  width: number;
  height: number;
  size: number;
};

export type TherapistAvailability = {
  campo: 'telefono' | 'correo' | 'cedula';
  disponible: boolean;
  mensaje?: string;
};

export type Flash = { type: 'success' | 'error'; text: string };
