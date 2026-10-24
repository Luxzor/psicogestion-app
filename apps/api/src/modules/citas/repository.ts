import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { db } from '../../platform/db.js';
import { lockClause, type RowLock } from '../salas/repository.js';
import { BLOQUE_MINUTOS } from './horario.js';
import type { CitaEstado } from './schemas.js';

type Queryable = Pick<PoolClient, 'query'>;

/**
 * EDT 5.2.1. Acceso a la tabla cita (PG-DSN-003 4.3.2). El repositorio solo persiste; los
 * servicios de la EDT 5.3 aplican las reglas (verificar la rejilla, bloquear los recursos con
 * FOR SHARE, decidir el código de error) y traducen las violaciones de restricciones con
 * citaDatabaseError() de errors.ts.
 *
 * Privacidad (PG-DSN-003 4.6, R01): la cita no copia datos personales; las consultas solo unen el
 * nombre del paciente y del terapeuta, nunca el CURP, el teléfono ni el correo.
 */
export type CitaRecord = {
  id: string;
  folio: string;
  estado: CitaEstado;
  /** Instantes en ISO 8601 (UTC). */
  inicio: string;
  fin: string;
  duracion_bloques: number;
  paciente: { id: string; nombre_completo: string };
  terapeuta: { id: string; nombre_completo: string };
  sala: { id: string; nombre: string };
  cancelada_en: string | null;
  fecha_registro: string;
  version: number;
};

/** Estado mínimo para control de versión, modificación y cancelación. */
export type CitaSummary = {
  id: string;
  folio: string;
  estado: CitaEstado;
  id_paciente: string;
  id_terapeuta: string;
  id_sala: string;
  inicio: Date;
  fin: Date;
  version: number;
};

/** Cita que ocupa un horario en la rejilla de disponibilidad (RF 4.3.2, RF 5.1.3). */
export type CitaOcupacion = {
  id: string;
  folio: string;
  estado: CitaEstado;
  id_sala: string;
  sala_nombre: string;
  id_terapeuta: string;
  terapeuta_nombre: string;
  terapeuta_activo: boolean;
  id_paciente: string;
  paciente_nombre: string;
  inicio: Date;
  fin: Date;
};

/** Datos de la cita para insertar; `fin` lo calcula el servicio con calcularFin() (ADR-15). */
export type NuevaCita = {
  id_paciente: string;
  id_terapeuta: string;
  id_sala: string;
  inicio: Date;
  fin: Date;
};

export type CambiosCita = Partial<NuevaCita>;

/** Columnas que una modificación puede escribir, en lista blanca (nunca desde el cuerpo). */
const CHANGEABLE_COLUMNS = ['id_paciente', 'id_terapeuta', 'id_sala', 'inicio', 'fin'] as const;

/** Recursos de una cita y si siguen activos, leídos con bloqueo compartido (ADR-21). */
export type Asignables = {
  paciente?: { id: string; activo: boolean; correo: string | null } | null;
  terapeuta?: { id: string; activo: boolean } | null;
  sala?: { id: string; activo: boolean } | null;
};

type CitaRow = {
  id: string;
  folio: string;
  estado: CitaEstado;
  inicio: Date;
  fin: Date;
  cancelada_en: Date | null;
  fecha_registro: string;
  version: number;
  paciente_id: string;
  paciente_nombre: string;
  terapeuta_id: string;
  terapeuta_nombre: string;
  sala_id: string;
  sala_nombre: string;
};

const clinicZone = `'${env.CLINIC_TIME_ZONE.replace(/'/g, "''")}'`;

/** Columnas de la cita con alias `c` y sus uniones con alias `p`, `t` y `s`. */
const citaFields = `
  c.id,
  c.folio,
  c.estado,
  c.inicio,
  c.fin,
  c.cancelada_en,
  to_char(c.created_at AT TIME ZONE ${clinicZone}, 'YYYY-MM-DD') AS fecha_registro,
  c.version,
  p.id AS paciente_id,
  p.nombre_completo AS paciente_nombre,
  t.id AS terapeuta_id,
  t.nombre_completo AS terapeuta_nombre,
  s.id AS sala_id,
  s.nombre AS sala_nombre`;

