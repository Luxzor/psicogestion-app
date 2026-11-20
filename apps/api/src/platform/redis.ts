import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * DEF-006 (PG-DEF-ITER03): con los valores por omisión de ioredis, un comando enviado con Redis
 * detenido espera en la cola sin conexión hasta 20 reintentos, y /ready y el inicio de sesión
 * tardaban 30 s y 15 s sin responder. Con estos límites el comando falla en menos de 2 s, la
 * API responde 503 SERVICIO_NO_DISPONIBLE y el cliente sigue reconectando cada 2 s como máximo,
 * de modo que se recupera solo cuando Redis regresa (C1).
 */
export const REDIS_COMMAND_TIMEOUT_MS = 1_500;

export function createRedisClient(url: string) {
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: REDIS_COMMAND_TIMEOUT_MS,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
  });

  // Un solo registro por caída: ioredis emite `error` en cada intento de reconexión.
  let disconnected = false;
  client.on('error', (error) => {
    if (disconnected) return;
    disconnected = true;
    logger.error({ err: error }, 'Se perdió la conexión con Redis; se reintentará');
  });
  client.on('ready', () => {
    if (!disconnected) return;
    disconnected = false;
    logger.info('Se restableció la conexión con Redis');
  });
  return client;
}

export const redis = createRedisClient(env.REDIS_URL);
