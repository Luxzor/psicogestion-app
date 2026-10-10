import type { PoolClient } from 'pg';
import { db } from '../../platform/db.js';
import type { TherapistInput } from './schemas.js';

type Queryable = Pick<PoolClient, 'query'>;

export type TherapistRecord = {
  id: string;
  nombre_completo: string;
  telefono: string;
  correo_electronico: string;
  fecha_nacimiento: string;
  cedula_profesional: string;
  foto_perfil: string | null;
  foto_actualizada_en: string | null;
  activo: boolean;
  fecha_baja: string | null;
  fecha_registro: string;
  version: number;
};

const therapistFields = `
  id,
  nombre_completo,
  telefono,
  correo_electronico,
  to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
  cedula_profesional,
  foto_perfil,
  foto_actualizada_en,
  activo,
  to_char(fecha_baja, 'YYYY-MM-DD') AS fecha_baja,
  to_char(created_at, 'YYYY-MM-DD') AS fecha_registro,
  version`;

export const therapistRepository = {
  async findById(id: string, client: Queryable = db) {
    const result = await client.query<TherapistRecord>(
      `SELECT ${therapistFields} FROM terapeuta WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async isPhoneTaken(telefono: string, excludeId?: string | null, client: Queryable = db) {
    const result = await client.query(
      `SELECT 1 FROM terapeuta
       WHERE telefono = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
       LIMIT 1`,
      [telefono, excludeId ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async isEmailTaken(correo: string, excludeId?: string | null, client: Queryable = db) {
    const result = await client.query(
      `SELECT 1 FROM terapeuta
       WHERE lower(correo_electronico) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)
       LIMIT 1`,
      [correo, excludeId ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async isCedulaTaken(cedula: string, excludeId?: string | null, client: Queryable = db) {
    const result = await client.query(
      `SELECT 1 FROM terapeuta
       WHERE cedula_profesional = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
       LIMIT 1`,
      [cedula, excludeId ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async create(data: TherapistInput, userId: string, client: Queryable = db) {
    const result = await client.query<TherapistRecord>(
      `INSERT INTO terapeuta
        (nombre_completo, telefono, correo_electronico, fecha_nacimiento,
         cedula_profesional, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING ${therapistFields}`,
      [
        data.nombre_completo,
        data.telefono,
        data.correo_electronico.toLowerCase(),
        data.fecha_nacimiento,
        data.cedula_profesional,
        userId,
      ],
    );
    return result.rows[0];
  },

  async updatePhoto(id: string, storageKey: string, userId: string, client: Queryable = db) {
    const result = await client.query<TherapistRecord>(
      `UPDATE terapeuta
       SET foto_perfil = $2,
           foto_actualizada_en = now(),
           updated_at = now(),
           updated_by = $3
       WHERE id = $1
       RETURNING ${therapistFields}`,
      [id, storageKey, userId],
    );
    return result.rows[0] ?? null;
  },

  async removePhoto(id: string, userId: string, client: Queryable = db) {
    const result = await client.query<TherapistRecord>(
      `UPDATE terapeuta
       SET foto_perfil = NULL,
           foto_actualizada_en = NULL,
           updated_at = now(),
           updated_by = $2
       WHERE id = $1
       RETURNING ${therapistFields}`,
      [id, userId],
    );
    return result.rows[0] ?? null;
  },
};
