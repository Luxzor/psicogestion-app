import { randomBytes, randomInt } from 'node:crypto';
import argon2 from 'argon2';
import type { PoolClient } from 'pg';
import { db } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { env } from '../../config/env.js';
import { mailService } from './mail.js';
import { authRepository, type UserRecord } from './repository.js';
import { clearAttempts, limitAttempts } from './rate-limit.js';
import { tokenService } from './tokens.js';
import type { LoginInput, RegisterInput } from './schemas.js';

type RequestContext = { ip?: string; userAgent?: string; correlationId?: string };
type DatabaseError = Error & { code?: string; constraint?: string };

const codeForEmail = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
const expiresInMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);

function duplicateError(error: unknown) {
  const databaseError = error as DatabaseError;
  if (databaseError.code !== '23505') return null;
  if (databaseError.constraint?.includes('correo')) {
    return new AppError(409, 'CORREO_EN_USO', 'El correo institucional ya está registrado.', {
      correo_institucional: 'Este correo ya está registrado.',
    });
  }
  return new AppError(409, 'TELEFONO_EN_USO', 'El teléfono ya está registrado.', {
    telefono: 'Este teléfono ya está registrado.',
  });
}

async function issueVerificationCode(user: UserRecord, context: RequestContext) {
  const code = codeForEmail();
  const codeHash = await argon2.hash(code);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await authRepository.replaceVerificationCode(
      user.id,
      codeHash,
      expiresInMinutes(env.VERIFICATION_CODE_TTL_MINUTES),
      client,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await mailService.sendVerificationCode(user.correo_institucional, code);
  await authRepository.audit({ ...context, userId: user.id, event: 'codigo_verificacion_enviado' });
}

function sessionPayload(user: UserRecord) {
  const accessToken = tokenService.createAccessToken(user);
  const refresh = tokenService.createRefreshToken(user);
  return { accessToken, refresh };
}

async function persistSession(user: UserRecord, context: RequestContext, client?: PoolClient) {
  const { accessToken, refresh } = sessionPayload(user);
  const refreshHash = await argon2.hash(refresh.token);
  await authRepository.createSession(
    {
      id: refresh.sessionId,
      userId: user.id,
      refreshHash,
      userAgent: context.userAgent,
      ip: context.ip,
      expiresAt: refresh.expiresAt,
    },
    client,
  );
  return { accessToken, refreshToken: refresh.token, refreshExpiresAt: refresh.expiresAt };
}

export const authService = {
  async register(input: RegisterInput, context: RequestContext) {
    await limitAttempts('registro', `${context.ip ?? 'unknown'}:${input.correo_institucional}`);
    const passwordHash = await argon2.hash(input.contrasena);
    const client = await db.connect();
    let registration: { user: UserRecord; code: string } | undefined;

    try {
      await client.query('BEGIN');
      const user = await authRepository.createUser(
        {
          nombre: input.nombre_completo,
          telefono: input.telefono,
          correo: input.correo_institucional,
          passwordHash,
        },
        client,
      );
      const code = codeForEmail();
      await authRepository.replaceVerificationCode(
        user.id,
        await argon2.hash(code),
        expiresInMinutes(env.VERIFICATION_CODE_TTL_MINUTES),
        client,
      );
      await client.query('COMMIT');
      registration = { user, code };
    } catch (error) {
      await client.query('ROLLBACK');
      throw duplicateError(error) ?? error;
    } finally {
      client.release();
    }

    if (!registration) throw new Error('Registration did not complete.');
    await mailService.sendVerificationCode(
      registration.user.correo_institucional,
      registration.code,
    );
    await authRepository.audit({
      ...context,
      userId: registration.user.id,
      event: 'registro_creado',
    });
    return { estado: 'pendiente_verificacion' };
  },

  async verifyEmail(correo: string, code: string, context: RequestContext) {
    await limitAttempts('verificacion', `${context.ip ?? 'unknown'}:${correo}`);
    const user = await authRepository.findUserByEmail(correo);
    if (!user) throw new AppError(400, 'CODIGO_INVALIDO', 'El código no es válido.');
    if (user.estado === 'activo') {
      throw new AppError(400, 'CODIGO_INVALIDO', 'El código no es válido.');
    }

    const record = await authRepository.latestVerificationCode(user.id);
    if (!record || record.expira_en <= new Date()) {
      throw new AppError(410, 'CODIGO_EXPIRADO', 'El código expiró. Solicita uno nuevo.');
    }

    const valid = await argon2.verify(record.codigo_hash, code);
    if (!valid) {
      const exhausted = record.intentos + 1 >= env.RATE_LIMIT_MAX_ATTEMPTS;
      await authRepository.registerFailedVerification(record.id, exhausted);
      throw new AppError(
        exhausted ? 429 : 400,
        exhausted ? 'DEMASIADOS_INTENTOS' : 'CODIGO_INVALIDO',
        exhausted ? 'El código fue bloqueado. Solicita uno nuevo.' : 'El código no es válido.',
      );
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await authRepository.activateUser(user.id, record.id, client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await clearAttempts('verificacion', `${context.ip ?? 'unknown'}:${correo}`);
    await authRepository.audit({ ...context, userId: user.id, event: 'cuenta_verificada' });
    return { estado: 'activo' };
  },

  async resendVerification(correo: string, context: RequestContext) {
    await limitAttempts('reenvio', `${context.ip ?? 'unknown'}:${correo}`);
    const user = await authRepository.findUserByEmail(correo);
    if (user?.estado === 'pendiente_verificacion') await issueVerificationCode(user, context);
  },

  async login(input: LoginInput, context: RequestContext) {
    const rateKey = `${context.ip ?? 'unknown'}:${input.identificador.toLowerCase()}`;
    await limitAttempts('login', rateKey);
    const user = await authRepository.findUserByIdentifier(input.identificador);
    const invalid = new AppError(
      401,
      'CREDENCIALES_INVALIDAS',
      'Correo/teléfono o contraseña incorrectos.',
    );
    if (!user || !(await argon2.verify(user.hash_contrasena, input.contrasena))) {
      await authRepository.audit({ ...context, userId: user?.id, event: 'login_fallido' });
      throw invalid;
    }
    if (user.estado === 'pendiente_verificacion') {
      throw new AppError(
        403,
        'CUENTA_NO_VERIFICADA',
        'Verifica tu correo antes de iniciar sesión.',
      );
    }
    if (user.estado === 'bloqueado') {
      throw new AppError(423, 'CUENTA_BLOQUEADA', 'La cuenta está bloqueada temporalmente.');
    }

    const session = await persistSession(user, context);
    await authRepository.updateLastAccess(user.id);
    await clearAttempts('login', rateKey);
    await authRepository.audit({ ...context, userId: user.id, event: 'login_exitoso' });
    return {
      ...session,
      user: { id: user.id, nombre_completo: user.nombre_completo, rol: user.rol },
    };
  },

  async refresh(refreshToken: string | undefined, context: RequestContext) {
    if (!refreshToken)
      throw new AppError(401, 'SESION_INVALIDA', 'Tu sesión no es válida o ha expirado.');
    const payload = tokenService.verifyRefreshToken(refreshToken);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const session = await authRepository.lockActiveSession(payload.jti, client);
      if (
        !session ||
        session.id_usuario !== payload.sub ||
        !(await argon2.verify(session.refresh_hash, refreshToken))
      ) {
        throw new AppError(401, 'SESION_INVALIDA', 'Tu sesión no es válida o ha expirado.');
      }

      const user = await authRepository.findUserById(payload.sub, client);
      if (!user || user.estado !== 'activo') {
        throw new AppError(401, 'SESION_INVALIDA', 'Tu sesión no es válida o ha expirado.');
      }
      if (!(await authRepository.revokeLockedSession(session.id, client))) {
        throw new AppError(401, 'SESION_INVALIDA', 'Tu sesión no es válida o ha expirado.');
      }
      const nextSession = await persistSession(user, context, client);
      await client.query('COMMIT');
      return nextSession;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async logout(userId: string, refreshToken: string | undefined, context: RequestContext) {
    if (refreshToken) {
      try {
        const payload = tokenService.verifyRefreshToken(refreshToken);
        if (payload.sub === userId) await authRepository.revokeSession(payload.jti);
      } catch {
        // The access token is valid; clearing an expired refresh cookie still completes logout.
      }
    }
    await authRepository.audit({ ...context, userId, event: 'logout' });
  },

  async requestRecovery(correo: string, context: RequestContext) {
    await limitAttempts('recuperacion', `${context.ip ?? 'unknown'}:${correo}`);
    const user = await authRepository.findUserByEmail(correo);
    if (!user) return;

    const selector = randomBytes(16).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    await authRepository.createRecoveryToken({
      userId: user.id,
      selector,
      tokenHash: await argon2.hash(secret),
      ip: context.ip,
      expiresAt: expiresInMinutes(env.RECOVERY_TOKEN_TTL_MINUTES),
    });
    await mailService.sendRecoveryLink(user.correo_institucional, `${selector}.${secret}`);
    await authRepository.audit({ ...context, userId: user.id, event: 'recuperacion_solicitada' });
  },

  async resetPassword(token: string, password: string, context: RequestContext) {
    const [selector, secret] = token.split('.');
    if (!selector || !secret) {
      throw new AppError(410, 'ENLACE_EXPIRADO', 'El enlace no es válido o expiró.');
    }

    const client = await db.connect();
    let userId: string | undefined;
    try {
      await client.query('BEGIN');
      const match = await authRepository.lockRecoveryToken(selector, client);
      if (!match || !(await argon2.verify(match.token_hash, secret))) {
        throw new AppError(410, 'ENLACE_EXPIRADO', 'El enlace no es válido o expiró.');
      }
      if (!(await authRepository.consumeRecoveryToken(match.id, client))) {
        throw new AppError(410, 'ENLACE_EXPIRADO', 'El enlace no es válido o expiró.');
      }
      await authRepository.updatePassword(match.id_usuario, await argon2.hash(password), client);
      await authRepository.revokeAllSessions(match.id_usuario, client);
      await client.query('COMMIT');
      userId = match.id_usuario;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await authRepository.audit({
      ...context,
      userId,
      event: 'cambio_contrasena',
    });
  },
};
