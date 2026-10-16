import { describe, expect, it } from 'vitest';
import {
  createTherapistSchema,
  createUpdateTherapistSchema,
  dischargeSchema,
  listQuerySchema,
  photoQuerySchema,
  therapistAvailabilitySchema,
  therapistIdSchema,
  updateTherapistSchema,
} from '../src/modules/terapeutas/schemas.js';

const registrationDate = '2026-10-09';
const schema = createTherapistSchema(() => registrationDate);

const valid = {
  nombre_completo: 'Victoria Méndez Rosado',
  telefono: '9997845213',
  correo_electronico: 'victoria.mendez@correo.uady.mx',
  fecha_nacimiento: '1988-05-19',
  cedula_profesional: '7845213',
};

const fieldError = (input: unknown, field: string) => {
  const result = schema.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues.find((issue) => issue.path.join('.') === field)?.message;
};

describe('esquema de registro de terapeutas (EDT 4.3.4)', () => {
  it('acepta un terapeuta con datos válidos (CA-2.1-01)', () => {
    const result = schema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nombre_completo).toBe('Victoria Méndez Rosado');
      expect(result.data.telefono).toBe('9997845213');
      expect(result.data.correo_electronico).toBe('victoria.mendez@correo.uady.mx');
      expect(result.data.fecha_nacimiento).toBe('1988-05-19');
      expect(result.data.cedula_profesional).toBe('7845213');
    }
  });

  it('acepta alias correo y cedula', () => {
    const result = schema.safeParse({
      nombre_completo: 'Héctor Puerto Cámara',
      telefono: '9996123987',
      correo: 'hector.puerto@correo.uady.mx',
      fecha_nacimiento: '1979-09-03',
      cedula: '6123987',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.correo_electronico).toBe('hector.puerto@correo.uady.mx');
      expect(result.data.cedula_profesional).toBe('6123987');
    }
  });

  it('normaliza el nombre y el correo', () => {
    const result = schema.parse({
      ...valid,
      nombre_completo: '  Victoria   Méndez   Rosado  ',
      correo_electronico: ' Victoria.Mendez@Uady.Mx ',
    });
    expect(result.nombre_completo).toBe('Victoria Méndez Rosado');
    expect(result.correo_electronico).toBe('victoria.mendez@uady.mx');
  });

  it('acepta un nombre de 50 caracteres y rechaza uno vacío o de 51 (CA-2.1-02)', () => {
    expect(fieldError({ ...valid, nombre_completo: 'a'.repeat(50) }, 'nombre_completo')).toBe(
      undefined,
    );
    expect(fieldError({ ...valid, nombre_completo: 'a'.repeat(51) }, 'nombre_completo')).toBe(
      'El nombre no puede tener más de 50 caracteres.',
    );
    expect(fieldError({ ...valid, nombre_completo: '   ' }, 'nombre_completo')).toBe(
      'Escribe el nombre completo.',
    );
    expect(fieldError({ ...valid, nombre_completo: '' }, 'nombre_completo')).toBe(
      'Escribe el nombre completo.',
    );
  });

  it('exige todos los campos obligatorios (CA-2.1-06)', () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((issue) => issue.path.join('.'));
      expect(fields).toEqual(
        expect.arrayContaining([
          'nombre_completo',
          'telefono',
          'correo_electronico',
          'fecha_nacimiento',
          'cedula_profesional',
        ]),
      );
    }
  });

  it('exige cédula profesional obligatoria de 7 u 8 dígitos numéricos (CA-2.1-07)', () => {
    expect(fieldError({ ...valid, cedula_profesional: '123456' }, 'cedula_profesional')).toBe(
      'La cédula debe tener 7 u 8 dígitos.',
    );
    expect(fieldError({ ...valid, cedula_profesional: '123456789' }, 'cedula_profesional')).toBe(
      'La cédula debe tener 7 u 8 dígitos.',
    );
    expect(fieldError({ ...valid, cedula_profesional: '123456A' }, 'cedula_profesional')).toBe(
      'La cédula debe tener 7 u 8 dígitos.',
    );
    expect(fieldError({ ...valid, cedula_profesional: '' }, 'cedula_profesional')).toBe(
      'Escribe la cédula profesional.',
    );
    expect(fieldError({ ...valid, cedula_profesional: '1234567' }, 'cedula_profesional')).toBe(
      undefined,
    );
    expect(fieldError({ ...valid, cedula_profesional: '12345678' }, 'cedula_profesional')).toBe(
      undefined,
    );
  });

  it('exige un teléfono de exactamente 10 dígitos (CA-2.1-08)', () => {
    expect(fieldError({ ...valid, telefono: '999784521' }, 'telefono')).toBe(
      'El teléfono debe tener exactamente 10 dígitos.',
    );
    expect(fieldError({ ...valid, telefono: '99978452130' }, 'telefono')).toBe(
      'El teléfono debe tener exactamente 10 dígitos.',
    );
    expect(fieldError({ ...valid, telefono: '999-784-52' }, 'telefono')).toBe(
      'El teléfono debe tener exactamente 10 dígitos.',
    );
    expect(fieldError({ ...valid, telefono: '' }, 'telefono')).toBe('Escribe el teléfono.');
    expect(fieldError({ ...valid, telefono: '9997845213' }, 'telefono')).toBe(undefined);
  });

  it('rechaza un correo con formato inválido y exige correo obligatorio (CA-2.1-10)', () => {
    expect(
      fieldError({ ...valid, correo_electronico: 'victoria.mendez@' }, 'correo_electronico'),
    ).toBe('Escribe un correo con formato válido, por ejemplo nombre@dominio.mx.');
    expect(fieldError({ ...valid, correo_electronico: 'victoria' }, 'correo_electronico')).toBe(
      'Escribe un correo con formato válido, por ejemplo nombre@dominio.mx.',
    );
    expect(fieldError({ ...valid, correo_electronico: '' }, 'correo_electronico')).toBe(
      'Escribe el correo electrónico.',
    );
  });

  it('rechaza fecha de nacimiento igual o posterior a la fecha de registro (CA-2.1-04)', () => {
    expect(fieldError({ ...valid, fecha_nacimiento: '2026-10-09' }, 'fecha_nacimiento')).toBe(
      'La fecha de nacimiento debe ser anterior a hoy.',
    );
    expect(fieldError({ ...valid, fecha_nacimiento: '2027-01-01' }, 'fecha_nacimiento')).toBe(
      'La fecha de nacimiento debe ser anterior a hoy.',
    );
    expect(fieldError({ ...valid, fecha_nacimiento: '1988-10-08' }, 'fecha_nacimiento')).toBe(
      undefined,
    );
    expect(fieldError({ ...valid, fecha_nacimiento: '1988-02-30' }, 'fecha_nacimiento')).toBe(
      'Esa fecha no existe en el calendario.',
    );
    expect(fieldError({ ...valid, fecha_nacimiento: '19/05/1988' }, 'fecha_nacimiento')).toBe(
      'Escribe la fecha como dd/mm/aaaa.',
    );
  });

  it('valida las solicitudes de verificación de unicidad anticipada', () => {
    expect(
      therapistAvailabilitySchema.safeParse({ campo: 'telefono', valor: '9997845213' }).success,
    ).toBe(true);
    expect(
      therapistAvailabilitySchema.safeParse({ campo: 'correo', valor: 'test@uady.mx' }).success,
    ).toBe(true);
    expect(
      therapistAvailabilitySchema.safeParse({ campo: 'correo_electronico', valor: 'test@uady.mx' })
        .success,
    ).toBe(true);
    expect(
      therapistAvailabilitySchema.safeParse({ campo: 'cedula', valor: '7845213' }).success,
    ).toBe(true);
    expect(
      therapistAvailabilitySchema.safeParse({ campo: 'cedula_profesional', valor: '12345678' })
        .success,
    ).toBe(true);
    expect(
      therapistAvailabilitySchema.safeParse({ campo: 'curp', valor: 'ABCD900101HDFRRN01' }).success,
    ).toBe(false);
  });

  it('acepta excluir_id como un UUID opcional y rechaza uno con formato inválido (RF 2.2.4)', () => {
    const validId = '7b2e1a3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c';
    expect(
      therapistAvailabilitySchema.safeParse({ campo: 'telefono', valor: '9997845213' }).success,
    ).toBe(true);
    expect(
      therapistAvailabilitySchema.safeParse({
        campo: 'telefono',
        valor: '9997845213',
        excluir_id: validId,
      }).success,
    ).toBe(true);
    expect(
      therapistAvailabilitySchema.safeParse({
        campo: 'telefono',
        valor: '9997845213',
        excluir_id: 'no-es-un-uuid',
      }).success,
    ).toBe(false);
  });
});

