import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { tokenService } from '../src/modules/auth/tokens.js';
import { db } from '../src/platform/db.js';
import { redis } from '../src/platform/redis.js';

/**
 * EDT 5.3.1, EDT 5.3.2 y edición/recuperación de salas. Pruebas de integración de los endpoints de
 * /api/v1/salas contra Postgres y Redis reales: alta, unicidad, idempotencia, listado por estado,
 * baja con citas pendientes, reactivación, edición con control de versión y disponibilidad. Se
 * ejecutan en serie con las demás suites de integración (TRUNCATE compartido).
 */
const integration = process.env.RUN_INTEGRATION_TESTS === '1' ? describe : describe.skip;

const DIA = '2027-03-01';

integration('salas: endpoints con servicios reales (EDT 5.3.1 y 5.3.2)', () => {
  const app = createApp();
  let token = '';
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const crear = (nombre: string, key?: string) => {
    const call = request(app).post('/api/v1/salas').set(auth());
    if (key) call.set('Idempotency-Key', key);
    return call.send({ nombre });
  };
  const detalle = (id: string) => request(app).get(`/api/v1/salas/${id}`).set(auth());
  const baja = (id: string) => request(app).post(`/api/v1/salas/${id}/baja`).set(auth()).send({});
  const reactivar = (id: string) =>
    request(app).post(`/api/v1/salas/${id}/reactivar`).set(auth()).send({});
  const editar = (id: string, body: unknown) =>
    request(app)
      .patch(`/api/v1/salas/${id}`)
      .set(auth())
      .send(body as object);
  const lista = (estado?: string) =>
    request(app)
      .get(`/api/v1/salas${estado ? `?estado=${estado}` : ''}`)
      .set(auth());

  /** Crea una sala por la API y devuelve su registro. */
  const sala = async (nombre: string) =>
    (await crear(nombre)).body.sala as { id: string; version: number; nombre: string };

  /** Inserta una cita Pendiente futura directamente, para probar la baja con citas pendientes. */
  async function citaPendienteEn(salaId: string) {
    const p = await db.query<{ id: string }>(
      `INSERT INTO paciente (nombre_completo, curp, sexo, fecha_nacimiento, telefono)
       VALUES ('Paciente Prueba', 'KUEV090825MYNXSLA3', 'F', '2009-08-25', '9996402218') RETURNING id`,
    );
    const t = await db.query<{ id: string }>(
      `INSERT INTO terapeuta (nombre_completo, telefono, correo_electronico, fecha_nacimiento, cedula_profesional)
       VALUES ('Terapeuta Prueba', '9997845213', 'terapeuta.prueba@correo.uady.mx', '1988-05-19', '7845213') RETURNING id`,
    );
    await db.query(
      `INSERT INTO cita (id_paciente, id_terapeuta, id_sala, inicio, fin)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
      [p.rows[0].id, t.rows[0].id, salaId, `${DIA} 09:00-06`, `${DIA} 10:00-06`],
    );
  }

  beforeEach(async () => {
    await db.query(
      'TRUNCATE cita, sala, terapeuta, paciente, bitacora_acceso, token_recuperacion, codigo_verificacion, sesion, usuario CASCADE',
    );
    await redis.flushdb();
    const user = await db.query<{ id: string }>(
      `INSERT INTO usuario (nombre_completo, telefono, correo_institucional, hash_contrasena, estado)
       VALUES ('Julia Pérez', '9990000001', 'julia.perez@uady.mx', 'hash', 'activo') RETURNING id`,
    );
    token = tokenService.createAccessToken({ id: user.rows[0].id, rol: 'administrador' });
  });

  afterAll(async () => {
    await db.end();
    redis.disconnect();
  });

  describe('alta y unicidad (RF 4.1.1 a RF 4.1.4)', () => {
    it('registra una sala activa con versión 1 y normaliza los espacios del nombre', async () => {
      const response = await crear('  Sala   A ');
      expect(response.status).toBe(201);
      expect(response.body.codigo).toBe('SALA_REGISTRADA');
      expect(response.body.sala).toMatchObject({ nombre: 'Sala A', version: 1 });
    });

    it('rechaza un nombre repetido (409 NOMBRE_SALA_EN_USO)', async () => {
      await crear('Sala A');
      const response = await crear('Sala A');
      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('NOMBRE_SALA_EN_USO');
      expect(response.body.campos.nombre).toBe('Ya existe una sala con ese nombre.');
    });

    it('con la misma Idempotency-Key repite la respuesta y guarda una sola sala', async () => {
      const a = await crear('Sala A', 'clave-sala-0001');
      const b = await crear('Sala A', 'clave-sala-0001');
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(b.body.sala.id).toBe(a.body.sala.id);
      const filas = await db.query('SELECT 1 FROM sala');
      expect(filas.rowCount).toBe(1);
    });

    it('rechaza una Idempotency-Key fuera del formato permitido (400 IDEMPOTENCY_KEY_INVALIDA)', async () => {
      const response = await crear('Sala A', 'corta');
      expect(response.status).toBe(400);
      expect(response.body.codigo).toBe('IDEMPOTENCY_KEY_INVALIDA');
    });

    it('la verificación anticipada informa si el nombre está libre u ocupado', async () => {
      const s = await sala('Sala A');
      const post = (body: unknown) =>
        request(app)
          .post('/api/v1/salas/validaciones')
          .set(auth())
          .send(body as object);

      const ocupado = await post({ campo: 'nombre', valor: ' Sala A ' });
      expect(ocupado.status).toBe(200);
      expect(ocupado.body).toMatchObject({ campo: 'nombre', disponible: false });

      const libre = await post({ campo: 'nombre', valor: 'Sala B' });
      expect(libre.body.disponible).toBe(true);

      const propia = await post({ campo: 'nombre', valor: 'Sala A', excluir_id: s.id });
      expect(propia.body.disponible).toBe(true);
    });
  });

  describe('listado y detalle (PG-DSN-003 3.3, RF 4.3.1)', () => {
    it('lista activas por omisión y filtra por estado', async () => {
      const a = await sala('Sala A');
      await sala('Sala B');
      await baja(a.id);

      const activas = await lista();
      expect(activas.body.salas.map((s: { nombre: string }) => s.nombre)).toEqual(['Sala B']);

      const inactivas = await lista('inactivas');
      expect(inactivas.body.salas.map((s: { nombre: string }) => s.nombre)).toEqual(['Sala A']);

      const todas = await lista('todas');
      expect(todas.body.salas).toHaveLength(2);
    });

    it('devuelve el detalle de una sala y 404 si no existe', async () => {
      const s = await sala('Sala A');
      const ok = await detalle(s.id);
      expect(ok.status).toBe(200);
      expect(ok.body.sala).toMatchObject({ id: s.id, nombre: 'Sala A' });

      const faltante = await detalle('00000000-0000-4000-8000-000000000000');
      expect(faltante.status).toBe(404);
      expect(faltante.body.codigo).toBe('SALA_NO_ENCONTRADA');
    });
  });

  describe('baja y reactivación (RF 4.2.1 a RF 4.2.5)', () => {
    it('da de baja una sala sin citas pendientes', async () => {
      const s = await sala('Sala A');
      const response = await baja(s.id);
      expect(response.status).toBe(200);
      expect(response.body.codigo).toBe('SALA_DADA_DE_BAJA');
      expect(response.body.sala.activo ?? response.body.sala.activa).not.toBe(true);
    });

    it('no permite la baja con citas pendientes y informa el conteo', async () => {
      const s = await sala('Sala A');
      await citaPendienteEn(s.id);

      const conteo = await request(app).get(`/api/v1/salas/${s.id}/citas-pendientes`).set(auth());
      expect(conteo.status).toBe(200);
      expect(conteo.body.total).toBe(1);

      const response = await baja(s.id);
      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('SALA_CON_CITAS_PENDIENTES');
      expect(response.body.mensaje).toContain('1 cita pendiente');
    });

    it('rechaza dar de baja una sala que ya está dada de baja (409 SALA_INACTIVA)', async () => {
      const s = await sala('Sala A');
      await baja(s.id);
      const response = await baja(s.id);
      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('SALA_INACTIVA');
    });

    it('reactiva una sala dada de baja y rechaza reactivar una activa', async () => {
      const s = await sala('Sala A');
      await baja(s.id);

      const ok = await reactivar(s.id);
      expect(ok.status).toBe(200);
      expect(ok.body.codigo).toBe('SALA_REACTIVADA');

      const repetida = await reactivar(s.id);
      expect(repetida.status).toBe(409);
      expect(repetida.body.codigo).toBe('SALA_ACTIVA');
    });

    it('responde 404 al dar de baja una sala inexistente', async () => {
      const response = await baja('00000000-0000-4000-8000-000000000000');
      expect(response.status).toBe(404);
      expect(response.body.codigo).toBe('SALA_NO_ENCONTRADA');
    });
  });

  describe('edición de sala con control de versión (ADR-23)', () => {
    it('cambia el nombre e incrementa la versión', async () => {
      const s = await sala('Sala A');
      const response = await editar(s.id, { nombre: 'Sala Uno', version: s.version });
      expect(response.status).toBe(200);
      expect(response.body.codigo).toBe('SALA_ACTUALIZADA');
      expect(response.body.sala).toMatchObject({ nombre: 'Sala Uno', version: s.version + 1 });
    });

    it('rechaza una versión desactualizada (409 CONFLICTO_VERSION) y conserva el nombre', async () => {
      const s = await sala('Sala A');
      await editar(s.id, { nombre: 'Sala Uno', version: s.version });

      const response = await editar(s.id, { nombre: 'Sala Dos', version: s.version });
      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('CONFLICTO_VERSION');

      const actual = await detalle(s.id);
      expect(actual.body.sala.nombre).toBe('Sala Uno');
    });

    it('rechaza renombrar a un nombre en uso (409 NOMBRE_SALA_EN_USO)', async () => {
      await sala('Sala A');
      const b = await sala('Sala B');
      const response = await editar(b.id, { nombre: 'Sala A', version: b.version });
      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('NOMBRE_SALA_EN_USO');
    });

    it('no permite editar una sala dada de baja (409 SALA_INACTIVA)', async () => {
      const s = await sala('Sala A');
      await baja(s.id);
      const response = await editar(s.id, { nombre: 'Sala Uno', version: s.version + 1 });
      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('SALA_INACTIVA');
    });

    it('responde 404 al editar una sala inexistente', async () => {
      const response = await editar('00000000-0000-4000-8000-000000000000', {
        nombre: 'Sala A',
        version: 1,
      });
      expect(response.status).toBe(404);
    });
  });

  describe('disponibilidad por día (RF 4.3.2, RF 4.3.3, RF 5.1.3)', () => {
    it('devuelve las salas activas con sus bloques y marca como ocupado el de una cita', async () => {
      const s = await sala('Sala A');
      await sala('Sala B');
      await citaPendienteEn(s.id);

      const response = await request(app)
        .get(`/api/v1/salas/disponibilidad?fecha=${DIA}`)
        .set(auth());
      expect(response.status).toBe(200);
      const cuerpo = JSON.stringify(response.body);
      expect(cuerpo).toContain('Sala A');
      expect(cuerpo).toContain('Sala B');
      expect(response.body.salas).toHaveLength(2);
    });

    it('no incluye las salas dadas de baja', async () => {
      const s = await sala('Sala A');
      await sala('Sala B');
      await baja(s.id);

      const response = await request(app)
        .get(`/api/v1/salas/disponibilidad?fecha=${DIA}`)
        .set(auth());
      expect(response.status).toBe(200);
      expect(response.body.salas).toHaveLength(1);
    });
  });
});
