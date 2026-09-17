import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../platform/errors.js';

type TokenUser = { id: string; rol: string };
type RefreshPayload = jwt.JwtPayload & { sub: string; jti: string; type: 'refresh' };

const expiry = (token: string) => {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string' || !decoded.exp)
    throw new Error('Token missing expiration');
  return new Date(decoded.exp * 1000);
};

export const tokenService = {
  createAccessToken(user: TokenUser) {
    return jwt.sign({ role: user.rol, type: 'access' }, env.JWT_ACCESS_SECRET, {
      subject: user.id,
      expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    });
  },

  createRefreshToken(user: TokenUser) {
    const sessionId = randomUUID();
    const token = jwt.sign({ jti: sessionId, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
      subject: user.id,
      expiresIn: env.REFRESH_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    });
    return { token, sessionId, expiresAt: expiry(token) };
  },

  verifyAccessToken(token: string) {
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
      if (payload.type !== 'access' || !payload.sub) throw new Error('Invalid access token');
      return { userId: payload.sub, role: String(payload.role ?? 'administrador') };
    } catch {
      throw new AppError(401, 'SESION_INVALIDA', 'Tu sesión no es válida o ha expirado.');
    }
  },

  verifyRefreshToken(token: string): RefreshPayload {
    try {
      const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshPayload;
      if (payload.type !== 'refresh' || !payload.sub || !payload.jti)
        throw new Error('Invalid refresh token');
      return payload;
    } catch {
      throw new AppError(401, 'SESION_INVALIDA', 'Tu sesión no es válida o ha expirado.');
    }
  },
};
