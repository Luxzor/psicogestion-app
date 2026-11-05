import { describe, expect, it } from 'vitest';
import type { Sala } from './types';
import {
  isSalaAssignable,
  normalizeSalaNombre,
  SALA_MENSAJES,
  SALA_NOMBRE_MAX,
  salaNombreKey,
  toSalaPayload,
  toSalaUpdatePayload,
  validateSalaNombre,
} from './validation';

const sala: Sala = {
  id: '8b3c4d5e-6f70-4b81-8c9d-1e2f3a4b5c6d',
  nombre: 'Sala 1',
  activo: true,
  fecha_baja: null,
  fecha_registro: '2026-10-21',
  version: 3,
};

describe('modelo de datos de salas en el cliente (EDT 5.2.1)', () => {
  it('acepta nombres de 1 a 10 caracteres después de normalizar (CA-4.1-01)', () => {
    expect(validateSalaNombre('A')).toBe('');
    expect(validateSalaNombre('a'.repeat(SALA_NOMBRE_MAX))).toBe('');
    expect(validateSalaNombre('  Sala    Uno  ')).toBe('');
  });

  it('marca el nombre vacío o largo con los textos de la maqueta (CA-4.1-03)', () => {
    expect(validateSalaNombre('')).toBe(SALA_MENSAJES.vacio);
    expect(validateSalaNombre('    ')).toBe('Escribe el nombre de la sala.');
    expect(validateSalaNombre('Sala Grupal 1')).toBe(
      'El nombre puede tener máximo 10 caracteres; tiene 13.',
    );
  });

  it('normaliza igual que el servidor y compara sin distinguir mayúsculas (CA-4.1-02)', () => {
    expect(normalizeSalaNombre('  Sala   2 ')).toBe('Sala 2');
    expect(salaNombreKey(' SALA  2')).toBe(salaNombreKey('sala 2'));
    expect(toSalaPayload('  Sala   2 ')).toEqual({ nombre: 'Sala 2' });
  });

  it('arma el cambio de nombre con la versión leída solo si el nombre cambió (ADR-23)', () => {
    expect(toSalaUpdatePayload(sala, ' Sala 1 ')).toBeNull();
    expect(toSalaUpdatePayload(sala, 'Sala A')).toEqual({ nombre: 'Sala A', version: 3 });
  });

  it('solo ofrece salas activas para agendar (CA-4.2-01)', () => {
    expect(isSalaAssignable(sala)).toBe(true);
    expect(isSalaAssignable({ activo: false })).toBe(false);
  });

  it('redacta el rechazo de baja con citas pendientes (CA-4.2-02)', () => {
    expect(SALA_MENSAJES.conCitas(2)).toBe(
      'No se puede dar de baja: tiene 2 citas pendientes. Reubícalas o cancélalas primero.',
    );
    expect(SALA_MENSAJES.conCitas(1)).toContain('1 cita pendiente.');
  });
});
