/**
 * EDT 5.2.1. Modelo de datos de citas en el cliente (PG-DSN-003 4.3.2 y contrato de 5.7). Refleja
 * la tabla cita de db/migrations/0009_sala_cita.sql y las respuestas de /api/v1/citas que
 * construirán las tareas 5.3.2 a 5.3.6. La cita no trae CURP, teléfono ni correo del paciente
 * (PG-DSN-003 4.6, R01).
 */

/** RF 5.2.2: estados de la cita, en el orden del tipo cita_estado de la base. */
export const CITA_ESTADOS = ['Pendiente', 'Cancelada', 'Vencida'] as const;
export type CitaEstado = (typeof CITA_ESTADOS)[number];

export type CitaPersona = { id: string; nombre_completo: string };
export type CitaSala = { id: string; nombre: string };

export type Cita = {
  id: string;
  /** C + año de dos dígitos + 6 dígitos, por ejemplo C26000118 (ADR-17). */
  folio: string;
  estado: CitaEstado;
  /** Instantes en ISO 8601 (UTC); se muestran en la hora de la clínica. */
  inicio: string;
  fin: string;
  duracion_bloques: number;
  paciente: CitaPersona;
  terapeuta: CitaPersona;
  sala: CitaSala;
  cancelada_en: string | null;
  fecha_registro: string;
  version: number;
};

/** Resultado del envío de la confirmación por correo (RF 5.1.14 y 5.1.15, ADR-22). */
export type CitaConfirmacion =
  { enviada: true; destino: string } | { enviada: false; motivo: 'sin_correo' | 'fallo_envio' };

/** Respuesta del alta (POST /citas): la cita con su folio y el resultado del correo. */
export type CitaCreada = Cita & { confirmacion: CitaConfirmacion };

/** Cuerpo del alta (POST /citas, PG-DSN-003 5.7). No lleva estado ni folio. */
export type CitaPayload = {
  id_paciente: string;
  id_terapeuta: string;
  id_sala: string;
  /** ISO 8601 con zona, calculado con toInicioIso() de horario.ts. */
  inicio: string;
  duracion_bloques: number;
};

/** Cuerpo de la modificación (PATCH /citas/{id}): solo lo que cambió más la versión (ADR-23). */
export type CitaUpdatePayload = Partial<CitaPayload> & { estado?: CitaEstado; version: number };

/** Cuerpo de la cancelación (POST /citas/{id}/cancelar, ADR-20). */
export type CitaCancelPayload = { version: number };

/** Periodo del filtro de la lista (RF 5.2.3): día, semana o mes. */
export type CitaPeriodo = 'dia' | 'semana' | 'mes';

export type CitaListParams = {
  estado?: CitaEstado;
  id_sala?: string;
  id_terapeuta?: string;
  desde?: string;
  hasta?: string;
  folio?: string;
  pagina: number;
  tamano: number;
};

export type CitaListResponse = {
  datos: Cita[];
  pagina: number;
  tamano: number;
  total: number;
};

/** Valores del formulario de agendar y modificar (PG-DSN-003 5.4 y 5.5). */
export type CitaFormValues = {
  id_paciente: string;
  id_terapeuta: string;
  id_sala: string;
  /** Día en AAAA-MM-DD. */
  fecha: string;
  /** Minutos desde la medianoche en la hora de la clínica, o null si no se ha elegido. */
  inicio: number | null;
  /** Duración en minutos: 30, 60, 90 o 120. */
  duracion: number;
};

export type CitaFieldKey = 'id_paciente' | 'id_terapeuta' | 'id_sala' | 'fecha' | 'inicio';

export type CitaFormErrors = Partial<Record<CitaFieldKey, string>>;

/** Códigos de error del modelo de citas y salas (PG-DSN-003 5.7.1). */
export type CitaErrorCode =
  | 'HORARIO_INVALIDO'
  | 'CITA_EN_EL_PASADO'
  | 'PACIENTE_NO_ENCONTRADO'
  | 'TERAPEUTA_NO_ENCONTRADO'
  | 'SALA_NO_ENCONTRADA'
  | 'CITA_NO_ENCONTRADA'
  | 'PACIENTE_INACTIVO_NO_ASIGNABLE'
  | 'TERAPEUTA_INACTIVO_NO_ASIGNABLE'
  | 'SALA_INACTIVA'
  | 'SALA_OCUPADA'
  | 'TERAPEUTA_OCUPADO'
  | 'PACIENTE_OCUPADO'
  | 'CITA_NO_MODIFICABLE'
  | 'CITA_YA_CANCELADA'
  | 'CONFLICTO_VERSION';
