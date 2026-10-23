import type { Request, Response } from 'express';
import { Router } from 'express';
import { asyncRoute } from '../../middleware/async-route.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { validationError } from '../../platform/errors.js';
import { readIdempotencyKey, runIdempotent } from '../../platform/idempotency.js';
import { createCitaSchema } from './schemas.js';
import { citaService, type RequestContext } from './service.js';

const requestContext = (request: Request, response: Response): RequestContext => ({
  userId: response.locals.auth.userId,
  ip: request.ip,
  userAgent: request.get('user-agent')?.slice(0, 255),
  correlationId: response.locals.correlationId,
});

export const citasRouter = Router();

citasRouter.use(requireAuth);

/**
 * RF 5.1.1–5.1.15, RF 2.3.5 (EDT 5.3.3). Alta de cita con control de idempotencia (ADR-23): el
 * cuerpo es estricto (createCitaSchema), no acepta `estado` ni `fin`.
 */
citasRouter.post(
  '/',
  asyncRoute(async (request, response) => {
    const parsed = createCitaSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    const context = requestContext(request, response);
    const result = await runIdempotent(
      {
        scope: 'citas:registro',
        userId: context.userId,
        key: readIdempotencyKey(request.get('idempotency-key')),
        payload: parsed.data,
      },
      async () => ({
        status: 201,
        body: {
          codigo: 'CITA_REGISTRADA',
          cita: await citaService.create(parsed.data, context),
        },
      }),
    );
    response.status(result.status).json(result.body);
  }),
);
