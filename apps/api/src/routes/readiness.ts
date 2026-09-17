import { Router } from 'express';
import { asyncRoute } from '../middleware/async-route.js';
import { db } from '../platform/db.js';
import { AppError } from '../platform/errors.js';
import { redis } from '../platform/redis.js';

export const readinessRouter = Router();

readinessRouter.get(
  '/ready',
  asyncRoute(async (_request, response) => {
    try {
      await Promise.all([db.query('SELECT 1'), redis.ping()]);
      response.status(200).json({ status: 'ready', service: 'psicogestion-api' });
    } catch {
      throw new AppError(503, 'SERVICIO_NO_DISPONIBLE', 'El servicio aún no está disponible.');
    }
  }),
);
