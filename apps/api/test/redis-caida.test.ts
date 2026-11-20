import { createServer, type Server, type Socket } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ incr: vi.fn(), expire: vi.fn(), del: vi.fn() }));

vi.mock('../src/platform/redis.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/platform/redis.js')>();
  return { ...original, redis: mocks };
});

const { createApp } = await import('../src/app.js');
const { createRedisClient } = await import('../src/platform/redis.js');
const { isDependencyUnavailable } = await import('../src/platform/dependencies.js');
const { logger } = await import('../src/platform/logger.js');

/**
 * DEF-006 (PG-DEF-ITER03, alta). Con Redis detenido, /ready tardaba 30 s y el inicio de sesión
 * 15 s sin responder. Ahora un comando falla en menos de 2 s y la API responde 503
 * SERVICIO_NO_DISPONIBLE; el cliente sigue reconectando para recuperarse solo (C1).
 */
describe('Redis no disponible (DEF-006)', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    mocks.incr.mockReset();
  });

  it('el inicio de sesión responde 503 SERVICIO_NO_DISPONIBLE cuando Redis no responde', async () => {
    mocks.incr.mockRejectedValue(new Error('Command timed out'));

    const response = await request(createApp())
      .post('/api/v1/auth/login')
      .send({ identificador: 'prueba-caida@uady.mx', contrasena: 'Prueba!2026' });

    expect(response.status).toBe(503);
    expect(response.body.codigo).toBe('SERVICIO_NO_DISPONIBLE');
    expect(response.headers['retry-after']).toBe('5');
    expect(response.body.correlation_id).toBeTypeOf('string');
  });

  it('clasifica los errores de conexión de ioredis y de pg como dependencia no disponible', () => {
    const maxRetries = Object.assign(new Error('Reached the max retries per request limit'), {
      name: 'MaxRetriesPerRequestError',
    });
    expect(isDependencyUnavailable(maxRetries)).toBe(true);
    expect(isDependencyUnavailable(new Error('Connection is closed.'))).toBe(true);
    expect(isDependencyUnavailable(new Error('Command timed out'))).toBe(true);
    expect(isDependencyUnavailable(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isDependencyUnavailable(Object.assign(new Error('x'), { code: '57P01' }))).toBe(true);
    expect(isDependencyUnavailable(Object.assign(new Error('x'), { code: '23505' }))).toBe(false);
    expect(isDependencyUnavailable(new Error('Fallo simulado en auditoria'))).toBe(false);
  });
});

describe('cliente de Redis con límites de tiempo (DEF-006, C1)', () => {
  let silentServer: Server;
  let silentPort = 0;
  const sockets = new Set<Socket>();

  beforeAll(async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    // Acepta la conexión TCP pero nunca contesta, como un Redis colgado.
    silentServer = createServer((socket) => sockets.add(socket));
    await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve));
    silentPort = (silentServer.address() as { port: number }).port;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => silentServer.close(() => resolve()));
  });

  it('falla en menos de 3 s cuando no hay servidor de Redis escuchando', async () => {
    const client = createRedisClient('redis://127.0.0.1:1');
    const started = performance.now();

    await expect(client.ping()).rejects.toSatisfy(isDependencyUnavailable);

    expect(performance.now() - started).toBeLessThan(3_000);
    client.disconnect();
  });

  it('falla en menos de 3 s cuando Redis acepta la conexión pero no responde', async () => {
    const client = createRedisClient(`redis://127.0.0.1:${silentPort}`);
    const started = performance.now();

    await expect(client.ping()).rejects.toSatisfy(isDependencyUnavailable);

    expect(performance.now() - started).toBeLessThan(3_000);
    client.disconnect();
  });
});
