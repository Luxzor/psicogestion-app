import type { Request, Response } from 'express';
import { Router } from 'express';
import { asyncRoute } from '../../middleware/async-route.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { validationError } from '../../platform/errors.js';
import { readIdempotencyKey, runIdempotent } from '../../platform/idempotency.js';
import { availabilitySchema, patientIdSchema, patientSchema } from './schemas.js';
import { patientService, type RequestContext } from './service.js';

const requestContext = (request: Request, response: Response): RequestContext => ({
  userId: response.locals.auth.userId,
  ip: request.ip,
  userAgent: request.get('user-agent')?.slice(0, 255),
  correlationId: response.locals.correlationId,
});

export const patientsRouter = Router();

patientsRouter.use(requireAuth);

patientsRouter.post(
  '/',
  asyncRoute(async (request, response) => {
    const parsed = patientSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    const context = requestContext(request, response);
    const result = await runIdempotent(
      {
        scope: 'pacientes:registro',
        userId: context.userId,
        key: readIdempotencyKey(request.get('idempotency-key')),
        payload: parsed.data,
      },
      async () => ({
        status: 201,
        body: {
          codigo: 'PACIENTE_REGISTRADO',
          paciente: await patientService.register(parsed.data, context),
        },
      }),
    );
    response.status(result.status).json(result.body);
  }),
);

patientsRouter.post(
  '/validaciones',
  asyncRoute(async (request, response) => {
    const parsed = availabilitySchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    response.json(await patientService.checkAvailability(parsed.data));
  }),
);

patientsRouter.post(
  '/:id/reactivacion',
  asyncRoute(async (request, response) => {
    const id = patientIdSchema.safeParse(request.params.id);
    if (!id.success) throw validationError(id.error);
    const parsed = patientSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    const context = requestContext(request, response);
    const result = await runIdempotent(
      {
        scope: `pacientes:reactivacion:${id.data}`,
        userId: context.userId,
        key: readIdempotencyKey(request.get('idempotency-key')),
        payload: parsed.data,
      },
      async () => ({
        status: 200,
        body: {
          codigo: 'PACIENTE_REACTIVADO',
          paciente: await patientService.reactivate(id.data, parsed.data, context),
        },
      }),
    );
    response.status(result.status).json(result.body);
  }),
);
