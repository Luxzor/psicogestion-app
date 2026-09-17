import pino from 'pino';

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.contrasena',
      '*.nueva_contrasena',
      '*.confirmar_contrasena',
      '*.hash_contrasena',
      '*.token',
      '*.access_token',
      '*.refreshToken',
      '*.refresh_hash',
    ],
    censor: '[REDACTED]',
  },
});
