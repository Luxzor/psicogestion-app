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
  const get = (path: string) =>
    request(app).get(`/api/v1/pacientes${path}`).set('Authorization', `Bearer ${token}`);
  const patch = (id: string, body: unknown) =>
    request(app)
      .patch(`/api/v1/pacientes/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

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

  it('revierte la creación del paciente si falla la auditoría durante el alta (TC-I-005, CA-3.1-01)', async () => {
    // Configurar trigger temporal para forzar error en bitacora_acceso durante el INSERT
    await db.query(`
      CREATE OR REPLACE FUNCTION forzar_error_bitacora() RETURNS trigger AS $$
      BEGIN
        IF NEW.evento = 'paciente_registrado' THEN
          RAISE EXCEPTION 'Fallo simulado en auditoria';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_test_error_bitacora
      BEFORE INSERT ON bitacora_acceso
      FOR EACH ROW EXECUTE FUNCTION forzar_error_bitacora();
    `);

    try {
      const response = await post('', patient);
      expect(response.status).toBe(500);

      // Verificar que el paciente NO fue creado en la base de datos (ROLLBACK completo)
      const count = await db.query('SELECT count(*)::int AS total FROM paciente WHERE curp = $1', [
        patient.curp,
      ]);
      expect(count.rows[0].total).toBe(0);
    } finally {
      await db.query(`
        DROP TRIGGER IF EXISTS trg_test_error_bitacora ON bitacora_acceso;
        DROP FUNCTION IF EXISTS forzar_error_bitacora();
      `);
    }
  });

  it('recupera la confirmación del alta sin duplicar si Redis falla al guardar la respuesta completada (TC-I-029, CA-3.1-01)', async () => {
    const key = crypto.randomUUID();
    const originalSet = redis.set.bind(redis);

    // Simular que el primer intento ejecuta la operación en PostgreSQL (COMMIT exitoso),
    // pero falla la escritura en Redis para marcar 'completado'.
    let callCount = 0;
    const redisAny = redis as unknown as Record<string, unknown>;
    redisAny.set = async (...args: Parameters<typeof redis.set>) => {
      callCount++;
      if (callCount === 2) {
        // La segunda llamada es para guardar 'completado' tras el commit de postgres
        throw new Error('Redis connection lost after DB commit');
      }
      return Reflect.apply(originalSet, redis, args);
    };

    const first = await post('', patient, key);
    // Restaurar redis.set
    redis.set = originalSet;

    expect(first.status).toBe(500);

    // El paciente quedó confirmado en PostgreSQL
    const checkPatient = await db.query<{ id: string }>(
      'SELECT id, curp FROM paciente WHERE curp = $1',
      [patient.curp],
    );
    expect(checkPatient.rows.length).toBe(1);
    const existingPatientId = checkPatient.rows[0].id;

    // Al reintentar con la misma llave y los mismos datos:
    // El sistema no debe fallar con 409 duplicado ni crear un segundo paciente
    const retry = await post('', patient, key);
    expect(retry.status).toBe(201);
    expect(retry.body.codigo).toBe('PACIENTE_REGISTRADO');
    expect(retry.body.paciente.id).toBe(existingPatientId);

    const totalCount = await db.query('SELECT count(*)::int AS total FROM paciente');
    expect(totalCount.rows[0].total).toBe(1);
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

  describe('consulta y edición de pacientes (EDT 4.3.2)', () => {
    it('lista solo pacientes activos sin exponer CURP ni correo (RF 3.2.1)', async () => {
      await post('', patient);
      const inactive = await post('', other);
      await db.query('UPDATE paciente SET activo = false, fecha_baja = now() WHERE id = $1', [
        inactive.body.paciente.id,
      ]);

      const started = Date.now();
      const response = await get('');

      expect(response.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(2000); // CA-3.2-01
      expect(response.body.datos).toHaveLength(1);
      expect(response.body.datos[0]).toMatchObject({
        nombre_completo: patient.nombre_completo,
        telefono: patient.telefono,
        activo: true,
      });
      expect(response.body.datos[0]).not.toHaveProperty('curp');
      expect(response.body.datos[0]).not.toHaveProperty('correo');
      expect(response.body.datos[0].edad).toBeTypeOf('number');
    });

    it('pagina el listado y reporta el total real (RF 3.2.1)', async () => {
      for (let n = 0; n < 30; n += 1) {
        await post('', {
          ...other,
          nombre_completo: `Paciente Lote ${String(n).padStart(2, '0')}`,
          curp: `LOTE${String(n).padStart(2, '0')}0101MYNXSLA${n % 10}`,
          telefono: `999000${String(n).padStart(4, '0')}`,
          correo: undefined,
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

    it('busca por nombre sin acentos, por CURP y por teléfono (PG-DSN-002 §5.4)', async () => {
      await post('', {
        nombre_completo: 'Íñigo Muñoz Ñuñez',
        curp: 'MUNI900101HYNXSL05',
        sexo: 'M',
        fecha_nacimiento: '1990-01-01',
        telefono: '9995551234',
      });
      await post('', other);

      const sinAcentos = await get('?q=inigo%20munoz%20nunez');
      expect(sinAcentos.body.datos).toHaveLength(1);
      expect(sinAcentos.body.datos[0].nombre_completo).toBe('Íñigo Muñoz Ñuñez');

      const porCurp = await get(`?q=${other.curp.slice(0, 6)}`);
      expect(porCurp.body.datos).toHaveLength(1);
      expect(porCurp.body.datos[0].nombre_completo).toBe(other.nombre_completo);

      const porTelefono = await get(`?q=${other.telefono.slice(0, 6)}`);
      expect(porTelefono.body.datos).toHaveLength(1);
      expect(porTelefono.body.datos[0].nombre_completo).toBe(other.nombre_completo);

      const sinResultado = await get('?q=zzzzz');
      expect(sinResultado.body.datos).toHaveLength(0);
      expect(sinResultado.body.total).toBe(0);
    });

    it('muestra el perfil completo y audita la consulta con solo el id (RF 3.2.2–3.2.3)', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;

      const response = await get(`/${id}`);

      expect(response.status).toBe(200);
      expect(response.body.paciente).toMatchObject({
        id,
        nombre_completo: other.nombre_completo,
        curp: other.curp,
        sexo: other.sexo,
        telefono: other.telefono,
        correo: other.correo,
        activo: true,
      });
      expect(response.body.paciente.edad).toBeTypeOf('number');

      const log = await db.query(
        "SELECT detalle FROM bitacora_acceso WHERE evento = 'paciente_consultado'",
      );
      expect(log.rows).toEqual([{ detalle: id }]);
      expect(JSON.stringify(log.rows)).not.toContain(other.nombre_completo);
    });

    it('responde 404 al consultar un paciente inexistente', async () => {
      const response = await get(`/${crypto.randomUUID()}`);

      expect(response.status).toBe(404);
      expect(response.body.codigo).toBe('PACIENTE_NO_ENCONTRADO');
    });

    it('edita un campo y audita solo los nombres de los campos modificados (CA-3.2-03)', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;

      const started = Date.now();
      const response = await patch(id, { version: 1, telefono: '9991112222' });

      expect(response.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(3000); // CA-3.2-03
      expect(response.body.codigo).toBe('PACIENTE_ACTUALIZADO');
      expect(response.body.paciente).toMatchObject({
        telefono: '9991112222',
        nombre_completo: other.nombre_completo, // los campos no enviados se conservan
        version: 2,
      });

      const log = await db.query(
        "SELECT detalle FROM bitacora_acceso WHERE evento = 'paciente_actualizado'",
      );
      expect(log.rows).toEqual([{ detalle: `${id} campos=telefono` }]);
      expect(JSON.stringify(log.rows)).not.toContain('9991112222');
    });

    it('responde 404 al editar un paciente inexistente', async () => {
      const response = await patch(crypto.randomUUID(), { version: 1, telefono: '9991110000' });

      expect(response.status).toBe(404);
      expect(response.body.codigo).toBe('PACIENTE_NO_ENCONTRADO');
    });

    it('al editar, la edad mínima se mide contra la fecha de registro, no contra hoy (§4.5)', async () => {
      const created = await post('', other); // se registra hoy
      const id = created.body.paciente.id;

      const sevenToday = await patch(id, { version: 1, fecha_nacimiento: isoYearsAgo(7) });
      expect(sevenToday.status).toBe(200);

      const sixToday = await patch(id, { version: 2, fecha_nacimiento: isoYearsAgo(6) });
      expect(sixToday.status).toBe(400);
      expect(sixToday.body.campos.fecha_nacimiento).toBe(
        'El paciente debe tener al menos 7 años cumplidos.',
      );
    });

    it('rechaza un PATCH sin cambios reales (SIN_CAMBIOS)', async () => {
      const created = await post('', other);

      const response = await patch(created.body.paciente.id, { version: 1 });

      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('SIN_CAMBIOS');
    });

    it('rechaza una versión desfasada con el conflicto y la versión vigente (ADR-10)', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;
      await patch(id, { version: 1, telefono: '9991110000' }); // version pasa a 2

      const response = await patch(id, { version: 1, telefono: '9992220000' });

      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('CONFLICTO_VERSION');
      expect(response.body.version_actual).toBe(2);

      const stored = await db.query('SELECT telefono FROM paciente WHERE id = $1', [id]);
      expect(stored.rows[0].telefono).toBe('9991110000'); // el intento fallido no se aplicó
    });

    it('impide editar a un paciente dado de baja (PACIENTE_INACTIVO)', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;
      await db.query('UPDATE paciente SET activo = false, fecha_baja = now() WHERE id = $1', [id]);

      const response = await patch(id, { version: 1, telefono: '9991110000' });

      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('PACIENTE_INACTIVO');
    });

    it('al editar con CURP y teléfono de otro paciente, antepone CURP_EN_USO (§5.12.6)', async () => {
      await post('', other);
      const created = await post('', patient);

      const response = await patch(created.body.paciente.id, {
        version: 1,
        curp: other.curp,
        telefono: other.telefono,
      });

      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('CURP_EN_USO');
      expect(response.body.campos).toEqual({
        curp: 'Este CURP ya está registrado.',
        telefono: 'Este teléfono ya está registrado en otro paciente.',
      });
    });

    it('la verificación de unicidad excluye al propio paciente al editar (excluir_id, RF 3.2.5)', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;

      const propio = await post('/validaciones', {
        campo: 'curp',
        valor: other.curp,
        excluir_id: id,
      });
      expect(propio.body.disponible).toBe(true);

      const propioTelefono = await post('/validaciones', {
        campo: 'telefono',
        valor: other.telefono,
        excluir_id: id,
      });
      expect(propioTelefono.body.disponible).toBe(true);

      const ajeno = await post('/validaciones', { campo: 'curp', valor: other.curp });
      expect(ajeno.body.disponible).toBe(false);
    });
  });
  describe('baja lógica y reactivación de pacientes (EDT 4.3.3)', () => {
    const baja = (id: string, key?: string) => post(`/${id}/baja`, undefined, key);
    const reactivar = (id: string, key?: string) => post(`/${id}/reactivacion`, undefined, key);

    it('da de baja conservando todos los datos y la fecha de la baja (RF 3.3.1)', async () => {
      const created = await post('', { ...other, consentimiento: true });
      const id = created.body.paciente.id;

      const started = Date.now();
      const response = await baja(id);

      expect(response.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(response.body.codigo).toBe('BAJA_REGISTRADA');
      expect(response.body.paciente).toMatchObject({
        id,
        nombre_completo: other.nombre_completo,
        curp: other.curp,
        telefono: other.telefono,
        correo: other.correo,
        consentimiento: true,
        activo: false,
        fecha_baja: todayInClinic(),
        version: 2,
      });
      expect(response.body.paciente.edad).toBeTypeOf('number');

      // El registro no se borra: sigue en la tabla, con quién hizo la baja.
      const stored = await db.query(
        'SELECT activo, fecha_baja, updated_by, curp FROM paciente WHERE id = $1',
        [id],
      );
      expect(stored.rows[0]).toMatchObject({ activo: false, updated_by: userId, curp: other.curp });
      expect(stored.rows[0].fecha_baja).toBeInstanceOf(Date);
    });

    it('audita la baja solo con el identificador del paciente (ADR-14, R01)', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;

      await baja(id);

      const log = await db.query(
        "SELECT detalle, id_usuario FROM bitacora_acceso WHERE evento = 'paciente_dado_de_baja'",
      );
      expect(log.rows).toEqual([{ detalle: id, id_usuario: userId }]);
      expect(JSON.stringify(log.rows)).not.toContain(other.nombre_completo);
      expect(JSON.stringify(log.rows)).not.toContain(other.curp);
    });

    it('el paciente dado de baja sale de la lista de activos y aparece en la de bajas', async () => {
      await post('', patient);
      const created = await post('', other);
      await baja(created.body.paciente.id);

      const activos = await get('');
      expect(activos.body.total).toBe(1);
      expect(activos.body.datos[0].nombre_completo).toBe(patient.nombre_completo);

      const bajas = await get('?estado=inactivos');
      expect(bajas.body.total).toBe(1);
      expect(bajas.body.datos[0]).toMatchObject({
        id: created.body.paciente.id,
        nombre_completo: other.nombre_completo,
        activo: false,
      });
      // La lista de bajas conserva la minimización de datos de la lista de activos (R01).
      expect(bajas.body.datos[0]).not.toHaveProperty('curp');
      expect(bajas.body.datos[0]).not.toHaveProperty('correo');
    });

    it('la búsqueda respeta el filtro de estado', async () => {
      const created = await post('', other);
      await baja(created.body.paciente.id);

      const enActivos = await get('?q=canul');
      expect(enActivos.body.total).toBe(0);

      const enBajas = await get('?estado=inactivos&q=canul');
      expect(enBajas.body.total).toBe(1);

      const porTelefono = await get(`?estado=inactivos&q=${other.telefono.slice(0, 5)}`);
      expect(porTelefono.body.total).toBe(1);
    });

    it('reporta el total de bajas aunque la página quede fuera de rango', async () => {
      const created = await post('', other);
      await baja(created.body.paciente.id);

      const response = await get('?estado=inactivos&pagina=5');
      expect(response.body).toMatchObject({ total: 1, datos: [] });
    });

    it('el perfil de un paciente dado de baja sigue disponible (RF 3.2.2)', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;
      await baja(id);

      const response = await get(`/${id}`);
      expect(response.status).toBe(200);
      expect(response.body.paciente).toMatchObject({ activo: false, fecha_baja: todayInClinic() });
    });

    it('muestra el día de la baja en la zona horaria de la clínica, no en UTC', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;
      await baja(id);
      // 01:30 UTC del 14 de octubre son las 19:30 del 13 de octubre en Mérida (UTC-6).
      await db.query(
        "UPDATE paciente SET fecha_baja = '2026-10-14T01:30:00Z'::timestamptz WHERE id = $1",
        [id],
      );

      const response = await get(`/${id}`);
      expect(response.body.paciente.fecha_baja).toBe('2026-10-13');
    });

    it('no vuelve a dar de baja a un paciente inactivo ni cambia su fecha (PACIENTE_INACTIVO)', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;
      await baja(id);
      await db.query("UPDATE paciente SET fecha_baja = '2026-10-01T15:00:00Z' WHERE id = $1", [id]);

      const response = await baja(id);

      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('PACIENTE_INACTIVO');
      expect(response.body.fecha_baja).toBe('2026-10-01');
      const stored = await db.query('SELECT version FROM paciente WHERE id = $1', [id]);
      expect(stored.rows[0].version).toBe(2); // el segundo intento no modificó nada
      const log = await db.query(
        "SELECT count(*)::int AS total FROM bitacora_acceso WHERE evento = 'paciente_dado_de_baja'",
      );
      expect(log.rows[0].total).toBe(1);
    });

    it('responde 404 al dar de baja un paciente inexistente', async () => {
      const response = await baja(crypto.randomUUID());

      expect(response.status).toBe(404);
      expect(response.body.codigo).toBe('PACIENTE_NO_ENCONTRADO');
    });

    it('un reintento con la misma llave devuelve la respuesta original (ADR-13)', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;
      const key = crypto.randomUUID();

      const first = await baja(id, key);
      const retry = await baja(id, key);

      expect(first.status).toBe(200);
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual(first.body);
      const log = await db.query(
        "SELECT count(*)::int AS total FROM bitacora_acceso WHERE evento = 'paciente_dado_de_baja'",
      );
      expect(log.rows[0].total).toBe(1);
    });

    it('un paciente dado de baja no puede editarse (PACIENTE_INACTIVO)', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;
      const discharged = await baja(id);

      const response = await patch(id, {
        version: discharged.body.paciente.version,
        telefono: '9991110000',
      });

      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('PACIENTE_INACTIVO');
    });

    it('la baja sube la versión: una edición abierta antes de la baja no se aplica', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;
      await baja(id);

      const response = await patch(id, { version: 1, telefono: '9991110000' });

      expect(response.status).toBe(409);
      const stored = await db.query('SELECT telefono FROM paciente WHERE id = $1', [id]);
      expect(stored.rows[0].telefono).toBe(other.telefono);
    });

    it('el CURP y el teléfono de un paciente dado de baja siguen reservados', async () => {
      const created = await post('', other);
      await baja(created.body.paciente.id);

      const response = await post('', { ...patient, telefono: other.telefono });

      expect(response.status).toBe(409);
      expect(response.body.campos.telefono).toBeDefined();
    });

    it('reactiva desde el perfil conservando los datos anteriores', async () => {
      const created = await post('', { ...other, consentimiento: true });
      const id = created.body.paciente.id;
      await baja(id);

      const response = await reactivar(id);

      expect(response.status).toBe(200);
      expect(response.body.codigo).toBe('PACIENTE_REACTIVADO');
      expect(response.body.paciente).toMatchObject({
        id,
        nombre_completo: other.nombre_completo,
        curp: other.curp,
        telefono: other.telefono,
        correo: other.correo,
        consentimiento: true,
        activo: true,
        fecha_baja: null,
        version: 3,
      });
      expect(response.body.paciente.edad).toBeTypeOf('number');

      const activos = await get('');
      expect(activos.body.total).toBe(1);

      const log = await db.query(
        "SELECT detalle FROM bitacora_acceso WHERE evento = 'paciente_reactivado'",
      );
      expect(log.rows).toEqual([{ detalle: `${id} datos=conservados` }]);
    });

    it('no reactiva a un paciente que ya está activo (PACIENTE_ACTIVO)', async () => {
      const created = await post('', other);

      const response = await reactivar(created.body.paciente.id);

      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('PACIENTE_ACTIVO');
    });

    it('responde 404 al reactivar un paciente inexistente', async () => {
      const response = await reactivar(crypto.randomUUID());

      expect(response.status).toBe(404);
      expect(response.body.codigo).toBe('PACIENTE_NO_ENCONTRADO');
    });

    it('un reintento de la reactivación con la misma llave no falla (ADR-13)', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;
      await baja(id);
      const key = crypto.randomUUID();

      const first = await reactivar(id, key);
      const retry = await reactivar(id, key);

      expect(first.status).toBe(200);
      expect(retry.status).toBe(200);
      expect(retry.body.paciente.version).toBe(first.body.paciente.version);
    });

    it('tras reactivar se puede volver a dar de baja y editar', async () => {
      const created = await post('', other);
      const id = created.body.paciente.id;
      await baja(id);
      const restored = await reactivar(id);

      const edited = await patch(id, {
        version: restored.body.paciente.version,
        telefono: '9991110000',
      });
      expect(edited.status).toBe(200);

      const again = await baja(id);
      expect(again.status).toBe(200);
      expect(again.body.paciente.activo).toBe(false);
    });
  });
});