const citaJoins = `
  JOIN paciente p ON p.id = c.id_paciente
  JOIN terapeuta t ON t.id = c.id_terapeuta
  JOIN sala s ON s.id = c.id_sala`;

const BLOQUE_MS = BLOQUE_MINUTOS * 60_000;

export function toCitaRecord(row: CitaRow): CitaRecord {
  return {
    id: row.id,
    folio: row.folio,
    estado: row.estado,
    inicio: row.inicio.toISOString(),
    fin: row.fin.toISOString(),
    duracion_bloques: Math.round((row.fin.getTime() - row.inicio.getTime()) / BLOQUE_MS),
    paciente: { id: row.paciente_id, nombre_completo: row.paciente_nombre },
    terapeuta: { id: row.terapeuta_id, nombre_completo: row.terapeuta_nombre },
    sala: { id: row.sala_id, nombre: row.sala_nombre },
    cancelada_en: row.cancelada_en ? row.cancelada_en.toISOString() : null,
    fecha_registro: row.fecha_registro,
    version: row.version,
  };
}

const summaryFields = `
  id, folio, estado, id_paciente, id_terapeuta, id_sala, inicio, fin, version`;

/**
 * Campos mínimos del listado (RF 5.2, R01: "las listas muestran el mínimo de datos"): sin
 * duracion_bloques, cancelada_en, fecha_registro ni version, que no aportan a la lista y aquí
 * solo ampliarían la respuesta sin necesidad.
 */
const citaListFields = `
  c.id,
  c.folio,
  c.estado,
  c.inicio,
  c.fin,
  p.id AS paciente_id,
  p.nombre_completo AS paciente_nombre,
  t.id AS terapeuta_id,
  t.nombre_completo AS terapeuta_nombre,
  s.id AS sala_id,
  s.nombre AS sala_nombre`;

type CitaListRow = {
  id: string;
  folio: string;
  estado: CitaEstado;
  inicio: Date;
  fin: Date;
  paciente_id: string;
  paciente_nombre: string;
  terapeuta_id: string;
  terapeuta_nombre: string;
  sala_id: string;
  sala_nombre: string;
};

export type CitaListItem = {
  id: string;
  folio: string;
  estado: CitaEstado;
  inicio: string;
  fin: string;
  paciente: { id: string; nombre_completo: string };
  terapeuta: { id: string; nombre_completo: string };
  sala: { id: string; nombre: string };
};

function toCitaListItem(row: CitaListRow): CitaListItem {
  return {
    id: row.id,
    folio: row.folio,
    estado: row.estado,
    inicio: row.inicio.toISOString(),
    fin: row.fin.toISOString(),
    paciente: { id: row.paciente_id, nombre_completo: row.paciente_nombre },
    terapeuta: { id: row.terapeuta_id, nombre_completo: row.terapeuta_nombre },
    sala: { id: row.sala_id, nombre: row.sala_nombre },
  };
}

/** Filtros del listado (GET /citas, RF 5.2.1–5.2.3). `desde`/`hasta` ya son instantes UTC. */
export type CitaListFiltros = {
  estado?: CitaEstado;
  id_sala?: string;
  id_terapeuta?: string;
  desde?: Date;
  hasta?: Date;
  folio?: string;
  pagina: number;
  tamano: number;
};

export type CitaListResultado = { datos: CitaListItem[]; total: number };

