export type FieldKey = 'nombre' | 'curp' | 'sexo' | 'fechaNacimiento' | 'telefono' | 'correo';

export type PatientFormValues = Record<FieldKey, string>;

export type Sexo = 'F' | 'M' | 'O';

export type PatientPayload = {
  nombre_completo: string;
  curp: string;
  sexo: Sexo;
  fecha_nacimiento: string;
  telefono: string;
  correo: string | null;
  consentimiento: boolean;
};

export type Patient = Omit<PatientPayload, 'correo'> & {
  id: string;
  correo: string | null;
  activo: boolean;
  fecha_baja: string | null;
  fecha_registro: string;
  version: number;
};

/** Perfil completo (RF 3.2.3); el servidor agrega la edad calculada y el sello de cambio. */
export type PatientProfile = Patient & { edad: number; updated_at: string };

/** Cuerpo del PATCH: solo los campos modificados más la versión leída (ADR-10). */
export type PatientUpdatePayload = Partial<PatientPayload> & { version: number };

/**
 * Elemento del listado. El servidor no envía CURP ni correo en la lista (minimización de
 * datos, R01 y PG-DSN-002 §5.4).
 */
export type PatientListItem = {
  id: string;
  nombre_completo: string;
  telefono: string;
  edad: number;
  activo: boolean;
};

/** Filtro de la lista por estado (EDT 4.3.3): pacientes activos o dados de baja. */
export type PatientListState = 'activos' | 'inactivos';

export type PatientListParams = {
  pagina: number;
  tamano: number;
  q?: string;
  estado?: PatientListState;
};

export type PatientListResponse = {
  datos: PatientListItem[];
  pagina: number;
  tamano: number;
  total: number;
};

export type InactivePatient = { id: string; nombre_completo: string; fecha_baja: string | null };

export type Availability = {
  campo: 'curp' | 'telefono';
  disponible: boolean;
  dado_de_baja?: boolean;
  mensaje?: string;
};

export type Flash = { type: 'success' | 'error' | 'info'; text: string };
