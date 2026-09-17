import type { PoolClient } from 'pg';
import { db } from '../../platform/db.js';

export type UserRecord = {
  id: string;
  nombre_completo: string;
  telefono: string;
  correo_institucional: string;
  hash_contrasena: string;
  estado: 'pendiente_verificacion' | 'activo' | 'bloqueado';
  rol: 'administrador';
};

type Queryable = Pick<PoolClient, 'query'>;

const userFields =
  'id, nombre_completo, telefono, correo_institucional, hash_contrasena, estado, rol';

export const authRepository = {
  async findUserByEmail(correo: string, client: Queryable = db) {
    const result = await client.query<UserRecord>(
      `SELECT ${userFields} FROM usuario WHERE correo_institucional = $1`,
      [correo],
    );
    return result.rows[0] ?? null;
  },

  async findUserByIdentifier(identificador: string) {
    const normalized = identificador.trim().toLowerCase();
    const result = await db.query<UserRecord>(
      `SELECT ${userFields}
       FROM usuario
       WHERE correo_institucional = $1 OR telefono = $2`,
      [normalized, identificador.trim()],
    );
    return result.rows[0] ?? null;
  },

  async findUserById(userId: string, client: Queryable = db) {
    const result = await client.query<UserRecord>(
      `SELECT ${userFields} FROM usuario WHERE id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  },

  async createUser(
    data: { nombre: string; telefono: string; correo: string; passwordHash: string },
    client: Queryable,
  ) {
    const result = await client.query<UserRecord>(
      `INSERT INTO usuario
        (nombre_completo, telefono, correo_institucional, hash_contrasena, consentimiento, consentimiento_en)
       VALUES ($1, $2, $3, $4, true, now())
       RETURNING ${userFields}`,
      [data.nombre, data.telefono, data.correo, data.passwordHash],
    );
    return result.rows[0];
  },

  async replaceVerificationCode(
    userId: string,
    codeHash: string,
    expiresAt: Date,
    client: Queryable,
  ) {
    await client.query(
      'UPDATE codigo_verificacion SET consumido_en = now() WHERE id_usuario = $1 AND consumido_en IS NULL',
      [userId],
    );
    await client.query(
      'INSERT INTO codigo_verificacion (id_usuario, codigo_hash, expira_en) VALUES ($1, $2, $3)',
      [userId, codeHash, expiresAt],
    );
  },

  async latestVerificationCode(userId: string, client: Queryable = db) {
    const result = await client.query<{
      id: string;
      codigo_hash: string;
      intentos: number;
      expira_en: Date;
    }>(
      `SELECT id, codigo_hash, intentos, expira_en FROM codigo_verificacion
       WHERE id_usuario = $1 AND consumido_en IS NULL
       ORDER BY emitido_en DESC LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? null;
  },

  async registerFailedVerification(codeId: string, exhausted: boolean) {
    await db.query(
      `UPDATE codigo_verificacion
       SET intentos = intentos + 1, consumido_en = CASE WHEN $2 THEN now() ELSE consumido_en END
       WHERE id = $1`,
      [codeId, exhausted],
    );
  },

  async activateUser(userId: string, codeId: string, client: Queryable) {
    await client.query("UPDATE usuario SET estado = 'activo' WHERE id = $1", [userId]);
    await client.query('UPDATE codigo_verificacion SET consumido_en = now() WHERE id = $1', [
      codeId,
    ]);
  },

  async updateLastAccess(userId: string) {
    await db.query('UPDATE usuario SET ultimo_acceso = now() WHERE id = $1', [userId]);
  },

  async createSession(
    data: {
      id: string;
      userId: string;
      refreshHash: string;
      userAgent?: string;
      ip?: string;
      expiresAt: Date;
    },
    client: Queryable = db,
  ) {
    await client.query(
      `INSERT INTO sesion (id, id_usuario, refresh_hash, user_agent, ip, expira_en)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        data.id,
        data.userId,
        data.refreshHash,
        data.userAgent ?? null,
        data.ip ?? null,
        data.expiresAt,
      ],
    );
  },

  async lockActiveSession(sessionId: string, client: Queryable) {
    const result = await client.query<{ id: string; id_usuario: string; refresh_hash: string }>(
      `SELECT id, id_usuario, refresh_hash FROM sesion
       WHERE id = $1 AND revocado_en IS NULL AND expira_en > now()
       FOR UPDATE`,
      [sessionId],
    );
    return result.rows[0] ?? null;
  },

  async revokeSession(sessionId: string) {
    await db.query('UPDATE sesion SET revocado_en = now() WHERE id = $1 AND revocado_en IS NULL', [
      sessionId,
    ]);
  },

  async revokeLockedSession(sessionId: string, client: Queryable) {
    const result = await client.query(
      `UPDATE sesion SET revocado_en = now()
       WHERE id = $1 AND revocado_en IS NULL AND expira_en > now()
       RETURNING id`,
      [sessionId],
    );
    return result.rowCount === 1;
  },

  async revokeAllSessions(userId: string, client: Queryable = db) {
    await client.query(
      'UPDATE sesion SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL',
      [userId],
    );
  },

  async createRecoveryToken(data: {
    userId: string;
    selector: string;
    tokenHash: string;
    ip?: string;
    expiresAt: Date;
  }) {
    await db.query(
      `INSERT INTO token_recuperacion (id_usuario, selector, token_hash, ip_solicitud, expira_en)
       VALUES ($1, $2, $3, $4, $5)`,
      [data.userId, data.selector, data.tokenHash, data.ip ?? null, data.expiresAt],
    );
  },

  async lockRecoveryToken(selector: string, client: Queryable) {
    const result = await client.query<{ id: string; id_usuario: string; token_hash: string }>(
      `SELECT id, id_usuario, token_hash FROM token_recuperacion
       WHERE selector = $1 AND consumido_en IS NULL AND expira_en > now()
       FOR UPDATE`,
      [selector],
    );
    return result.rows[0] ?? null;
  },

  async consumeRecoveryToken(tokenId: string, client: Queryable) {
    const result = await client.query(
      `UPDATE token_recuperacion SET consumido_en = now()
       WHERE id = $1 AND consumido_en IS NULL AND expira_en > now()
       RETURNING id`,
      [tokenId],
    );
    return result.rowCount === 1;
  },

  async updatePassword(userId: string, passwordHash: string, client: Queryable) {
    await client.query('UPDATE usuario SET hash_contrasena = $1 WHERE id = $2', [
      passwordHash,
      userId,
    ]);
  },

  async audit(data: {
    userId?: string;
    event: string;
    ip?: string;
    userAgent?: string;
    correlationId?: string;
  }) {
    await db.query(
      `INSERT INTO bitacora_acceso (id_usuario, evento, ip, user_agent, correlation_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        data.userId ?? null,
        data.event,
        data.ip ?? null,
        data.userAgent ?? null,
        data.correlationId ?? null,
      ],
    );
  },
};
