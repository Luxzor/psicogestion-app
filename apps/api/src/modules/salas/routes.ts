import type { Request, Response } from 'express';
import { Router } from 'express';
import { asyncRoute } from '../../middleware/async-route.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { validationError } from '../../platform/errors.js';
import { readIdempotencyKey, runIdempotent } from '../../platform/idempotency.js';
import { createSalaSchema, salaAvailabilitySchema } from './schemas.js';
import { salaService, type RequestContext } from './service.js';

const requestContext = (request: Request, response: Response): RequestContext => ({
  userId: response.locals.auth.userId,
  ip: request.ip,
  userAgent: request.get('user-agent')?.slice(0, 255),
  correlationId: response.locals.correlationId,
});

export const salasRouter = Router();

salasRouter.use(requireAuth);

/**
 * RF 4.1.1 a RF 4.1.4 (EDT 5.3.1). Alta de sala con control de idempotencia (ADR-13).
 */
salasRouter.post(
  '/',
  asyncRoute(async (request, response) => {
    const parsed = createSalaSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    const context = requestContext(request, response);
    const result = await runIdempotent(
      {
        scope: 'salas:registro',
        userId: context.userId,
        key: readIdempotencyKey(request.get('idempotency-key')),
        payload: parsed.data,
      },
      async () => ({
        status: 201,
        body: {
          codigo: 'SALA_REGISTRADA',
          sala: await salaService.create(parsed.data, context),
        },
      }),
    );
    response.status(result.status).json(result.body);
  }),
);

/**
 * RF 4.1.4, RNF 4.1.2 (EDT 5.3.1). Verificación anticipada de unicidad del nombre de sala.
 */
salasRouter.post(
  '/validaciones',
  asyncRoute(async (request, response) => {
    const parsed = salaAvailabilitySchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    response.json(await salaService.checkAvailability(parsed.data));
  }),
);

