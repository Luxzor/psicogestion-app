import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { tokenService } from '../src/modules/auth/tokens.js';
import { todayInClinic } from '../src/platform/clock.js';
import { db } from '../src/platform/db.js';
import { redis } from '../src/platform/redis.js';

const integration = process.env.RUN_INTEGRATION_TESTS === '1' ? describe : describe.skip;

const isoYearsAgo = (years: number) => {
  const [year, month, day] = todayInClinic().split('-');
  return `${Number(year) - years}-${month}-${day}`;
};

const patient = {
  nombre_completo: 'Valeria Ku Escalante',
  curp: 'KUEV090825MYNXSLA3',
  sexo: 'F',
  fecha_nacimiento: '2009-08-25',
  telefono: '9996402218',
};
const other = {
  nombre_completo: 'Ana Sofía Canul Pech',
  curp: 'CAPA980314MYNNCN08',
  sexo: 'F',
  fecha_nacimiento: '1998-03-14',
  telefono: '9992143381',
  correo: 'anasofia.canul@gmail.com',
};

integration('registro de pacientes con servicios reales', () => {
  const app = createApp();
  let token = '';
  let userId = '';

  const post = (path: string, body: unknown, key?: string) => {
    const call = request(app)
      .post(`/api/v1/pacientes${path}`)
      .set('Authorization', `Bearer ${token}`);
    if (key) call.set('Idempotency-Key', key);
    return call.send(body as object);
  };

  beforeEach(async () => {
    await db.query(
      'TRUNCATE paciente, bitacora_acceso, token_recuperacion, codigo_verificacion, sesion, usuario CASCADE',
    );
    await redis.flushdb();
    const user = await db.query<{ id: string }>(
      `INSERT INTO usuario (nombre_completo, telefono, correo_institucional, hash_contrasena, estado)
       VALUES ('Julia Pérez', '9990000001', 'julia.perez@uady.mx', 'hash', 'activo')
       RETURNING id`,
    );
    userId = user.rows[0].id;
    token = tokenService.createAccessToken({ id: userId, rol: 'administrador' });
  });

  afterAll(async () => {
    await Promise.allSettled([db.end(), redis.quit()]);
  });

  it('registra un paciente activo y deja rastro en la bitácora (CA-3.1-01)', async () => {
    const started = Date.now();
    const response = await post('', { ...patient, consentimiento: true });

    expect(response.status).toBe(201);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(response.body.codigo).toBe('PACIENTE_REGISTRADO');
    expect(response.body.paciente).toMatchObject({
      ...patient,
      correo: null,
      consentimiento: true,
      activo: true,
      version: 1,
    });

    const stored = await db.query(
      'SELECT activo, created_by, consentimiento_en FROM paciente WHERE curp = $1',
      [patient.curp],
    );
    expect(stored.rows[0]).toMatchObject({ activo: true, created_by: userId });
    expect(stored.rows[0].consentimiento_en).toBeInstanceOf(Date);

    const log = await db.query(
      "SELECT detalle FROM bitacora_acceso WHERE evento = 'paciente_registrado'",
    );
    expect(log.rows).toEqual([{ detalle: response.body.paciente.id }]);
  });

  it('acepta exactamente 7 años y rechaza menos de 7 (CA-3.1-04)', async () => {
    const seven = await post('', { ...patient, fecha_nacimiento: isoYearsAgo(7) });
    expect(seven.status).toBe(201);

    const six = await post('', {
      ...other,
      fecha_nacimiento: isoYearsAgo(6),
    });
    expect(six.status).toBe(400);
    expect(six.body.campos.fecha_nacimiento).toBe(
      'El paciente debe tener al menos 7 años cumplidos.',
    );
  });

  it('rechaza CURP y teléfono duplicados sin exponer datos de otros pacientes (CA-3.1-03)', async () => {
    await post('', other);

    const response = await post('', { ...patient, curp: other.curp, telefono: other.telefono });

    expect(response.status).toBe(409);
    expect(response.body.codigo).toBe('DATOS_EN_USO');
    expect(response.body.campos).toEqual({
      curp: 'Este CURP ya está registrado.',
      telefono: 'Este teléfono ya está registrado en otro paciente.',
    });
    expect(JSON.stringify(response.body)).not.toContain(other.nombre_completo);
    const count = await db.query('SELECT count(*)::int AS total FROM paciente');
    expect(count.rows[0].total).toBe(1);
  });

  it('verifica la unicidad anticipada en menos de 2 segundos (RNF 3.1.3)', async () => {
    await post('', other);

    const started = Date.now();
    const curp = await post('/validaciones', { campo: 'curp', valor: other.curp.toLowerCase() });
    const phone = await post('/validaciones', { campo: 'telefono', valor: other.telefono });
    const free = await post('/validaciones', { campo: 'telefono', valor: patient.telefono });

    expect(Date.now() - started).toBeLessThan(2000);
    expect(curp.body).toEqual({
      campo: 'curp',
      disponible: false,
      mensaje: 'Este CURP ya está registrado.',
    });
    expect(phone.body.disponible).toBe(false);
    expect(free.body).toEqual({ campo: 'telefono', disponible: true });
  });

  it('no duplica el registro cuando se reintenta con la misma llave (ADR-13)', async () => {
    const key = crypto.randomUUID();
    const first = await post('', patient, key);
    const retry = await post('', patient, key);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.paciente.id).toBe(first.body.paciente.id);
    const count = await db.query('SELECT count(*)::int AS total FROM paciente');
    expect(count.rows[0].total).toBe(1);

    const reused = await post('', { ...patient, nombre_completo: 'Otro Nombre' }, key);
    expect(reused.status).toBe(422);
  });

  it('libera la llave cuando la operación falla para permitir corregir y reintentar', async () => {
    await post('', other);
    const key = crypto.randomUUID();

    const failed = await post('', { ...patient, telefono: other.telefono }, key);
    expect(failed.status).toBe(409);

    const retried = await post('', { ...patient, telefono: other.telefono }, key);
    expect(retried.status).toBe(409);
  });

  it('ofrece y ejecuta la reactivación de un paciente dado de baja por CURP', async () => {
    const created = await post('', other);
    await db.query('UPDATE paciente SET activo = false, fecha_baja = now() WHERE id = $1', [
      created.body.paciente.id,
    ]);

    const availability = await post('/validaciones', { campo: 'curp', valor: other.curp });
    expect(availability.body).toEqual({ campo: 'curp', disponible: true, dado_de_baja: true });

    const phoneOfInactive = await post('/validaciones', {
      campo: 'telefono',
      valor: other.telefono,
      curp: other.curp,
    });
    expect(phoneOfInactive.body.disponible).toBe(true);

    const capture = { ...other, telefono: '9997712045', correo: 'rosa@gmail.com' };
    const attempt = await post('', capture);
    expect(attempt.status).toBe(409);
    expect(attempt.body.codigo).toBe('PACIENTE_DADO_DE_BAJA');
    expect(attempt.body.paciente).toMatchObject({
      id: created.body.paciente.id,
      nombre_completo: other.nombre_completo,
    });
    expect(attempt.body.campos).toBeUndefined();

    const reactivated = await post(`/${created.body.paciente.id}/reactivacion`, capture);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.codigo).toBe('PACIENTE_REACTIVADO');
    expect(reactivated.body.paciente).toMatchObject({
      telefono: '9997712045',
      correo: 'rosa@gmail.com',
      activo: true,
      fecha_baja: null,
      version: 2,
    });

    const again = await post(`/${created.body.paciente.id}/reactivacion`, capture);
    expect(again.status).toBe(409);
    expect(again.body.codigo).toBe('PACIENTE_ACTIVO');
  });

  it('no reactiva si el CURP capturado no corresponde al paciente', async () => {
    const created = await post('', other);
    await db.query('UPDATE paciente SET activo = false, fecha_baja = now() WHERE id = $1', [
      created.body.paciente.id,
    ]);

    const response = await post(`/${created.body.paciente.id}/reactivacion`, patient);

    expect(response.status).toBe(400);
    expect(response.body.campos.curp).toBeDefined();
  });

  it('aplica las restricciones de la base de datos aunque se omita la capa de servicio', async () => {
    await expect(
      db.query(
        `INSERT INTO paciente (nombre_completo, curp, sexo, fecha_nacimiento, telefono)
         VALUES ('X', 'NOVALIDO', 'F', '2000-01-01', '9990000000')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
