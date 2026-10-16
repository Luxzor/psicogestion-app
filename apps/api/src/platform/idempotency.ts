import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from './errors.js';
import { redis } from './redis.js';

export type StoredResponse = { status: number; body: unknown };

type Entry =
  | { estado: 'en_proceso'; huella: string }
  | ({ estado: 'completado'; huella: string } & StoredResponse);

const KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

const fingerprint = (payload: unknown) =>
  createHash('sha256').update(JSON.stringify(payload)).digest('base64url');

/** Valida el encabezado Idempotency-Key; devuelve null si no se envió. */
export function readIdempotencyKey(header: string | undefined) {
  if (header === undefined) return null;
  const key = header.trim();
  if (!KEY_PATTERN.test(key)) {
    throw new AppError(
      400,
      'IDEMPOTENCY_KEY_INVALIDA',
      'El encabezado Idempotency-Key debe tener entre 8 y 64 caracteres alfanuméricos o guiones.',
    );
  }
  return key;
}

/**
 * Ejecuta una operación de escritura una sola vez por llave (ADR-13). Si el cliente reintenta
 * con la misma llave y los mismos datos, recibe la respuesta guardada sin repetir la operación.
 * Los errores no se guardan: liberan la llave para que el usuario corrija y vuelva a intentar.
 */
export async function runIdempotent(
  options: { scope: string; userId: string; key: string | null; payload: unknown },
  operation: () => Promise<StoredResponse>,
): Promise<StoredResponse> {
  if (!options.key) return operation();

  const redisKey = `idempotency:${options.scope}:${options.userId}:${options.key}`;
  const huella = fingerprint(options.payload);
  const pending: Entry = { estado: 'en_proceso', huella };
  const acquired = await redis.set(
    redisKey,
    JSON.stringify(pending),
    'EX',
    env.IDEMPOTENCY_TTL_SECONDS,
    'NX',
  );

  if (acquired !== 'OK') {
    const raw = await redis.get(redisKey);
    const stored = raw ? (JSON.parse(raw) as Entry) : null;
    if (stored && stored.huella !== huella) {
      throw new AppError(
        422,
        'IDEMPOTENCY_KEY_REUTILIZADA',
        'Esta solicitud ya se usó con otros datos. Vuelve a guardar el formulario.',
      );
    }
    if (stored?.estado === 'completado') return { status: stored.status, body: stored.body };
    throw new AppError(
      409,
      'SOLICITUD_EN_PROCESO',
      'La solicitud anterior todavía se está procesando. Espera un momento e inténtalo de nuevo.',
    );
  }

  try {
    const response = await operation();
    const completed: Entry = { estado: 'completado', huella, ...response };
    await redis.set(redisKey, JSON.stringify(completed), 'EX', env.IDEMPOTENCY_TTL_SECONDS);
    return response;
  } catch (error) {
    await redis.del(redisKey);
    throw error;
  }
}
