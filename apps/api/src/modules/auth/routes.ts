import type { CookieOptions, Request } from 'express';
import { Router } from 'express';
import { asyncRoute } from '../../middleware/async-route.js';
import { AppError, validationError } from '../../platform/errors.js';
import {
  emailSchema,
  loginSchema,
  registerSchema,
  resetSchema,
  verificationSchema,
} from './schemas.js';
import { authService } from './service.js';
import { tokenService } from './tokens.js';

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/v1/auth',
};

const accessToken = (request: Request) => {
  const header = request.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'SESION_INVALIDA', 'Tu sesión no es válida o ha expirado.');
  }
  return tokenService.verifyAccessToken(header.slice('Bearer '.length));
};

const requestContext = (request: Request, correlationId?: string) => {
  const userAgent = request.get('user-agent');
  return {
    ip: request.ip,
    userAgent: userAgent?.slice(0, 255),
    correlationId,
  };
};

export const authRouter = Router();

authRouter.post(
  '/registro',
  asyncRoute(async (request, response) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    const result = await authService.register(
      parsed.data,
      requestContext(request, response.locals.correlationId),
    );
    response.status(201).json({ codigo: 'REGISTRO_CREADO', ...result });
  }),
);

authRouter.post(
  '/verificacion',
  asyncRoute(async (request, response) => {
    const parsed = verificationSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    const result = await authService.verifyEmail(
      parsed.data.correo_institucional,
      parsed.data.codigo,
      requestContext(request, response.locals.correlationId),
    );
    response.json({ codigo: 'CUENTA_VERIFICADA', ...result });
  }),
);

authRouter.post(
  '/verificacion/reenviar',
  asyncRoute(async (request, response) => {
    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    await authService.resendVerification(
      parsed.data.correo_institucional,
      requestContext(request, response.locals.correlationId),
    );
    response.status(202).json({ codigo: 'CODIGO_REENVIO_SOLICITADO' });
  }),
);

authRouter.post(
  '/login',
  asyncRoute(async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    const result = await authService.login(
      parsed.data,
      requestContext(request, response.locals.correlationId),
    );
    response.cookie('refresh', result.refreshToken, {
      ...refreshCookieOptions,
      expires: result.refreshExpiresAt,
    });
    response.json({ access_token: result.accessToken, usuario: result.user });
  }),
);

authRouter.post(
  '/refresh',
  asyncRoute(async (request, response) => {
    const result = await authService.refresh(
      request.cookies.refresh,
      requestContext(request, response.locals.correlationId),
    );
    response.cookie('refresh', result.refreshToken, {
      ...refreshCookieOptions,
      expires: result.refreshExpiresAt,
    });
    response.json({ access_token: result.accessToken });
  }),
);

authRouter.delete(
  '/sesion',
  asyncRoute(async (request, response) => {
    const session = accessToken(request);
    await authService.logout(
      session.userId,
      request.cookies.refresh,
      requestContext(request, response.locals.correlationId),
    );
    response.clearCookie('refresh', refreshCookieOptions).status(204).send();
  }),
);

authRouter.post(
  '/recuperacion',
  asyncRoute(async (request, response) => {
    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    await authService.requestRecovery(
      parsed.data.correo_institucional,
      requestContext(request, response.locals.correlationId),
    );
    response.status(202).json({
      codigo: 'SOLICITUD_RECIBIDA',
      mensaje: 'Si el correo está registrado, te enviamos un enlace.',
    });
  }),
);

authRouter.post(
  '/restablecimiento',
  asyncRoute(async (request, response) => {
    const parsed = resetSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(parsed.error);
    await authService.resetPassword(
      parsed.data.token,
      parsed.data.nueva_contrasena,
      requestContext(request, response.locals.correlationId),
    );
    response.json({ codigo: 'CONTRASENA_ACTUALIZADA' });
  }),
);
