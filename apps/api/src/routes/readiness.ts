import { Router } from 'express';
import { asyncRoute } from '../middleware/async-route.js';
import { db } from '../platform/db.js';
import { withTimeout } from '../platform/dependencies.js';
import { AppError } from '../platform/errors.js';
import { logger } from '../platform/logger.js';
import { listMigrationFiles } from '../platform/migrations.js';
import { redis } from '../platform/redis.js';

export const readinessRouter = Router();

/** Cada verificación tiene su propio límite para que /ready responda en menos de 3 s. */
export const READINESS_CHECK_TIMEOUT_MS = 2_000;

type DatabaseState = 'disponible' | 'no_disponible' | 'migraciones_pendientes';
type RedisState = 'disponible' | 'no_disponible';

let expectedMigrations: Promise<string[] | null> | undefined;

/** Lista de migraciones del repositorio; null si la carpeta no está (se omite la comparación). */
function loadExpectedMigrations() {
  expectedMigrations ??= listMigrationFiles().catch((error: unknown) => {
    logger.warn({ err: error }, 'No se encontró db/migrations; /ready no compara migraciones');
    return null;
  });
  return expectedMigrations;
}

/**
 * C4 (Robustez de la API): además de abrir conexión, confirma que todas las migraciones del
 * repositorio están registradas en schema_migrations. Si la tabla no existe, faltan todas.
 */
async function checkDatabase(): Promise<DatabaseState> {
  try {
    const result = await withTimeout(
      db.query<{ filename: string }>('SELECT filename FROM schema_migrations'),
      READINESS_CHECK_TIMEOUT_MS,
      'PostgreSQL',
    );
    const expected = await loadExpectedMigrations();
    if (!expected) return 'disponible';
    const applied = new Set(result.rows.map((row) => row.filename));
    return expected.every((filename) => applied.has(filename))
      ? 'disponible'
      : 'migraciones_pendientes';
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return 'migraciones_pendientes';
    logger.warn({ err: error }, 'PostgreSQL no está disponible para /ready');
    return 'no_disponible';
  }
}

async function checkRedis(): Promise<RedisState> {
  try {
    await withTimeout(redis.ping(), READINESS_CHECK_TIMEOUT_MS, 'Redis');
    return 'disponible';
  } catch (error) {
    logger.warn({ err: error }, 'Redis no está disponible para /ready');
    return 'no_disponible';
  }
}

readinessRouter.get(
  '/ready',
  asyncRoute(async (_request, response) => {
    const [baseDatos, redisState] = await Promise.all([checkDatabase(), checkRedis()]);
    if (baseDatos === 'disponible' && redisState === 'disponible') {
      response.status(200).json({ status: 'ready', service: 'psicogestion-api' });
      return;
    }
    throw new AppError(
      503,
      'SERVICIO_NO_DISPONIBLE',
      'El servicio aún no está disponible.',
      undefined,
      { dependencias: { base_datos: baseDatos, redis: redisState } },
    );
  }),
);
