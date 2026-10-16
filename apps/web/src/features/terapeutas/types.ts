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

/** Entrega de la fotografía (EDT 4.3.5, PG-DSN-002 5.12.2): perfil o miniatura. */
export type PhotoSize = 'perfil' | 'miniatura';

/**
 * Elemento del listado (PG-DSN-002 5.12.4): a diferencia de paciente, incluye cédula y correo,
 * tal como los muestra la lista de terapeutas (5.7).
 */
export type TherapistListItem = {
  id: string;
  nombre_completo: string;
  cedula_profesional: string;
  telefono: string;
  correo_electronico: string;
  foto_actualizada_en: string | null;
  activo: boolean;
};

/** Filtro de la lista por estado (EDT 4.3.5): terapeutas activos o dados de baja. */
export type TherapistListState = 'activos' | 'inactivos';

export type TherapistListParams = {
  pagina: number;
  tamano: number;
  q?: string;
  estado?: TherapistListState;
};

export type TherapistListResponse = {
  datos: TherapistListItem[];
  pagina: number;
  tamano: number;
  total: number;
};

/** Cuerpo del PATCH: solo los campos modificados más la versión leída (ADR-10). */
export type TherapistUpdatePayload = Partial<TherapistPayload> & { version: number };
