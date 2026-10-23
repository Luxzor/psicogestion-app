/**
 * EDT 5.2.1. Modelo de datos de salas en el cliente (PG-DSN-003 4.3.1 y contrato de 5.7). Refleja
 * la tabla sala de db/migrations/0009_sala_cita.sql y las respuestas de /api/v1/salas que
 * construirán las tareas 5.3.1 y 5.3.2.
 */

export type Sala = {
  id: string;
  nombre: string;
  activo: boolean;
  /** Día de la baja en la zona de la clínica (AAAA-MM-DD) o null si está activa. */
  fecha_baja: string | null;
  fecha_registro: string;
  version: number;
};

/** Cuerpo del alta (POST /salas): solo el nombre (RF 4.1.2). */
export type SalaPayload = { nombre: string };

/** Cuerpo del cambio de nombre (PATCH /salas/{id}) con la versión leída (ADR-23). */
export type SalaUpdatePayload = SalaPayload & { version: number };

export type SalaResponse = { codigo: string; sala: Sala };

export type SalaAvailability = {
  campo: 'nombre';
  disponible: boolean;
  mensaje?: string;
};

/** Filtro del listado por estado (PG-DSN-003 5.2): por defecto solo activas. */
export type SalaListState = 'activas' | 'inactivas' | 'todas';

export type SalaListParams = { q?: string; estado?: SalaListState };

/** Estado de un bloque en la rejilla de disponibilidad (RF 4.3.3 y 5.7). */
export type BloqueEstado = 'libre' | 'reservada' | 'no_disponible';

export type BloqueSala = {
  /** Instante en ISO 8601. */
  inicio: string;
  estado: BloqueEstado;
  /** Folio de la cita que ocupa el bloque, si está reservado. */
  folio?: string;
};

/** Cita que ocupa un horario en el día de la sala (RF 4.3.2, PG-DSN-003-INT). */
export type CitaSalaDia = {
  id: string;
  folio: string;
  estado: 'Pendiente' | 'Cancelada' | 'Vencida';
  inicio: string;
  fin: string;
  ini_minutos: number;
  fin_minutos: number;
  paciente: { id: string; nombre_completo: string };
  terapeuta: { id: string; nombre_completo: string; activo?: boolean };
  sala: { id: string; nombre: string };
};

export type DisponibilidadSala = {
  id: string;
  nombre: string;
  activo?: boolean;
  bloques: BloqueSala[];
  citas?: CitaSalaDia[];
  total_citas?: number;
  bloques_ocupados?: number;
};

/** Respuesta de GET /salas/disponibilidad (PG-DSN-003 5.7). */
export type Disponibilidad = {
  fecha: string;
  bloques: Array<{ inicio: string; fin: string }>;
  salas: DisponibilidadSala[];
};

export type DisponibilidadParams = {
  fecha: string;
  id_terapeuta?: string;
  id_paciente?: string;
  duracion?: number;
};
