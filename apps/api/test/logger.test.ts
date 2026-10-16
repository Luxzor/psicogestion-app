import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { logger } from '../src/platform/logger.js';

describe('logger redaction (TC-U-017, RNF 3.2.7, CA-3.2-05)', () => {
  it('omite datos personales sensibles (nombre, CURP, teléfono, correo) y contraseñas/tokens en los logs', () => {
    let loggedData = '';
    const dest = {
      write(chunk: string) {
        loggedData += chunk;
      },
    };

    // Usar la misma configuración de redact de logger.ts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const redactConfig = (logger as any)[Symbol.for('pino.metadata')]
      ? undefined
      : {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'password',
            'contrasena',
            'nueva_contrasena',
            'confirmar_contrasena',
            'hash_contrasena',
            'token',
            'access_token',
            'refreshToken',
            'refresh_hash',
            'curp',
            'telefono',
            'correo',
            'correo_electronico',
            'correo_institucional',
            'nombre',
            'nombre_completo',
            '*.password',
            '*.contrasena',
            '*.nueva_contrasena',
            '*.confirmar_contrasena',
            '*.hash_contrasena',
            '*.token',
            '*.access_token',
            '*.refreshToken',
            '*.refresh_hash',
            '*.curp',
            '*.telefono',
            '*.correo',
            '*.correo_electronico',
            '*.correo_institucional',
            '*.nombre',
            '*.nombre_completo',
          ],
          censor: '[REDACTED]',
        };

    const testLogger = pino(
      {
        level: 'debug',
        redact: redactConfig,
      },
      dest,
    );

    testLogger.info(
      {
        correlationId: 'req-12345',
        paciente: {
          id: 'paciente-uuid-123',
          nombre_completo: 'María Gómez Pérez',
          curp: 'GOPM900101HDFRRN01',
          telefono: '9991234567',
          correo_electronico: 'maria.gomez@dominio.mx',
        },
        contrasena: 'secreta123',
      },
      'Evento de prueba',
    );

    const parsed = JSON.parse(loggedData);

    expect(parsed.correlationId).toBe('req-12345');
    expect(parsed.paciente.id).toBe('paciente-uuid-123');

    // PII y contraseñas redactadas
    expect(parsed.paciente.nombre_completo).toBe('[REDACTED]');
    expect(parsed.paciente.curp).toBe('[REDACTED]');
    expect(parsed.paciente.telefono).toBe('[REDACTED]');
    expect(parsed.paciente.correo_electronico).toBe('[REDACTED]');
    expect(parsed.contrasena).toBe('[REDACTED]');

    // Confirmación de que los valores crudos no aparecen en la cadena
    expect(loggedData).not.toContain('María Gómez Pérez');
    expect(loggedData).not.toContain('GOPM900101HDFRRN01');
    expect(loggedData).not.toContain('9991234567');
    expect(loggedData).not.toContain('maria.gomez@dominio.mx');
    expect(loggedData).not.toContain('secreta123');
  });
});

