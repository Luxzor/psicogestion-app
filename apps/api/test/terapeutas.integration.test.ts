import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { tokenService } from '../src/modules/auth/tokens.js';
import { db } from '../src/platform/db.js';
import { redis } from '../src/platform/redis.js';

const integration = process.env.RUN_INTEGRATION_TESTS === '1' ? describe : describe.skip;

function createPngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  Buffer.from('IHDR').copy(buf, 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  Buffer.from([0x08, 0x02, 0x00, 0x00, 0x00]).copy(buf, 24);
  buf.writeUInt32BE(0x12345678, 29);
  return buf;
}

const therapist = {
  nombre_completo: 'Victoria Méndez Rosado',
  telefono: '9997845213',
  correo_electronico: 'victoria.mendez@correo.uady.mx',
  fecha_nacimiento: '1988-05-19',
  cedula_profesional: '7845213',
};

const otherTherapist = {
  nombre_completo: 'Héctor Puerto Cámara',
  telefono: '9996123987',
  correo_electronico: 'hector.puerto@correo.uady.mx',
  fecha_nacimiento: '1979-09-03',
  cedula_profesional: '6123987',
};

integration('registro de terapeutas con servicios reales (EDT 4.3.4)', () => {
  const app = createApp();
  let token = '';
  let userId = '';

  const post = (path: string, body: unknown, key?: string) => {
    const call = request(app)
      .post(`/api/v1/terapeutas${path}`)
      .set('Authorization', `Bearer ${token}`);
    if (key) call.set('Idempotency-Key', key);
    return call.send(body as object);
  };

  beforeEach(async () => {
    await db.query(
      'TRUNCATE terapeuta, paciente, bitacora_acceso, token_recuperacion, codigo_verificacion, sesion, usuario CASCADE',
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

  it('registra un terapeuta activo y deja rastro en la bitácora (CA-2.1-01, CA-2.1-06)', async () => {
    const started = Date.now();
    const response = await post('', therapist);

    expect(response.status).toBe(201);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(response.body.codigo).toBe('TERAPEUTA_REGISTRADO');
    expect(response.body.terapeuta).toMatchObject({
      ...therapist,
      foto_perfil: null,
      foto_actualizada_en: null,
      activo: true,
      fecha_baja: null,
      version: 1,
    });

    const stored = await db.query(
      'SELECT activo, created_by, cedula_profesional FROM terapeuta WHERE cedula_profesional = $1',
      [therapist.cedula_profesional],
    );
    expect(stored.rows[0]).toMatchObject({
      activo: true,
      created_by: userId,
      cedula_profesional: therapist.cedula_profesional,
    });

    const log = await db.query(
      "SELECT detalle FROM bitacora_acceso WHERE evento = 'terapeuta_registrado'",
    );
    expect(log.rows).toEqual([{ detalle: response.body.terapeuta.id }]);
  });

  it('garantiza idempotencia con la misma llave y rechaza reutilización con otro cuerpo (CA-2.1-09)', async () => {
    const key = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const first = await post('', therapist, key);
    expect(first.status).toBe(201);

    const second = await post('', therapist, key);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);

    const count = await db.query('SELECT COUNT(*) AS total FROM terapeuta');
    expect(count.rows[0].total).toBe('1');

    const mismatch = await post('', otherTherapist, key);
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.codigo).toBe('IDEMPOTENCY_KEY_REUTILIZADA');
  });

  it('rechaza teléfono, correo o cédula duplicados sin exponer datos (CA-2.1-03, CA-2.1-07)', async () => {
    await post('', therapist);

    // Mismo teléfono
    const duplicatePhone = await post('', {
      ...otherTherapist,
      telefono: therapist.telefono,
    });
    expect(duplicatePhone.status).toBe(409);
    expect(duplicatePhone.body.codigo).toBe('TELEFONO_EN_USO');
    expect(duplicatePhone.body.campos).toHaveProperty('telefono');

    // Mismo correo (incluso en mayúsculas)
    const duplicateEmail = await post('', {
      ...otherTherapist,
      correo_electronico: therapist.correo_electronico.toUpperCase(),
    });
    expect(duplicateEmail.status).toBe(409);
    expect(duplicateEmail.body.codigo).toBe('CORREO_EN_USO');
    expect(duplicateEmail.body.campos).toHaveProperty('correo_electronico');

    // Misma cédula
    const duplicateCedula = await post('', {
      ...otherTherapist,
      cedula_profesional: therapist.cedula_profesional,
    });
    expect(duplicateCedula.status).toBe(409);
    expect(duplicateCedula.body.codigo).toBe('CEDULA_EN_USO');
    expect(duplicateCedula.body.campos).toHaveProperty('cedula_profesional');
  });

  it('verifica la disponibilidad de campos en menos de 2 segundos (CA-2.1-03)', async () => {
    await post('', therapist);

    const start = Date.now();
    const phoneTaken = await post('/validaciones', {
      campo: 'telefono',
      valor: therapist.telefono,
    });
    expect(Date.now() - start).toBeLessThan(2000);
    expect(phoneTaken.status).toBe(200);
    expect(phoneTaken.body).toEqual({
      campo: 'telefono',
      disponible: false,
      mensaje: 'Este teléfono ya está registrado en otro terapeuta.',
    });

    const phoneAvailable = await post('/validaciones', {
      campo: 'telefono',
      valor: otherTherapist.telefono,
    });
    expect(phoneAvailable.status).toBe(200);
    expect(phoneAvailable.body).toEqual({ campo: 'telefono', disponible: true });

    const emailTaken = await post('/validaciones', {
      campo: 'correo_electronico',
      valor: therapist.correo_electronico.toUpperCase(),
    });
    expect(emailTaken.status).toBe(200);
    expect(emailTaken.body.disponible).toBe(false);

    const cedulaTaken = await post('/validaciones', {
      campo: 'cedula',
      valor: therapist.cedula_profesional,
    });
    expect(cedulaTaken.status).toBe(200);
    expect(cedulaTaken.body.disponible).toBe(false);
  });

  it('sube, consulta con ETag y elimina la fotografía de perfil (RF 2.1.11 a 2.1.13, CA-2.1-05)', async () => {
    const created = await post('', therapist);
    const therapistId = created.body.terapeuta.id;
    const photoBuffer = createPngBuffer(300, 300);

    // PUT /foto
    const uploadRes = await request(app)
      .put(`/api/v1/terapeutas/${therapistId}/foto`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/png')
      .send(photoBuffer);

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.codigo).toBe('FOTO_ACTUALIZADA');
    expect(uploadRes.body.terapeuta.foto_perfil).toContain(therapistId);
    expect(uploadRes.body.terapeuta.foto_actualizada_en).toBeDefined();

    // GET /foto
    const getRes = await request(app)
      .get(`/api/v1/terapeutas/${therapistId}/foto`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.headers['content-type']).toBe('image/png');
    expect(getRes.headers['etag']).toBeDefined();
    expect(getRes.body).toEqual(photoBuffer);

    // GET /foto con If-None-Match -> 304
    const notModifiedRes = await request(app)
      .get(`/api/v1/terapeutas/${therapistId}/foto`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-None-Match', getRes.headers['etag']);

    expect(notModifiedRes.status).toBe(304);

    // DELETE /foto -> 204
    const deleteRes = await request(app)
      .delete(`/api/v1/terapeutas/${therapistId}/foto`)
      .set('Authorization', `Bearer ${token}`);

    expect(deleteRes.status).toBe(204);

    // GET posterior -> 404
    const getAfterDelete = await request(app)
      .get(`/api/v1/terapeutas/${therapistId}/foto`)
      .set('Authorization', `Bearer ${token}`);

    expect(getAfterDelete.status).toBe(404);
  });
});

