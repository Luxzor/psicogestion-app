import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const correlationId: RequestHandler = (_request, response, next) => {
  const id = randomUUID();
  response.locals.correlationId = id;
  response.setHeader('X-Correlation-Id', id);
  next();
};
