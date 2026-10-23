import type { Request, Response } from 'express';
import { Router } from 'express';
import { asyncRoute } from '../../middleware/async-route.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { validationError } from '../../platform/errors.js';
import { readIdempotencyKey, runIdempotent } from '../../platform/idempotency.js';
import {
  createSalaSchema,
  dischargeSchema,
  disponibilidadQuerySchema,
  salaAvailabilitySchema,
  salaIdSchema,
  salaListQuerySchema,
} from './schemas.js';
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
 * PG-DSN-003 3.3, RNF 4.2.1. Listado de salas según su estado.
 */
salasRouter.get(
  '/',
  asyncRoute(async (request, response) => {
    const parsed = salaListQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError(parsed.error);
    const salas = await salaService.list(parsed.data.estado);
    response.json({ salas });
  }),
);

/**
 * EDT 5.3.2. Consulta de disponibilidad de salas por día (RF 4.3.2, RF 4.3.3, RF 5.1.3; PG-DSN-003 5.7).
 */
salasRouter.get(
  '/disponibilidad',
  asyncRoute(async (request, response) => {
    const parsed = disponibilidadQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError(parsed.error);
    const disponibilidad = await salaService.getDisponibilidad(parsed.data);
    response.json(disponibilidad);
  }),
);

/**
 * RF 4.3.1. Obtener el detalle de una sala por identificador.
 */
salasRouter.get(
  '/:id',
  asyncRoute(async (request, response) => {
    const id = salaIdSchema.safeParse(request.params.id);
    if (!id.success) throw validationError(id.error);
    const sala = await salaService.getById(id.data);
    response.json({ sala });
  }),
);

/**
 * RF 4.2.1 a RF 4.2.5 (EDT 5.3.1). Conteo de citas pendientes para verificación antes de baja.
 */
salasRouter.get(
  '/:id/citas-pendientes',
  asyncRoute(async (request, response) => {
    const id = salaIdSchema.safeParse(request.params.id);
    if (!id.success) throw validationError(id.error);
    const total = await salaService.countPendingAppointments(id.data);
    response.json({ total });
  }),
);

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

/**
 * RF 4.2.1 a RF 4.2.5 (EDT 5.3.1). Baja lógica de sala con control de idempotencia (ADR-13).
 */
salasRouter.post(
  '/:id/baja',
  asyncRoute(async (request, response) => {
    const id = salaIdSchema.safeParse(request.params.id);
    if (!id.success) throw validationError(id.error);
    const parsed = dischargeSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw validationError(parsed.error);
    const context = requestContext(request, response);
    const result = await runIdempotent(
      {
        scope: `salas:baja:${id.data}`,
        userId: context.userId,
        key: readIdempotencyKey(request.get('idempotency-key')),
        payload: parsed.data,
      },
      async () => ({
        status: 200,
        body: {
          codigo: 'SALA_DADA_DE_BAJA',
          sala: await salaService.discharge(id.data, context),
        },
      }),
    );
    response.status(result.status).json(result.body);
  }),
);

