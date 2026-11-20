import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { db } from '../src/platform/db.js';
import { logger } from '../src/platform/logger.js';
import { redis } from '../src/platform/redis.js';

/**
 * DEF-005 (PG-DEF-ITER03, crítica). Al reiniciarse PostgreSQL, el servidor cierra las conexiones
 * con el código 57P01. Antes, el evento `error` del pool o del cliente quedaba sin escucha y la
 * API terminaba con código 1. Aquí se cierra una conexión real desde otra sesión, como lo hace
 * un reinicio, y se comprueba que el proceso sigue, que el error se registra y que la siguiente
 * consulta abre una conexión nueva.
 */
const integration = process.env.RUN_INTEGRATION_TESTS === '1' ? describe : describe.skip;

async function terminateBackend(pid: number) {
  const admin = new pg.Client({ connectionString: env.DATABASE_URL });
  await admin.connect();
  try {
    await admin.query('SELECT pg_terminate_backend($1)', [pid]);
  } finally {
    await admin.end();
  }
}

integration('resiliencia ante la pérdida de conexiones de PostgreSQL (DEF-005)', () => {
  const app = createApp();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await db.end();
    redis.disconnect();
  });

  it('sobrevive al cierre de una conexión inactiva del pool y vuelve a consultar', async () => {
    const logged = vi.spyOn(logger, 'error');
    const client = await db.connect();
    const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    client.release();

    await terminateBackend(rows[0].pid);

    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Se perdió una conexión con PostgreSQL',
      ),
    );
    const result = await db.query<{ ok: number }>('SELECT 1 AS ok');
    expect(result.rows[0].ok).toBe(1);
    expect((await request(app).get('/api/v1/ready')).status).toBe(200);
  });

  it('sobrevive al cierre de una conexión prestada y la descarta al liberarla', async () => {
    const logged = vi.spyOn(logger, 'error');
    const client = await db.connect();
    const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');

    await terminateBackend(rows[0].pid);

    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    client.release(true);
    const result = await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    expect(result.rows[0].pid).not.toBe(rows[0].pid);
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
  });
});
