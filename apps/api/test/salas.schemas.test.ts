import { describe, expect, it } from 'vitest';
import { salaDatabaseError } from '../src/modules/salas/errors.js';
import {
  createSalaSchema,
  normalizarNombreSala,
  SALA_MENSAJES,
  SALA_NOMBRE_MAX,
  salaIdSchema,
  updateSalaSchema,
} from '../src/modules/salas/schemas.js';

const nombreError = (input: unknown) => {
  const result = createSalaSchema.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues.find((issue) => issue.path.join('.') === 'nombre')?.message;
};

describe('modelo de datos de salas: validación del nombre (EDT 5.2.1)', () => {
  it('acepta un nombre de 1 a 10 caracteres y conserva la capitalización (CA-4.1-01)', () => {
    expect(createSalaSchema.parse({ nombre: 'Sala 1' })).toEqual({ nombre: 'Sala 1' });
    expect(createSalaSchema.parse({ nombre: 'A' })).toEqual({ nombre: 'A' });
    expect(createSalaSchema.parse({ nombre: 'a'.repeat(SALA_NOMBRE_MAX) }).nombre).toHaveLength(10);
    expect(createSalaSchema.parse({ nombre: 'Cámara Gesell'.slice(0, 10) }).nombre).toBe(
      'Cámara Ges',
    );
  });

  it('recorta los espacios laterales y colapsa los internos repetidos (PG-DSN-003 4.5)', () => {
    expect(normalizarNombreSala('   Sala    2  ')).toBe('Sala 2');
    // Con los espacios repetidos tendría 13 caracteres; normalizado tiene 8 y se acepta.
    expect(createSalaSchema.parse({ nombre: '  Sala   Uno   ' }).nombre).toBe('Sala Uno');
    // Con espacios laterales cuenta solo el texto: 10 caracteres efectivos se aceptan.
    expect(createSalaSchema.parse({ nombre: `   ${'b'.repeat(10)}   ` }).nombre).toBe(
      'b'.repeat(10),
    );
  });

  it('rechaza un nombre vacío, de solo espacios o de más de 10 caracteres (CA-4.1-03)', () => {
    expect(nombreError({ nombre: '' })).toBe(SALA_MENSAJES.NOMBRE_INVALIDO);
    expect(nombreError({ nombre: '     ' })).toBe(SALA_MENSAJES.NOMBRE_INVALIDO);
    expect(nombreError({ nombre: 'Sala Grupal 1' })).toBe(SALA_MENSAJES.NOMBRE_INVALIDO);
    expect(nombreError({})).toBe(SALA_MENSAJES.NOMBRE_INVALIDO);
    expect(nombreError({ nombre: 12 })).toBe(SALA_MENSAJES.NOMBRE_INVALIDO);
  });

  it('el alta es estricta: no acepta activo, version ni otros campos', () => {
    expect(createSalaSchema.safeParse({ nombre: 'Sala 1', activo: false }).success).toBe(false);
    expect(createSalaSchema.safeParse({ nombre: 'Sala 1', version: 3 }).success).toBe(false);
  });

  it('la edición exige el nombre y una versión entera positiva sin coerción (ADR-23)', () => {
    expect(updateSalaSchema.parse({ nombre: ' Sala 3 ', version: 2 })).toEqual({
      nombre: 'Sala 3',
      version: 2,
    });
    expect(updateSalaSchema.safeParse({ nombre: 'Sala 3' }).success).toBe(false);
    expect(updateSalaSchema.safeParse({ nombre: 'Sala 3', version: '2' }).success).toBe(false);
    expect(updateSalaSchema.safeParse({ nombre: 'Sala 3', version: 0 }).success).toBe(false);
    expect(updateSalaSchema.safeParse({ nombre: 'Sala 3', version: 1.5 }).success).toBe(false);
  });

  it('valida el identificador de la sala como UUID', () => {
    expect(salaIdSchema.safeParse('0d3c3f5e-8a43-4b6a-9b8e-3c1f0a2b4c5d').success).toBe(true);
    expect(salaIdSchema.safeParse('sala-1').success).toBe(false);
  });

  it('redacta el rechazo de baja con el número de citas pendientes (CA-4.2-02)', () => {
    expect(SALA_MENSAJES.SALA_CON_CITAS_PENDIENTES(1)).toBe(
      'No se puede dar de baja: tiene 1 cita pendiente. Reubícalas o cancélalas primero.',
    );
    expect(SALA_MENSAJES.SALA_CON_CITAS_PENDIENTES(3)).toBe(
      'No se puede dar de baja: tiene 3 citas pendientes. Reubícalas o cancélalas primero.',
    );
  });
});

describe('modelo de datos de salas: traducción de restricciones (EDT 5.2.1)', () => {
  it('traduce uq_sala_nombre a 409 NOMBRE_SALA_EN_USO (CA-4.1-02)', () => {
    const error = salaDatabaseError({ code: '23505', constraint: 'uq_sala_nombre' });
    expect(error).toMatchObject({
      status: 409,
      code: 'NOMBRE_SALA_EN_USO',
      message: 'Ya existe una sala con ese nombre.',
      fields: { nombre: 'Ya existe una sala con ese nombre.' },
    });
  });

  it('traduce sala_nombre_no_vacio y el exceso de longitud a 400 VALIDACION_INVALIDA', () => {
    expect(salaDatabaseError({ code: '23514', constraint: 'sala_nombre_no_vacio' })).toMatchObject({
      status: 400,
      code: 'VALIDACION_INVALIDA',
    });
    expect(salaDatabaseError({ code: '22001' })).toMatchObject({
      status: 400,
      code: 'VALIDACION_INVALIDA',
    });
  });

  it('no traduce errores ajenos a la tabla sala', () => {
    expect(salaDatabaseError({ code: '23505', constraint: 'paciente_curp_unico' })).toBeNull();
    expect(salaDatabaseError(new Error('conexión perdida'))).toBeNull();
    expect(salaDatabaseError(undefined)).toBeNull();
  });
});
