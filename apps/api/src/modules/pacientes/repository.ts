import type { PoolClient } from 'pg';
import { db } from '../../platform/db.js';
import type { PatientInput } from './schemas.js';

type Queryable = Pick<PoolClient, 'query'>;

export type PatientRecord = {
  id: string;
  nombre_completo: string;
  curp: string;
  sexo: 'F' | 'M' | 'O';
  fecha_nacimiento: string;
  telefono: string;
  correo: string | null;
  consentimiento: boolean;
  activo: boolean;
  fecha_baja: string | null;
  fecha_registro: string;
  version: number;
};

export type PatientSummary = Pick<
  PatientRecord,
  'id' | 'nombre_completo' | 'curp' | 'activo' | 'fecha_baja'
>;

const patientFields = `
  id,
  nombre_completo,
  curp,
  sexo,
  to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
  telefono,
  correo,
  consentimiento,
  activo,
  to_char(fecha_baja, 'YYYY-MM-DD') AS fecha_baja,
  to_char(created_at, 'YYYY-MM-DD') AS fecha_registro,
  version`;

export const patientRepository = {
  async findByCurp(curp: string, client: Queryable = db) {
    const result = await client.query<PatientSummary>(
      `SELECT id, nombre_completo, curp, activo, to_char(fecha_baja, 'YYYY-MM-DD') AS fecha_baja
       FROM paciente WHERE curp = $1`,
      [curp],
    );
    return result.rows[0] ?? null;
  },

  async findSummaryById(id: string, client: Queryable = db, lock = false) {
    const result = await client.query<PatientSummary>(
      `SELECT id, nombre_completo, curp, activo, to_char(fecha_baja, 'YYYY-MM-DD') AS fecha_baja
       FROM paciente WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  /** Indica si el teléfono pertenece a un paciente distinto de excludeId. */
  async isPhoneTaken(telefono: string, excludeId?: string | null, client: Queryable = db) {
    const result = await client.query(
      `SELECT 1 FROM paciente
       WHERE telefono = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
       LIMIT 1`,
      [telefono, excludeId ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async create(data: PatientInput, userId: string, client: Queryable = db) {
    const result = await client.query<PatientRecord>(
      `INSERT INTO paciente
        (nombre_completo, curp, sexo, fecha_nacimiento, telefono, correo,
         consentimiento, consentimiento_en, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 THEN now() END, $8, $8)
       RETURNING ${patientFields}`,
      [
        data.nombre_completo,
        data.curp,
        data.sexo,
        data.fecha_nacimiento,
        data.telefono,
        data.correo,
        data.consentimiento,
        userId,
      ],
    );
    return result.rows[0];
  },

  /** Reactiva un paciente dado de baja reemplazando sus datos por los capturados. */
  async reactivate(id: string, data: PatientInput, userId: string, client: Queryable = db) {
    const result = await client.query<PatientRecord>(
      `UPDATE paciente SET
         nombre_completo = $2,
         sexo = $3,
         fecha_nacimiento = $4,
         telefono = $5,
         correo = $6,
         consentimiento = $7,
         consentimiento_en = CASE WHEN $7 THEN now() END,
         activo = true,
         fecha_baja = NULL,
         version = version + 1,
         updated_at = now(),
         updated_by = $8
       WHERE id = $1 AND activo = false
       RETURNING ${patientFields}`,
      [
        id,
        data.nombre_completo,
        data.sexo,
        data.fecha_nacimiento,
        data.telefono,
        data.correo,
        data.consentimiento,
        userId,
      ],
    );
    return result.rows[0] ?? null;
  },
};
