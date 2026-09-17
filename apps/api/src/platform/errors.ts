import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const validationError = (error: ZodError) => {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.join('.');
    if (field && !fields[field]) fields[field] = issue.message;
  }
  return new AppError(
    400,
    'VALIDACION_INVALIDA',
    'Revisa los datos marcados e inténtalo de nuevo.',
    fields,
  );
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  void _next;
  const correlationId = response.locals.correlationId;

  if (error instanceof AppError) {
    response.status(error.status).json({
      codigo: error.code,
      mensaje: error.message,
      ...(error.fields ? { campos: error.fields } : {}),
      correlation_id: correlationId,
    });
    return;
  }

  if (
    error instanceof SyntaxError &&
    'status' in error &&
    (error as SyntaxError & { status?: number }).status === 400
  ) {
    response.status(400).json({
      codigo: 'JSON_INVALIDO',
      mensaje: 'El cuerpo de la solicitud no contiene JSON válido.',
      correlation_id: correlationId,
    });
    return;
  }

  logger.error({ err: error, correlationId, path: request.path }, 'Unhandled request error');
  response.status(500).json({
    codigo: 'ERROR_INTERNO',
    mensaje:
      'No fue posible completar la operación. Conserva la información e inténtalo nuevamente.',
    correlation_id: correlationId,
  });
};
