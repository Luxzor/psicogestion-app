import { EventEmitter } from 'node:events';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), ping: vi.fn() }));

vi.mock('../src/platform/db.js', () => ({ db: { query: mocks.query } }));
vi.mock('../src/platform/redis.js', () => ({ redis: { ping: mocks.ping } }));

const { createApp } = await import('../src/app.js');
const { listMigrationFiles } = await import('../src/platform/migrations.js');
const { withTimeout } = await import('../src/platform/dependencies.js');

const migrationRows = async () => ({
  rows: (await listMigrationFiles()).map((filename) => ({ filename })),
});

describe('GET /api/v1/ready (DEF-005, C4)', () => {
  beforeEach(async () => {
    mocks.query.mockReset().mockResolvedValue(await migrationRows());
    mocks.ping.mockReset().mockResolvedValue('PONG');
  });

  it('responde 200 cuando PostgreSQL, las migraciones y Redis están listos', async () => {
    const response = await request(createApp()).get('/api/v1/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready', service: 'psicogestion-api' });
    expect(mocks.query).toHaveBeenCalledWith('SELECT filename FROM schema_migrations');
  });

  it('responde 503 con migraciones pendientes si falta alguna en schema_migrations', async () => {
    const { rows } = await migrationRows();
    mocks.query.mockResolvedValue({ rows: rows.slice(0, -1) });

    const response = await request(createApp()).get('/api/v1/ready');

    expect(response.status).toBe(503);
    expect(response.body.codigo).toBe('SERVICIO_NO_DISPONIBLE');
    expect(response.body.dependencias).toEqual({
      base_datos: 'migraciones_pendientes',
      redis: 'disponible',
    });
  });

  it('considera pendientes las migraciones si la tabla schema_migrations no existe', async () => {
    mocks.query.mockRejectedValue(
      Object.assign(new Error('relation "schema_migrations" does not exist'), { code: '42P01' }),
    );

    const response = await request(createApp()).get('/api/v1/ready');

    expect(response.status).toBe(503);
    expect(response.body.dependencias.base_datos).toBe('migraciones_pendientes');
  });

  it('responde 503 sin terminar el proceso cuando PostgreSQL no está disponible', async () => {
    mocks.query.mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );

    const response = await request(createApp()).get('/api/v1/ready');
    const health = await request(createApp()).get('/api/v1/health');

    expect(response.status).toBe(503);
    expect(response.body.dependencias).toEqual({
      base_datos: 'no_disponible',
      redis: 'disponible',
    });
    expect(health.status).toBe(200);
  });

  it('responde 503 cuando Redis no está disponible (DEF-006)', async () => {
    mocks.ping.mockRejectedValue(new Error('Command timed out'));

    const response = await request(createApp()).get('/api/v1/ready');

    expect(response.status).toBe(503);
    expect(response.body.dependencias).toEqual({
      base_datos: 'disponible',
      redis: 'no_disponible',
    });
  });
});

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('rechaza con ETIMEDOUT cuando la dependencia no responde a tiempo', async () => {
    const pending = withTimeout(new Promise(() => undefined), 2_000, 'Redis');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
  });

  it('devuelve el resultado cuando la dependencia responde antes del límite', async () => {
    await expect(withTimeout(Promise.resolve('PONG'), 2_000, 'Redis')).resolves.toBe('PONG');
  });
});

describe('pool de PostgreSQL (DEF-005)', () => {
  it('registra los errores de conexiones inactivas y prestadas sin lanzarlos', async () => {
    vi.doUnmock('../src/platform/db.js');
    vi.resetModules();
    const { db } = await import('../src/platform/db.js');
    const { logger } = await import('../src/platform/logger.js');
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const terminated = Object.assign(new Error('terminating connection'), { code: '57P01' });

    expect(() => db.emit('error', terminated)).not.toThrow();

    const client = new EventEmitter();
    db.emit('connect', client);
    expect(() => client.emit('error', terminated)).not.toThrow();
    expect(() =>
      client.emit('error', new Error('Connection terminated unexpectedly')),
    ).not.toThrow();

    expect(logged).toHaveBeenCalledTimes(2);
    await db.end();
  });
});