export const citaRepository = {
  async findById(id: string, client: Queryable = db) {
    const result = await client.query<CitaRow>(
      `SELECT ${citaFields} FROM cita c ${citaJoins} WHERE c.id = $1`,
      [id],
    );
    return result.rows[0] ? toCitaRecord(result.rows[0]) : null;
  },

  /** Búsqueda por folio (RF 5.4.2); el folio llega ya normalizado en mayúsculas. */
  async findByFolio(folio: string, client: Queryable = db) {
    const result = await client.query<CitaRow>(
      `SELECT ${citaFields} FROM cita c ${citaJoins} WHERE c.folio = $1`,
      [folio],
    );
    return result.rows[0] ? toCitaRecord(result.rows[0]) : null;
  },

  async findSummaryById(id: string, client: Queryable = db, lock: RowLock = false) {
    const result = await client.query<CitaSummary>(
      `SELECT ${summaryFields} FROM cita WHERE id = $1 ${lockClause(lock)}`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  /**
   * ADR-21: lee paciente, terapeuta y sala con SELECT ... FOR SHARE dentro de la transacción del
   * alta o la modificación. Si otra persona da de baja a uno de ellos al mismo tiempo, esta lectura
   * espera a que termine y ve el estado final, de modo que nunca se asigna un recurso inactivo.
   * Solo consulta los recursos indicados; un recurso inexistente vuelve como null. El correo del
   * paciente se lee solo para decidir el envío de la confirmación (RF 5.1.14 y 5.1.15).
   */
  async lockAssignables(
    ids: { id_paciente?: string; id_terapeuta?: string; id_sala?: string },
    client: Queryable,
  ): Promise<Asignables> {
    const asignables: Asignables = {};
    if (ids.id_paciente) {
      const result = await client.query<{ id: string; activo: boolean; correo: string | null }>(
        'SELECT id, activo, correo FROM paciente WHERE id = $1 FOR SHARE',
        [ids.id_paciente],
      );
      asignables.paciente = result.rows[0] ?? null;
    }
    if (ids.id_terapeuta) {
      const result = await client.query<{ id: string; activo: boolean }>(
        'SELECT id, activo FROM terapeuta WHERE id = $1 FOR SHARE',
        [ids.id_terapeuta],
      );
      asignables.terapeuta = result.rows[0] ?? null;
    }
    if (ids.id_sala) {
      const result = await client.query<{ id: string; activo: boolean }>(
        'SELECT id, activo FROM sala WHERE id = $1 FOR SHARE',
        [ids.id_sala],
      );
      asignables.sala = result.rows[0] ?? null;
    }
    return asignables;
  },

  /**
   * Alta de una cita Pendiente (RF 5.1.11). La base asigna el folio con cita_folio_seq en la
   * misma sentencia (ADR-17, RNF 5.1.2) y la devuelve unida a los nombres en un solo viaje. Si el
   * horario se empalma, la sentencia falla con 23P01 (ADR-16).
   */
  async create(data: NuevaCita, userId: string, client: Queryable = db) {
    const result = await client.query<CitaRow>(
      `WITH c AS (
         INSERT INTO cita (id_paciente, id_terapeuta, id_sala, inicio, fin, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING *
       )
       SELECT ${citaFields} FROM c ${citaJoins}`,
      [data.id_paciente, data.id_terapeuta, data.id_sala, data.inicio, data.fin, userId],
    );
    return toCitaRecord(result.rows[0]);
  },

  /**
   * Modificación con control de versión optimista (RF 5.3, ADR-23): un solo UPDATE condicionado a
   * la versión leída y a que la cita siga Pendiente. Si no afecta ninguna fila, el servicio
   * averigua la causa (no existe, cambió de versión o ya no es modificable).
   */
  async update(
    id: string,
    changes: CambiosCita,
    version: number,
    userId: string,
    client: Queryable = db,
  ) {
    const params: unknown[] = [id, version, userId];
    const assignments = CHANGEABLE_COLUMNS.filter((column) => changes[column] !== undefined).map(
      (column) => {
        params.push(changes[column]);
        return `${column} = $${params.length}`;
      },
    );

    const result = await client.query<CitaRow>(
      `WITH c AS (
         UPDATE cita SET
           ${[
             ...assignments,
             'version = version + 1',
             'updated_at = now()',
             'updated_by = $3',
           ].join(',\n           ')}
         WHERE id = $1 AND version = $2 AND estado = 'Pendiente'
         RETURNING *
       )
       SELECT ${citaFields} FROM c ${citaJoins}`,
      params,
    );
    return result.rows[0] ? toCitaRecord(result.rows[0]) : null;
  },

  /**
   * Cancelación (RF 5.4, ADR-20): no borra la cita; pasa a Cancelada con la fecha y la persona.
   * Como las restricciones EXCLUDE solo aplican a Pendientes, el horario queda libre de inmediato.
   */
  async cancel(id: string, version: number, userId: string, client: Queryable = db) {
    const result = await client.query<CitaRow>(
      `WITH c AS (
         UPDATE cita SET
           estado = 'Cancelada',
           cancelada_en = now(),
           cancelada_por = $3,
           version = version + 1,
           updated_at = now(),
           updated_by = $3
         WHERE id = $1 AND version = $2 AND estado = 'Pendiente'
         RETURNING *
       )
       SELECT ${citaFields} FROM c ${citaJoins}`,
      [id, version, userId],
    );
    return result.rows[0] ? toCitaRecord(result.rows[0]) : null;
  },

  /**
   * ADR-18: marca como Vencida toda cita Pendiente cuyo fin ya pasó. Es idempotente y se ejecuta
   * antes de listar o de consultar disponibilidad, sin tarea programada. Sube la versión para que
   * una modificación abierta en otra pestaña detecte el cambio. Devuelve cuántas citas cambió.
   */
  async markExpired(ahora: Date = new Date(), client: Queryable = db) {
    const result = await client.query(
      `UPDATE cita SET
         estado = 'Vencida',
         version = version + 1,
         updated_at = now()
       WHERE estado = 'Pendiente' AND fin <= $1`,
      [ahora],
    );
    return result.rowCount ?? 0;
  },

  /**
   * Citas que ocupan horario entre dos instantes (RF 4.3.2 y RF 5.1.3): las Pendientes y las
   * Vencidas, que siguen ocupando el pasado (ADR-18). Las Canceladas liberan su horario. Se apoya
   * en idx_cita_inicio.
   */
  async occupiedBetween(desde: Date, hasta: Date, client: Queryable = db) {
    const result = await client.query<CitaOcupacion>(
      `SELECT c.id, c.folio, c.estado, c.id_sala, s.nombre AS sala_nombre,
              c.id_terapeuta, t.nombre_completo AS terapeuta_nombre, t.activo AS terapeuta_activo,
              c.id_paciente, p.nombre_completo AS paciente_nombre, c.inicio, c.fin
       FROM cita c
       JOIN terapeuta t ON t.id = c.id_terapeuta
       JOIN paciente p ON p.id = c.id_paciente
       JOIN sala s ON s.id = c.id_sala
       WHERE c.estado <> 'Cancelada' AND c.inicio < $2 AND c.fin > $1
       ORDER BY c.inicio ASC, c.folio ASC`,
      [desde, hasta],
    );
    return result.rows;
  },

  /**
   * RF 5.2.1–5.2.3, RNF 5.1.4. Listado paginado con filtros opcionales por estado, sala,
   * terapeuta, periodo (desde/hasta, ya convertidos a instantes) y folio (coincidencia exacta).
   * El total sale de la misma consulta (count(*) OVER()) para no duplicar el viaje a la base.
   * Se apoya en idx_cita_estado_inicio, idx_cita_sala_inicio, idx_cita_terapeuta_inicio,
   * idx_cita_inicio y uq_cita_folio según los filtros presentes.
   */
  async list(filtros: CitaListFiltros, client: Queryable = db): Promise<CitaListResultado> {
    const params: unknown[] = [];
    const condiciones: string[] = [];
    const filtrar = (columna: string, valor: unknown) => {
      params.push(valor);
      condiciones.push(`${columna} = $${params.length}`);
    };

    if (filtros.estado) filtrar('c.estado', filtros.estado);
    if (filtros.id_sala) filtrar('c.id_sala', filtros.id_sala);
    if (filtros.id_terapeuta) filtrar('c.id_terapeuta', filtros.id_terapeuta);
    if (filtros.folio) filtrar('c.folio', filtros.folio);
    if (filtros.desde) {
      params.push(filtros.desde);
      condiciones.push(`c.inicio >= $${params.length}`);
    }
    if (filtros.hasta) {
      params.push(filtros.hasta);
      condiciones.push(`c.inicio < $${params.length}`);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    params.push(filtros.tamano, (filtros.pagina - 1) * filtros.tamano);
    const result = await client.query<CitaListRow & { total: string }>(
      `SELECT ${citaListFields}, count(*) OVER() AS total
       FROM cita c ${citaJoins}
       ${where}
       ORDER BY c.inicio ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const total = result.rows[0] ? Number(result.rows[0].total) : 0;
    return { datos: result.rows.map(toCitaListItem), total };
  },
};