describe('esquema de parámetros de listado (EDT 4.3.5)', () => {
  it('acepta pagina y tamano por defecto cuando no se envían', () => {
    const result = listQuerySchema.parse({});
    expect(result).toMatchObject({
      pagina: 1,
      tamano: 25,
      orden: 'nombre_completo',
      estado: 'activos',
    });
    expect(result.q).toBeUndefined();
  });

  it('acepta los tres valores de estado: activos, inactivos y todos (CA-2.2-01)', () => {
    expect(listQuerySchema.parse({ estado: 'activos' }).estado).toBe('activos');
    expect(listQuerySchema.parse({ estado: 'inactivos' }).estado).toBe('inactivos');
    expect(listQuerySchema.parse({ estado: 'todos' }).estado).toBe('todos');
    expect(listQuerySchema.safeParse({ estado: 'baja' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ estado: 'ACTIVOS' }).success).toBe(false);
  });

  it('acepta el tamaño mínimo (1) y el máximo (100), rechaza 0 y 101 (RNF 2.2.1)', () => {
    expect(listQuerySchema.safeParse({ tamano: '1' }).success).toBe(true);
    expect(listQuerySchema.safeParse({ tamano: '25' }).success).toBe(true);
    expect(listQuerySchema.safeParse({ tamano: '100' }).success).toBe(true);
    expect(listQuerySchema.safeParse({ tamano: '0' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ tamano: '101' }).success).toBe(false);
  });

  it('rechaza una página inválida', () => {
    expect(listQuerySchema.safeParse({ pagina: '0' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ pagina: 'abc' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ pagina: '2' }).success).toBe(true);
  });

  it('rechaza un orden que no sea nombre_completo o -fecha_registro', () => {
    expect(listQuerySchema.safeParse({ orden: 'cedula_profesional' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ orden: '-fecha_registro' }).success).toBe(true);
  });

  it('rechaza un parámetro desconocido', () => {
    expect(listQuerySchema.safeParse({ activo: 'false' }).success).toBe(false);
  });

  it('recorta la búsqueda y la convierte en undefined si queda vacía', () => {
    expect(listQuerySchema.parse({ q: '  Victoria  ' }).q).toBe('Victoria');
    expect(listQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });
});

describe('esquema de edición de terapeutas (EDT 4.3.5, ADR-10)', () => {
  const update = createUpdateTherapistSchema(() => registrationDate);

  it('acepta un cuerpo parcial con un solo campo además de version', () => {
    const result = update.safeParse({ version: 1, telefono: '9991234567' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ version: 1, telefono: '9991234567' });
    }
  });

  it('exige la versión; un cuerpo sin version se rechaza', () => {
    const result = update.safeParse({ telefono: '9991234567' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('version');
    }
  });

  it('acepta un cuerpo con solo version (SIN_CAMBIOS se decide en el servicio, no aquí)', () => {
    expect(update.safeParse({ version: 1 }).success).toBe(true);
  });

  it('es estricto: rechaza campos desconocidos y de solo lectura', () => {
    expect(update.safeParse({ version: 1, id: 'x' }).success).toBe(false);
    expect(update.safeParse({ version: 1, activo: false }).success).toBe(false);
    expect(update.safeParse({ version: 1, fecha_baja: '2026-10-14' }).success).toBe(false);
    expect(update.safeParse({ version: 1, foto_perfil: 'x' }).success).toBe(false);
    expect(update.safeParse({ version: 1, fecha_registro: '2026-01-01' }).success).toBe(false);
  });

  it('rechaza version no entera o no positiva, sin coerción de cadenas', () => {
    expect(update.safeParse({ version: 0 }).success).toBe(false);
    expect(update.safeParse({ version: 1.5 }).success).toBe(false);
    expect(update.safeParse({ version: '1' }).success).toBe(false);
  });

  it('aplica las mismas reglas de formato del alta a cada campo editado', () => {
    expect(update.safeParse({ version: 1, nombre_completo: '' }).success).toBe(false);
    expect(update.safeParse({ version: 1, telefono: '99912345' }).success).toBe(false);
    expect(update.safeParse({ version: 1, correo_electronico: 'no-valido' }).success).toBe(false);
    expect(update.safeParse({ version: 1, cedula_profesional: '123456' }).success).toBe(false);
  });

  it('normaliza los campos editados igual que en el registro', () => {
    const result = update.parse({
      version: 1,
      nombre_completo: '  Victoria   Méndez ',
      correo_electronico: ' Victoria.Mendez@Uady.Mx ',
    });
    expect(result).toMatchObject({
      nombre_completo: 'Victoria Méndez',
      correo_electronico: 'victoria.mendez@uady.mx',
    });
  });

  it('no acepta los alias cortos "correo" y "cedula" del registro: se derivó sin el alias', () => {
    // A diferencia del alta, la edición exige los nombres canónicos de campo.
    expect(update.safeParse({ version: 1, correo: 'victoria@uady.mx' }).success).toBe(false);
    expect(update.safeParse({ version: 1, cedula: '7845213' }).success).toBe(false);
  });

  it('la fecha de nacimiento se valida contra el "hoy" inyectado, no contra la fecha real', () => {
    // "hoy" inyectado es registrationDate (2026-10-09); esa misma fecha se rechaza aunque sea
    // anterior a la fecha real de ejecución de la prueba.
    const result = update.safeParse({ version: 1, fecha_nacimiento: registrationDate });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'La fecha de nacimiento debe ser anterior a hoy.',
      );
    }
  });

  it('"anterior a la fecha de registro" se mide contra la fecha de registro, no contra hoy (RF 2.1.9, §4.5)', () => {
    // El terapeuta se registró el 2020-01-01: una fecha de nacimiento posterior a ESE registro
    // se rechaza aunque sea anterior al día de ejecución de la prueba.
    const registeredInThePast = createUpdateTherapistSchema(() => '2020-01-01');
    expect(
      registeredInThePast.safeParse({ version: 1, fecha_nacimiento: '2019-12-31' }).success,
    ).toBe(true);
    expect(
      registeredInThePast.safeParse({ version: 1, fecha_nacimiento: '2020-06-15' }).success,
    ).toBe(false);
  });
});

