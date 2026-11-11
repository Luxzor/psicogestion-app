import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { correlationId } from './middleware/correlation-id.js';
import { authRouter } from './modules/auth/routes.js';
import { citasRouter } from './modules/citas/routes.js';
import { patientsRouter } from './modules/pacientes/routes.js';
import { salasRouter } from './modules/salas/routes.js';
import { therapistsRouter } from './modules/terapeutas/routes.js';
import { errorHandler } from './platform/errors.js';
import { healthRouter } from './routes/health.js';
import { readinessRouter } from './routes/readiness.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' } }));

  const allowedOrigins = [
    env.WEB_ORIGIN,
    'https://localhost:8443',
    'https://127.0.0.1:8443',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (
          !origin ||
          allowedOrigins.includes(origin) ||
          origin.endsWith(':8443') ||
          origin.endsWith(':5173')
        ) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
    }),
  );
  app.use(correlationId);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api/v1', healthRouter);
  app.use('/api/v1', readinessRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/pacientes', patientsRouter);
  app.use('/api/v1/terapeutas', therapistsRouter);
  app.use('/api/v1/salas', salasRouter);
  app.use('/api/v1/citas', citasRouter);
  app.use(errorHandler);

  return app;
}
