import type { RequestHandler } from 'express';
import { tokenService } from '../modules/auth/tokens.js';
import { AppError } from '../platform/errors.js';

export type AuthenticatedLocals = { auth: { userId: string; role: string } };

/**
 * Exige un access token vigente (Bearer). Los datos de pacientes solo son accesibles con una
 * sesión activa (RNF 3.2.7, CA-3.2-05, restricción R01).
 */
export const requireAuth: RequestHandler = (request, response, next) => {
  const header = request.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    next(new AppError(401, 'SESION_INVALIDA', 'Tu sesión no es válida o ha expirado.'));
    return;
  }
  try {
    response.locals.auth = tokenService.verifyAccessToken(header.slice('Bearer '.length));
    next();
  } catch (error) {
    next(error);
  }
};
