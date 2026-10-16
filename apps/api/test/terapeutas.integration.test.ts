import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { tokenService } from '../src/modules/auth/tokens.js';
import { todayInClinic } from '../src/platform/clock.js';
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
  // EDT 4.3.5: helpers añadidos para reutilizar el mismo app/token/beforeEach/afterAll de este
  // bloque (db y redis son singletons del módulo; terminarlos dos veces en el mismo archivo falla).
  const get = (path: string) =>
    request(app).get(`/api/v1/terapeutas${path}`).set('Authorization', `Bearer ${token}`);
  const patch = (id: string, body: unknown) =>
    request(app)
      .patch(`/api/v1/terapeutas/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

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

  describe('consulta y edición de terapeutas (EDT 4.3.5)', () => {
    it('lista solo terapeutas activos por defecto, sin minimizar cédula ni correo (RF 2.2.1)', async () => {
      await post('', therapist);
      const inactive = await post('', otherTherapist);
      await db.query('UPDATE terapeuta SET activo = false, fecha_baja = now() WHERE id = $1', [
        inactive.body.terapeuta.id,
      ]);

      const response = await get('');

      expect(response.status).toBe(200);
      expect(response.body.datos).toHaveLength(1);
      expect(response.body.datos[0]).toMatchObject({
        nombre_completo: therapist.nombre_completo,
        cedula_profesional: therapist.cedula_profesional,
        telefono: therapist.telefono,
        correo_electronico: therapist.correo_electronico,
        activo: true,
      });
    });

    it('acepta los tres estados: activos, inactivos y todos (CA-2.2-01)', async () => {
      const active = await post('', therapist);
      const inactive = await post('', otherTherapist);
      await db.query('UPDATE terapeuta SET activo = false, fecha_baja = now() WHERE id = $1', [
        inactive.body.terapeuta.id,
      ]);
      void active;

      const activos = await get('?estado=activos');
      expect(activos.body.total).toBe(1);

      const inactivos = await get('?estado=inactivos');
      expect(inactivos.body.total).toBe(1);
      expect(inactivos.body.datos[0].id).toBe(inactive.body.terapeuta.id);

      const todos = await get('?estado=todos');
      expect(todos.body.total).toBe(2);
    });

    it('busca por nombre sin acentos, por cédula, por teléfono y por correo (PG-DSN-002 §5.7)', async () => {
      await post('', {
        ...therapist,
        nombre_completo: 'Íñigo Muñoz Ñuñez',
        telefono: '9995551234',
        correo_electronico: 'inigo.munoz@correo.uady.mx',
        cedula_profesional: '1112223',
      });
      await post('', otherTherapist);

      const sinAcentos = await get('?q=inigo%20munoz%20nunez');
      expect(sinAcentos.body.datos).toHaveLength(1);
      expect(sinAcentos.body.datos[0].nombre_completo).toBe('Íñigo Muñoz Ñuñez');

      const porCedula = await get(`?q=${otherTherapist.cedula_profesional.slice(0, 4)}`);
      expect(porCedula.body.datos).toHaveLength(1);
      expect(porCedula.body.datos[0].nombre_completo).toBe(otherTherapist.nombre_completo);

      const porTelefono = await get(`?q=${otherTherapist.telefono.slice(0, 6)}`);
      expect(porTelefono.body.datos).toHaveLength(1);
      expect(porTelefono.body.datos[0].nombre_completo).toBe(otherTherapist.nombre_completo);

      const porCorreo = await get(`?q=${otherTherapist.correo_electronico.slice(0, 10)}`);
      expect(porCorreo.body.datos).toHaveLength(1);
      expect(porCorreo.body.datos[0].nombre_completo).toBe(otherTherapist.nombre_completo);

      const sinResultado = await get('?q=zzzzz');
      expect(sinResultado.body.datos).toHaveLength(0);
      expect(sinResultado.body.total).toBe(0);
    });

    it('pagina el listado y reporta el total real', async () => {
      for (let n = 0; n < 30; n += 1) {
        await post('', {
          ...otherTherapist,
          nombre_completo: `Terapeuta Lote ${String(n).padStart(2, '0')}`,
          telefono: `999000${String(n).padStart(4, '0')}`,
          correo_electronico: `lote${n}@correo.uady.mx`,
          cedula_profesional: `800${String(n).padStart(4, '0')}`,
        });
      }

      const first = await get('?pagina=1&tamano=25');
      expect(first.body).toMatchObject({ pagina: 1, tamano: 25, total: 30 });
      expect(first.body.datos).toHaveLength(25);

      const second = await get('?pagina=2&tamano=25');
      expect(second.body).toMatchObject({ pagina: 2, tamano: 25, total: 30 });
      expect(second.body.datos).toHaveLength(5);

      const outOfRange = await get('?pagina=99&tamano=25');
      expect(outOfRange.body).toMatchObject({ pagina: 99, total: 30 });
      expect(outOfRange.body.datos).toHaveLength(0);
    });

    it('muestra el perfil completo en menos de 2 segundos y audita la consulta con solo el id (CA-2.2-01)', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;

      const started = Date.now();
      const response = await get(`/${id}`);

      expect(response.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(response.body.terapeuta).toMatchObject({
        id,
        ...otherTherapist,
        activo: true,
      });

      const log = await db.query(
        "SELECT detalle FROM bitacora_acceso WHERE evento = 'terapeuta_consultado'",
      );
      expect(log.rows).toEqual([{ detalle: id }]);
      expect(JSON.stringify(log.rows)).not.toContain(otherTherapist.nombre_completo);
    });

    it('responde 404 al consultar un terapeuta inexistente', async () => {
      const response = await get(`/${crypto.randomUUID()}`);

      expect(response.status).toBe(404);
      expect(response.body.codigo).toBe('TERAPEUTA_NO_ENCONTRADO');
    });

    it('edita un campo, valida en menos de 3 segundos y audita solo los nombres de los campos (CA-2.2-03)', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;

      const started = Date.now();
      const response = await patch(id, { version: 1, telefono: '9991112222' });

      expect(response.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(response.body.codigo).toBe('TERAPEUTA_ACTUALIZADO');
      expect(response.body.terapeuta).toMatchObject({
        telefono: '9991112222',
        nombre_completo: otherTherapist.nombre_completo, // los campos no enviados se conservan
        version: 2,
      });

      const log = await db.query(
        "SELECT detalle FROM bitacora_acceso WHERE evento = 'terapeuta_actualizado'",
      );
      expect(log.rows).toEqual([{ detalle: `${id} campos=telefono` }]);
      expect(JSON.stringify(log.rows)).not.toContain('9991112222');
    });

    it('responde 404 al editar un terapeuta inexistente', async () => {
      const response = await patch(crypto.randomUUID(), { version: 1, telefono: '9991110000' });

      expect(response.status).toBe(404);
      expect(response.body.codigo).toBe('TERAPEUTA_NO_ENCONTRADO');
    });

    it('al editar, "anterior a la fecha de registro" se mide contra el registro, no contra hoy (RF 2.1.9, §4.5)', async () => {
      const created = await post('', otherTherapist); // se registra hoy
      const id = created.body.terapeuta.id;

      const yesterday = await patch(id, { version: 1, fecha_nacimiento: '1979-09-02' });
      expect(yesterday.status).toBe(200);

      const todayOfRegistration = await patch(id, {
        version: 2,
        fecha_nacimiento: created.body.terapeuta.fecha_registro,
      });
      expect(todayOfRegistration.status).toBe(400);
      expect(todayOfRegistration.body.campos.fecha_nacimiento).toBe(
        'La fecha de nacimiento debe ser anterior a hoy.',
      );
    });

    it('rechaza un PATCH sin cambios reales (SIN_CAMBIOS)', async () => {
      const created = await post('', otherTherapist);

      const response = await patch(created.body.terapeuta.id, { version: 1 });

      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('SIN_CAMBIOS');
    });

    it('rechaza una versión desfasada con el conflicto y la versión vigente (ADR-10)', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;
      await patch(id, { version: 1, telefono: '9991110000' }); // version pasa a 2

      const response = await patch(id, { version: 1, telefono: '9992220000' });

      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('CONFLICTO_VERSION');
      expect(response.body.version_actual).toBe(2);

      const stored = await db.query('SELECT telefono FROM terapeuta WHERE id = $1', [id]);
      expect(stored.rows[0].telefono).toBe('9991110000'); // el intento fallido no se aplicó
    });

    it('impide editar a un terapeuta dado de baja (TERAPEUTA_INACTIVO)', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;
      await db.query('UPDATE terapeuta SET activo = false, fecha_baja = now() WHERE id = $1', [id]);

      const response = await patch(id, { version: 1, telefono: '9991110000' });

      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('TERAPEUTA_INACTIVO');
    });

    it('al editar con cédula, teléfono y correo de otro terapeuta a la vez, antepone CEDULA_EN_USO (§5.12.6)', async () => {
      await post('', otherTherapist);
      const created = await post('', therapist);

      const response = await patch(created.body.terapeuta.id, {
        version: 1,
        cedula_profesional: otherTherapist.cedula_profesional,
        telefono: otherTherapist.telefono,
        correo_electronico: otherTherapist.correo_electronico,
      });

      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('CEDULA_EN_USO'); // no DATOS_EN_USO: así se decidió para la edición
      expect(response.body.campos).toEqual({
        cedula_profesional: 'Esta cédula ya está registrada en otro terapeuta.',
        telefono: 'Este teléfono ya está registrado en otro terapeuta.',
        correo_electronico: 'Este correo ya está registrado en otro terapeuta.',
      });

      // el perfil no cambió
      const unchanged = await get(`/${created.body.terapeuta.id}`);
      expect(unchanged.body.terapeuta.version).toBe(1);
    });

    it('la verificación de unicidad excluye al propio terapeuta al editar (excluir_id, RF 2.2.4)', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;

      const propioTelefono = await post('/validaciones', {
        campo: 'telefono',
        valor: otherTherapist.telefono,
        excluir_id: id,
      });
      expect(propioTelefono.body.disponible).toBe(true);

      const propiaCedula = await post('/validaciones', {
        campo: 'cedula',
        valor: otherTherapist.cedula_profesional,
        excluir_id: id,
      });
      expect(propiaCedula.body.disponible).toBe(true);

      const ajeno = await post('/validaciones', {
        campo: 'telefono',
        valor: otherTherapist.telefono,
      });
      expect(ajeno.body.disponible).toBe(false);
    });
  });

  describe('baja lógica y reactivación de terapeutas (EDT 4.3.5)', () => {
    const baja = (id: string, key?: string) => post(`/${id}/baja`, undefined, key);
    const reactivar = (id: string, key?: string) => post(`/${id}/reactivar`, undefined, key);

    it('da de baja en menos de 3 segundos conservando todos los datos (RF 2.3.1, RNF 2.3.1)', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;

      const started = Date.now();
      const response = await baja(id);

      expect(response.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(response.body.codigo).toBe('BAJA_REGISTRADA');
      expect(response.body.terapeuta).toMatchObject({
        id,
        ...otherTherapist,
        activo: false,
        fecha_baja: todayInClinic(),
        version: 2,
      });

      const stored = await db.query(
        'SELECT activo, baja_por, cedula_profesional FROM terapeuta WHERE id = $1',
        [id],
      );
      expect(stored.rows[0]).toMatchObject({
        activo: false,
        baja_por: userId,
        cedula_profesional: otherTherapist.cedula_profesional,
      });
    });

    it('la baja no borra la fotografía: sigue disponible tras darse de baja (PG-DSN-002 §5.9)', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;
      const photoBuffer = createPngBuffer(300, 300);

      await request(app)
        .put(`/api/v1/terapeutas/${id}/foto`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'image/png')
        .send(photoBuffer);

      const discharged = await baja(id);
      expect(discharged.body.terapeuta.foto_perfil).toContain(id);
      expect(discharged.body.terapeuta.foto_actualizada_en).toBeDefined();

      const getRes = await request(app)
        .get(`/api/v1/terapeutas/${id}/foto`)
        .set('Authorization', `Bearer ${token}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toEqual(photoBuffer);
    });

    it('audita la baja solo con el identificador del terapeuta (ADR-14, R01)', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;

      await baja(id);

      const log = await db.query(
        "SELECT detalle, id_usuario FROM bitacora_acceso WHERE evento = 'terapeuta_dado_de_baja'",
      );
      expect(log.rows).toEqual([{ detalle: id, id_usuario: userId }]);
      expect(JSON.stringify(log.rows)).not.toContain(otherTherapist.nombre_completo);
      expect(JSON.stringify(log.rows)).not.toContain(otherTherapist.cedula_profesional);
    });

    it('el terapeuta dado de baja sale de la lista de activos y aparece en la de bajas', async () => {
      await post('', therapist);
      const created = await post('', otherTherapist);
      await baja(created.body.terapeuta.id);

      const activos = await get('');
      expect(activos.body.total).toBe(1);
      expect(activos.body.datos[0].nombre_completo).toBe(therapist.nombre_completo);

      const bajas = await get('?estado=inactivos');
      expect(bajas.body.total).toBe(1);
      expect(bajas.body.datos[0]).toMatchObject({
        id: created.body.terapeuta.id,
        nombre_completo: otherTherapist.nombre_completo,
        activo: false,
      });
    });

    it('muestra el día de la baja en la zona horaria de la clínica, no en UTC', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;
      await baja(id);
      // 01:30 UTC del 14 de octubre son las 19:30 del 13 de octubre en Mérida (UTC-6).
      await db.query(
        "UPDATE terapeuta SET fecha_baja = '2026-10-14T01:30:00Z'::timestamptz WHERE id = $1",
        [id],
      );

      const response = await get(`/${id}`);
      expect(response.body.terapeuta.fecha_baja).toBe('2026-10-13');
    });

    it('no vuelve a dar de baja a un terapeuta inactivo ni cambia su fecha (TERAPEUTA_INACTIVO)', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;
      await baja(id);
      await db.query("UPDATE terapeuta SET fecha_baja = '2026-10-01T15:00:00Z' WHERE id = $1", [
        id,
      ]);

      const response = await baja(id);

      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('TERAPEUTA_INACTIVO');
      expect(response.body.fecha_baja).toBe('2026-10-01');
      const stored = await db.query('SELECT version FROM terapeuta WHERE id = $1', [id]);
      expect(stored.rows[0].version).toBe(2); // el segundo intento no modificó nada
      const log = await db.query(
        "SELECT count(*)::int AS total FROM bitacora_acceso WHERE evento = 'terapeuta_dado_de_baja'",
      );
      expect(log.rows[0].total).toBe(1);
    });

    it('responde 404 al dar de baja un terapeuta inexistente', async () => {
      const response = await baja(crypto.randomUUID());

      expect(response.status).toBe(404);
      expect(response.body.codigo).toBe('TERAPEUTA_NO_ENCONTRADO');
    });

    it('un reintento con la misma llave devuelve la respuesta original (ADR-13)', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;
      const key = crypto.randomUUID();

      const first = await baja(id, key);
      const retry = await baja(id, key);

      expect(first.status).toBe(200);
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual(first.body);
      const log = await db.query(
        "SELECT count(*)::int AS total FROM bitacora_acceso WHERE evento = 'terapeuta_dado_de_baja'",
      );
      expect(log.rows[0].total).toBe(1);
    });

    it('un terapeuta dado de baja no puede editarse (TERAPEUTA_INACTIVO)', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;
      const discharged = await baja(id);

      const response = await patch(id, {
        version: discharged.body.terapeuta.version,
        telefono: '9991110000',
      });

      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('TERAPEUTA_INACTIVO');
    });

    it('la baja sube la versión: una edición abierta antes de la baja no se aplica', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;
      await baja(id);

      const response = await patch(id, { version: 1, telefono: '9991110000' });

      expect(response.status).toBe(409);
      const stored = await db.query('SELECT telefono FROM terapeuta WHERE id = $1', [id]);
      expect(stored.rows[0].telefono).toBe(otherTherapist.telefono);
    });

    it('el teléfono, el correo y la cédula de un terapeuta dado de baja siguen reservados', async () => {
      const created = await post('', otherTherapist);
      await baja(created.body.terapeuta.id);

      const response = await post('', { ...therapist, telefono: otherTherapist.telefono });

      expect(response.status).toBe(409);
      expect(response.body.campos.telefono).toBeDefined();
    });

    it('reactiva en menos de 3 segundos y audita solo el id (RF 2.3.4, RNF 2.3.1)', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;
      await baja(id);

      const started = Date.now();
      const response = await reactivar(id);

      expect(response.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(response.body.codigo).toBe('TERAPEUTA_REACTIVADO');
      expect(response.body.terapeuta).toMatchObject({
        id,
        ...otherTherapist,
        activo: true,
        fecha_baja: null,
        version: 3,
      });

      const activos = await get('');
      expect(activos.body.total).toBe(1);

      const stored = await db.query('SELECT baja_por FROM terapeuta WHERE id = $1', [id]);
      expect(stored.rows[0].baja_por).toBeNull();

      const log = await db.query(
        "SELECT detalle FROM bitacora_acceso WHERE evento = 'terapeuta_reactivado'",
      );
      expect(log.rows).toEqual([{ detalle: id }]);
    });

    it('no reactiva a un terapeuta que ya está activo (TERAPEUTA_ACTIVO)', async () => {
      const created = await post('', otherTherapist);

      const response = await reactivar(created.body.terapeuta.id);

      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('TERAPEUTA_ACTIVO');
    });

    it('responde 404 al reactivar un terapeuta inexistente', async () => {
      const response = await reactivar(crypto.randomUUID());

      expect(response.status).toBe(404);
      expect(response.body.codigo).toBe('TERAPEUTA_NO_ENCONTRADO');
    });

    it('un reintento de la reactivación con la misma llave no falla (ADR-13)', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;
      await baja(id);
      const key = crypto.randomUUID();

      const first = await reactivar(id, key);
      const retry = await reactivar(id, key);

      expect(first.status).toBe(200);
      expect(retry.status).toBe(200);
      expect(retry.body.terapeuta.version).toBe(first.body.terapeuta.version);
    });

    it('tras reactivar se puede volver a dar de baja y editar', async () => {
      const created = await post('', otherTherapist);
      const id = created.body.terapeuta.id;
      await baja(id);
      const restored = await reactivar(id);

      const edited = await patch(id, {
        version: restored.body.terapeuta.version,
        telefono: '9991110000',
      });
      expect(edited.status).toBe(200);

      const again = await baja(id);
      expect(again.status).toBe(200);
      expect(again.body.terapeuta.activo).toBe(false);
    });
  });
});
