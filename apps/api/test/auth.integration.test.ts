import argon2 from 'argon2';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authService } from '../src/modules/auth/service.js';
import { mailService } from '../src/modules/auth/mail.js';
import { db } from '../src/platform/db.js';
import { redis } from '../src/platform/redis.js';

const integration = process.env.RUN_INTEGRATION_TESTS === '1' ? describe : describe.skip;
const context = { ip: '127.0.0.1', userAgent: 'vitest', correlationId: crypto.randomUUID() };
const registration = {
  nombre_completo: 'Ana Pérez',
  telefono: '9991234567',
  correo_institucional: 'ana@uady.mx',
  contrasena: 'ClaveSegura1!',
  confirmar_contrasena: 'ClaveSegura1!',
  consentimiento: true as const,
};

integration('autenticación con servicios reales', () => {
  const verificationMail = vi
    .spyOn(mailService, 'sendVerificationCode')
    .mockResolvedValue({} as never);
  const recoveryMail = vi.spyOn(mailService, 'sendRecoveryLink').mockResolvedValue({} as never);

  beforeEach(async () => {
    await db.query(
      'TRUNCATE bitacora_acceso, token_recuperacion, codigo_verificacion, sesion, usuario CASCADE',
    );
    await redis.flushdb();
    vi.clearAllMocks();
  });

  it('registra una cuenta y persiste una contraseña con Argon2', async () => {
    await authService.register(registration, context);

    const user = await db.query<{ hash_contrasena: string }>(
      'SELECT hash_contrasena FROM usuario WHERE correo_institucional = $1',
      [registration.correo_institucional],
    );
    expect(user.rowCount).toBe(1);
    expect(await argon2.verify(user.rows[0].hash_contrasena, registration.contrasena)).toBe(true);
    expect(verificationMail).toHaveBeenCalledOnce();
  });

  it('rechaza reutilizar un código de verificación ya consumido', async () => {
    await authService.register(registration, context);
    const code = verificationMail.mock.calls[0]?.[1];
    if (!code) throw new Error('Verification email was not sent.');

    await authService.verifyEmail(registration.correo_institucional, code, context);

    await expect(
      authService.verifyEmail(registration.correo_institucional, code, context),
    ).rejects.toMatchObject({
      code: 'CODIGO_INVALIDO',
    });
  });

  it('consume el enlace de recuperación una sola vez y revoca sesiones', async () => {
    await authService.register(registration, context);
    await db.query("UPDATE usuario SET estado = 'activo' WHERE correo_institucional = $1", [
      registration.correo_institucional,
    ]);
    await authService.login(
      { identificador: registration.correo_institucional, contrasena: registration.contrasena },
      context,
    );
    await authService.requestRecovery(registration.correo_institucional, context);
    const token = recoveryMail.mock.calls[0]?.[1];
    if (!token) throw new Error('Recovery email was not sent.');
    expect(token).toContain('.');

    await authService.resetPassword(token, 'NuevaClaveSegura1!', context);
    await expect(
      authService.resetPassword(token, 'OtraClaveSegura1!', context),
    ).rejects.toMatchObject({
      code: 'ENLACE_EXPIRADO',
    });
    const activeSessions = await db.query(
      `SELECT 1 FROM sesion
       WHERE id_usuario = (SELECT id FROM usuario WHERE correo_institucional = $1)
         AND revocado_en IS NULL`,
      [registration.correo_institucional],
    );
    expect(activeSessions.rowCount).toBe(0);
  });

  it('permite rotar un refresh token una sola vez cuando llegan solicitudes concurrentes', async () => {
    await authService.register(registration, context);
    await db.query("UPDATE usuario SET estado = 'activo' WHERE correo_institucional = $1", [
      registration.correo_institucional,
    ]);
    const session = await authService.login(
      { identificador: registration.correo_institucional, contrasena: registration.contrasena },
      context,
    );

    const results = await Promise.allSettled([
      authService.refresh(session.refreshToken, context),
      authService.refresh(session.refreshToken, context),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});

afterAll(async () => {
  await Promise.all([db.end(), redis.quit().catch(() => undefined)]);
});