describe('baja, reactivación y entrega de la fotografía (EDT 4.3.5)', () => {
  it('el cuerpo de la baja y de la reactivación es un objeto vacío y estricto', () => {
    expect(dischargeSchema.safeParse({}).success).toBe(true);
    expect(dischargeSchema.safeParse({ activo: false }).success).toBe(false);
    expect(dischargeSchema.safeParse({ fecha_baja: '2026-10-14' }).success).toBe(false);
    expect(dischargeSchema.safeParse([]).success).toBe(false);
  });

  it('el updateTherapistSchema exportado por omisión mide "hoy" con el reloj real', () => {
    // Cubre la instancia exportada (sin fábrica), a diferencia de las pruebas anteriores que usan
    // createUpdateTherapistSchema con una fecha inyectada.
    expect(updateTherapistSchema.safeParse({ version: 1 }).success).toBe(true);
  });

  it('acepta perfil o miniatura en tam, con perfil por defecto (PG-DSN-002 §5.12.2)', () => {
    expect(photoQuerySchema.parse({}).tam).toBe('perfil');
    expect(photoQuerySchema.parse({ tam: 'perfil' }).tam).toBe('perfil');
    expect(photoQuerySchema.parse({ tam: 'miniatura' }).tam).toBe('miniatura');
  });

  it('rechaza un tam distinto de perfil o miniatura, y un parámetro desconocido', () => {
    expect(photoQuerySchema.safeParse({ tam: 'original' }).success).toBe(false);
    expect(photoQuerySchema.safeParse({ tam: 'PERFIL' }).success).toBe(false);
    expect(photoQuerySchema.safeParse({ otro: '1' }).success).toBe(false);
  });

  it('valida el identificador del terapeuta como UUID', () => {
    expect(therapistIdSchema.safeParse('7b2e1a3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c').success).toBe(true);
    expect(therapistIdSchema.safeParse('no-es-un-uuid').success).toBe(false);
  });
});
