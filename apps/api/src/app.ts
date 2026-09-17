import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { correlationId } from './middleware/correlation-id.js';
import { authRouter } from './modules/auth/routes.js';
import { errorHandler } from './platform/errors.js';
import { healthRouter } from './routes/health.js';
import { readinessRouter } from './routes/readiness.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' } }));
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(correlationId);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api/v1', healthRouter);
  app.use('/api/v1', readinessRouter);
  app.use('/api/v1/auth', authRouter);
  app.use(errorHandler);

  return app;
}
