import { createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../platform/errors.js';
import { redis } from '../../platform/redis.js';

const keyFingerprint = (value: string) =>
  createHmac('sha256', env.RATE_LIMIT_KEY_SECRET)
    .update(value.trim().toLowerCase())
    .digest('base64url');

export async function limitAttempts(scope: string, identifier: string) {
  const key = `ratelimit:${scope}:${keyFingerprint(identifier)}`;
  const attempts = await redis.incr(key);
  if (attempts === 1) await redis.expire(key, env.RATE_LIMIT_WINDOW_SECONDS);
  if (attempts > env.RATE_LIMIT_MAX_ATTEMPTS) {
    throw new AppError(
      429,
      'DEMASIADAS_SOLICITUDES',
      'Espera unos minutos antes de volver a intentarlo.',
    );
  }
}

export async function clearAttempts(scope: string, identifier: string) {
  await redis.del(`ratelimit:${scope}:${keyFingerprint(identifier)}`);
}
