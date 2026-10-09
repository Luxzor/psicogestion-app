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

export type InactivePatient = { id: string; nombre_completo: string; fecha_baja: string | null };

export type Availability = {
  campo: 'curp' | 'telefono';
  disponible: boolean;
  dado_de_baja?: boolean;
  mensaje?: string;
};

export type Flash = { type: 'success' | 'error'; text: string };
