import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), '../../../../');
loadEnv({ path: path.join(projectRoot, '.env') });
if (process.env.NODE_ENV === 'test') {
  loadEnv({ path: path.join(projectRoot, '.env.test'), override: true });
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    WEB_ORIGIN: z.url().default('https://localhost:8443'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive(),
    SMTP_FROM: z.email(),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL: z.string().default('8h'),
    VERIFICATION_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    RECOVERY_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
    RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    RATE_LIMIT_KEY_SECRET: z.string().min(32).optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && !value.RATE_LIMIT_KEY_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['RATE_LIMIT_KEY_SECRET'],
        message: 'RATE_LIMIT_KEY_SECRET es obligatorio en producción.',
      });
    }
  });

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  // Reuses an existing secret only until RATE_LIMIT_KEY_SECRET is configured explicitly.
  // This keeps local environments compatible while avoiding PII in Redis keys.
  RATE_LIMIT_KEY_SECRET: parsedEnv.RATE_LIMIT_KEY_SECRET ?? parsedEnv.JWT_ACCESS_SECRET,
};
