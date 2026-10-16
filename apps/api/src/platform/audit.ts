import type { PoolClient } from 'pg';
import { db } from './db.js';

type Queryable = Pick<PoolClient, 'query'>;

export type AuditEntry = {
  userId?: string;
  event: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
  /** Identificadores técnicos únicamente; nunca datos personales ni secretos. */
  detail?: string;
};

/** Registra un evento en bitacora_acceso (PG-DSN-001 4.3.5). */
export async function audit(entry: AuditEntry, client: Queryable = db) {
  await client.query(
    `INSERT INTO bitacora_acceso (id_usuario, evento, ip, user_agent, correlation_id, detalle)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.userId ?? null,
      entry.event,
      entry.ip ?? null,
      entry.userAgent ?? null,
      entry.correlationId ?? null,
      entry.detail?.slice(0, 255) ?? null,
    ],
  );
}
