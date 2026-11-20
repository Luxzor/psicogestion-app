import { Pool } from 'pg';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export const db = new Pool({
  connectionString: env.DATABASE_URL,
  // Sin este límite, una solicitud espera sin fin un cliente cuando PostgreSQL no responde.
  connectionTimeoutMillis: 5_000,
});

/**
 * DEF-005 (PG-DEF-ITER03): al reiniciarse PostgreSQL, pg emite el evento `error` en el pool
 * (conexiones inactivas) o en el cliente (conexiones prestadas). Sin un escucha, Node.js lo
 * trata como excepción no capturada y termina el proceso. Aquí solo se registra: pg descarta la
 * conexión dañada y el pool abre una nueva en la siguiente consulta, cuando la base regresa.
 */
const loggedErrors = new WeakSet<Error>();

function logConnectionError(error: Error) {
  if (loggedErrors.has(error)) return;
  loggedErrors.add(error);
  logger.error({ err: error }, 'Se perdió una conexión con PostgreSQL');
}

db.on('error', logConnectionError);
db.on('connect', (client) => {
  client.on('error', logConnectionError);
});
