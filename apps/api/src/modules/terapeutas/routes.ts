import type { Request, Response } from 'express';
import express, { Router } from 'express';
import { asyncRoute } from '../../middleware/async-route.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { validationError } from '../../platform/errors.js';
import { readIdempotencyKey, runIdempotent } from '../../platform/idempotency.js';
import { extractMultipartFile } from '../../platform/images.js';
import {
  listQuerySchema,
  therapistAvailabilitySchema,
  therapistIdSchema,
  therapistSchema,
  updateTherapistSchema,
} from './schemas.js';
import { therapistService, type RequestContext } from './service.js';

const requestContext = (request: Request, response: Response): RequestContext => ({
  userId: response.locals.auth.userId,
  ip: request.ip,
  userAgent: request.get('user-agent')?.slice(0, 255),
  correlationId: response.locals.correlationId,
});

export const therapistsRouter = Router();

therapistsRouter.use(requireAuth);

therapistsRouter.post(
  '/',
  asyncRoute(async (request, response) => {
    const parsed = therapistSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    const context = requestContext(request, response);
    const result = await runIdempotent(
      {
        scope: 'terapeutas:registro',
        userId: context.userId,
        key: readIdempotencyKey(request.get('idempotency-key')),
        payload: parsed.data,
      },
      async () => ({
        status: 201,
        body: {
          codigo: 'TERAPEUTA_REGISTRADO',
          terapeuta: await therapistService.register(parsed.data, context),
        },
      }),
    );
    response.status(result.status).json(result.body);
  }),
);

/** RF 2.2.1. Listado paginado de terapeutas (PG-DSN-002 5.12.2). Por omisión solo activos. */
therapistsRouter.get(
  '/',
  asyncRoute(async (request, response) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError(parsed.error);
    response.json(await therapistService.list(parsed.data));
  }),
);

therapistsRouter.post(
  '/validaciones',
  asyncRoute(async (request, response) => {
    const parsed = therapistAvailabilitySchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    response.json(await therapistService.checkAvailability(parsed.data));
  }),
);

/** RF 2.2.2. Perfil del terapeuta, activo o dado de baja. */
therapistsRouter.get(
  '/:id',
  asyncRoute(async (request, response) => {
    const id = therapistIdSchema.safeParse(request.params.id);
    if (!id.success) throw validationError(id.error);
    response.json({
      terapeuta: await therapistService.getById(id.data, requestContext(request, response)),
    });
  }),
);

/**
 * RF 2.2.3–2.2.5. Edición parcial con control de versión (ADR-10). No lleva Idempotency-Key:
 * la versión ya hace que un reintento no pueda aplicar el cambio dos veces.
 */
therapistsRouter.patch(
  '/:id',
  asyncRoute(async (request, response) => {
    const id = therapistIdSchema.safeParse(request.params.id);
    if (!id.success) throw validationError(id.error);
    const parsed = updateTherapistSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    response.json({
      codigo: 'TERAPEUTA_ACTUALIZADO',
      terapeuta: await therapistService.update(
        id.data,
        parsed.data,
        requestContext(request, response),
      ),
    });
  }),
);

therapistsRouter.put(
  '/:id/foto',
  express.raw({
    type: ['multipart/form-data', 'image/*', 'application/octet-stream'],
    limit: '6mb',
  }),
  asyncRoute(async (request, response) => {
    const id = therapistIdSchema.safeParse(request.params.id);
    if (!id.success) throw validationError(id.error);

    const rawBuffer = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(request.body || '');

    const fileBuffer = extractMultipartFile(rawBuffer, request.get('content-type'));
    const context = requestContext(request, response);

    const updated = await therapistService.uploadPhoto(id.data, fileBuffer, context);
    response.json({
      codigo: 'FOTO_ACTUALIZADA',
      terapeuta: updated,
    });
  }),
);

therapistsRouter.get(
  '/:id/foto',
  asyncRoute(async (request, response) => {
    const id = therapistIdSchema.safeParse(request.params.id);
    if (!id.success) throw validationError(id.error);

    const { buffer, contentType, etag } = await therapistService.getPhoto(id.data);

    if (request.get('if-none-match') === etag) {
      response.status(304).end();
      return;
    }

    response.set({
      'Content-Type': contentType,
      'Cache-Control': 'private, no-transform, max-age=86400',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    });
    response.send(buffer);
  }),
);

therapistsRouter.delete(
  '/:id/foto',
  asyncRoute(async (request, response) => {
    const id = therapistIdSchema.safeParse(request.params.id);
    if (!id.success) throw validationError(id.error);

    const context = requestContext(request, response);
    await therapistService.deletePhoto(id.data, context);
    response.status(204).end();
  }),
);
