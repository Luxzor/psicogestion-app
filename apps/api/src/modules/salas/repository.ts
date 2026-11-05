import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { db } from '../../platform/db.js';

type Queryable = Pick<PoolClient, 'query'>;

/**
 * EDT 5.2.1. Acceso a la tabla sala (PG-DSN-003 4.3.1). El repositorio solo persiste: las reglas
 * de negocio (por ejemplo, rechazar la baja con citas pendientes, ADR-19) las aplica el servicio
 * de la EDT 5.3.1 apoyándose en estas consultas.
 */
export type SalaRecord = {
  id: string;
  nombre: string;
  activo: boolean;
  /** Día de la baja en la zona de la clínica (AAAA-MM-DD) o null si está activa. */
  fecha_baja: string | null;
  fecha_registro: string;
  version: number;
};

/** Estado mínimo para decidir sobre una operación (control de versión, baja y asignación). */
export type SalaSummary = Pick<SalaRecord, 'id' | 'activo' | 'version'>;

export type SalaListState = 'activas' | 'inactivas' | 'todas';

/** Bloqueo de fila: FOR UPDATE al modificar la sala, FOR SHARE al asignarla a una cita (ADR-21). */
export type RowLock = 'update' | 'share' | false;

export const lockClause = (lock: RowLock) =>
  lock === 'update' ? 'FOR UPDATE' : lock === 'share' ? 'FOR SHARE' : '';

/** Zona de la clínica como literal de SQL; env ya validó que es un nombre IANA. */
const clinicZone = `'${env.CLINIC_TIME_ZONE.replace(/'/g, "''")}'`;

const salaFields = `
  id,
  nombre,
  activo,
  to_char(fecha_baja AT TIME ZONE ${clinicZone}, 'YYYY-MM-DD') AS fecha_baja,
  to_char(created_at AT TIME ZONE ${clinicZone}, 'YYYY-MM-DD') AS fecha_registro,
  version`;

export const salaRepository = {
  async findById(id: string, client: Queryable = db) {
    const result = await client.query<SalaRecord>(`SELECT ${salaFields} FROM sala WHERE id = $1`, [
      id,
    ]);
    return result.rows[0] ?? null;
  },

  async findSummaryById(id: string, client: Queryable = db, lock: RowLock = false) {
    const result = await client.query<SalaSummary>(
      `SELECT id, activo, version FROM sala WHERE id = $1 ${lockClause(lock)}`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  /** Listado sin paginación: la clínica tiene pocas salas (PG-DSN-003 3.3, RNF 4.2.1). */
  async list(estado: SalaListState = 'activas', client: Queryable = db) {
    const active = estado === 'todas' ? null : estado === 'activas';
    const result = await client.query<SalaRecord>(
      `SELECT ${salaFields} FROM sala
       WHERE ($1::boolean IS NULL OR activo = $1::boolean)
       ORDER BY lower(nombre) ASC, id ASC`,
      [active],
    );
    return result.rows;
  },

  /**
   * Verificación anticipada de unicidad (RF 4.1.4, RNF 4.1.2) con la misma expresión del índice
   * uq_sala_nombre, de modo que el índice resuelva la consulta. Incluye salas dadas de baja.
   */
  async isNameTaken(nombre: string, excludeId?: string | null, client: Queryable = db) {
    const result = await client.query(
      `SELECT 1 FROM sala
       WHERE lower(btrim(nombre)) = lower(btrim($1)) AND ($2::uuid IS NULL OR id <> $2::uuid)
       LIMIT 1`,
      [nombre, excludeId ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async create(nombre: string, userId: string, client: Queryable = db) {
    const result = await client.query<SalaRecord>(
      `INSERT INTO sala (nombre, created_by, updated_by)
       VALUES ($1, $2, $2)
       RETURNING ${salaFields}`,
      [nombre, userId],
    );
    return result.rows[0];
  },

  /** Cambio de nombre con control de versión optimista (ADR-23). Solo salas activas. */
  async rename(
    id: string,
    nombre: string,
    version: number,
    userId: string,
    client: Queryable = db,
  ) {
    const result = await client.query<SalaRecord>(
      `UPDATE sala SET
         nombre = $2,
         version = version + 1,
         updated_at = now(),
         updated_by = $4
       WHERE id = $1 AND version = $3 AND activo = true
       RETURNING ${salaFields}`,
      [id, nombre, version, userId],
    );
    return result.rows[0] ?? null;
  },

  /**
   * Citas Pendientes de la sala que aún no terminan (ADR-19, CA-4.2-02). El servicio rechaza la
   * baja con SALA_CON_CITAS_PENDIENTES si el resultado es mayor que cero.
   */
  async countPendingAppointments(id: string, ahora: Date = new Date(), client: Queryable = db) {
    const result = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM cita
       WHERE id_sala = $1 AND estado = 'Pendiente' AND fin > $2`,
      [id, ahora],
    );
    return Number(result.rows[0].total);
  },

  /** Baja lógica (RF 4.2, ADR-19): se conserva la sala y su historial de citas. */
  async discharge(id: string, userId: string, client: Queryable = db) {
    const result = await client.query<SalaRecord>(
      `UPDATE sala SET
         activo = false,
         fecha_baja = now(),
         baja_por = $2,
         version = version + 1,
         updated_at = now(),
         updated_by = $2
       WHERE id = $1 AND activo = true
       RETURNING ${salaFields}`,
      [id, userId],
    );
    return result.rows[0] ?? null;
  },

  /** Reactivación: el nombre no se vuelve a verificar porque uq_sala_nombre abarca a las inactivas. */
  async restore(id: string, userId: string, client: Queryable = db) {
    const result = await client.query<SalaRecord>(
      `UPDATE sala SET
         activo = true,
         fecha_baja = NULL,
         baja_por = NULL,
         version = version + 1,
         updated_at = now(),
         updated_by = $2
       WHERE id = $1 AND activo = false
       RETURNING ${salaFields}`,
      [id, userId],
    );
    return result.rows[0] ?? null;
  },
};
