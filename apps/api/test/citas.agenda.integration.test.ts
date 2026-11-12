import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { tokenService } from '../src/modules/auth/tokens.js';
import { clinicDateTimeToUtc } from '../src/modules/citas/horario.js';
import { citaService } from '../src/modules/citas/service.js';
import { db } from '../src/platform/db.js';
import { redis } from '../src/platform/redis.js';

/**
 * EDT 6.3 (agenda) y pantalla de inicio. Pruebas de integración de GET /api/v1/citas/agenda y
 * GET /api/v1/citas/dashboard/resumen contra Postgres y Redis reales. Complementan las pruebas de
 * sesión y validación de citas.routes.test.ts. Se ejecutan en serie con las demás suites de
 * integración (TRUNCATE compartido).
 */
const integration = process.env.RUN_INTEGRATION_TESTS === '1' ? describe : describe.skip;

const ZONA = 'America/Merida';
const DIA = '2027-03-01'; // lunes futuro, sin horario de verano
const DIA_SIGUIENTE = '2027-03-02';
const PASADO = '2023-05-10';

const at = (fecha: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const instant = clinicDateTimeToUtc(fecha, h * 60 + m, ZONA);
  if (!instant) throw new Error(`Hora inválida: ${fecha} ${hhmm}`);
  return instant;
};

integration('agenda y resumen de inicio con servicios reales (EDT 6.3)', () => {
  const app = createApp();
  let token = '';
  let paciente = '';
  let pacienteB = '';
  let pacienteInactivo = '';
  let terapeutaA = '';
  let terapeutaB = '';
  let salaA = '';
  let salaB = '';

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const agenda = (query: string) => request(app).get(`/api/v1/citas/agenda?${query}`).set(auth());
  const resumen = () => request(app).get('/api/v1/citas/dashboard/resumen').set(auth());

  async function cita(
    salaId: string,
    terapeutaId: string,
    fecha: string,
    desde: string,
    hasta: string,
    idPaciente = paciente,
  ) {
    const result = await db.query<{ id: string; folio: string }>(
      `INSERT INTO cita (id_paciente, id_terapeuta, id_sala, inicio, fin)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, folio`,
      [idPaciente, terapeutaId, salaId, at(fecha, desde), at(fecha, hasta)],
    );
    return result.rows[0];
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

    const pacientes = await db.query<{ id: string }>(
      `INSERT INTO paciente (nombre_completo, curp, sexo, fecha_nacimiento, telefono)
       VALUES ('Valeria Ku Escalante', 'KUEV090825MYNXSLA3', 'F', '2009-08-25', '9996402218'),
              ('Ana Sofía Canul Pech', 'CAPA980314MYNNCN08', 'F', '1998-03-14', '9992143381'),
              ('Rosa Itzel Chan Dzul', 'DUPZ970101MYNZLRA5', 'F', '1997-01-01', '9991112222')
       RETURNING id`,
    );
    [paciente, pacienteB, pacienteInactivo] = pacientes.rows.map((r) => r.id);
    await db.query('UPDATE paciente SET activo = false, fecha_baja = now() WHERE id = $1', [
      pacienteInactivo,
    ]);

    const terapeutas = await db.query<{ id: string }>(
      `INSERT INTO terapeuta (nombre_completo, telefono, correo_electronico, fecha_nacimiento, cedula_profesional)
       VALUES ('Victoria Méndez Rosado', '9997845213', 'victoria.mendez@correo.uady.mx', '1988-05-19', '7845213'),
              ('Héctor Puerto Cámara', '9996123987', 'hector.puerto@correo.uady.mx', '1979-09-03', '6123987')
       RETURNING id`,
    );
    [terapeutaA, terapeutaB] = terapeutas.rows.map((r) => r.id);

    const salas = await db.query<{ id: string }>(
      `INSERT INTO sala (nombre) VALUES ('Sala A'), ('Sala B') RETURNING id`,
    );
    [salaA, salaB] = salas.rows.map((r) => r.id);
  });

  afterAll(async () => {
    await db.end();
    redis.disconnect();
  });

  describe('GET /citas/agenda (RF 6.1.1, RF 6.1.2, RF 6.2.1–6.2.3)', () => {
    it('devuelve las citas del rango en orden cronológico con el detalle de cada una', async () => {
      await cita(salaB, terapeutaB, DIA, '11:00', '12:00');
      const primera = await cita(salaA, terapeutaA, DIA, '09:00', '10:00');

      const response = await agenda(`desde=${DIA}&hasta=${DIA}`);
      expect(response.status).toBe(200);
      expect(response.body.citas).toHaveLength(2);
      expect(response.body.citas[0]).toMatchObject({
        id: primera.id,
        folio: primera.folio,
        estado: 'Pendiente',
        paciente: { nombre_completo: 'Valeria Ku Escalante' },
        terapeuta: { nombre_completo: 'Victoria Méndez Rosado' },
        sala: { nombre: 'Sala A' },
      });
      expect(new Date(response.body.citas[0].inicio).getTime()).toBeLessThan(
        new Date(response.body.citas[1].inicio).getTime(),
      );
    });

    it('incluye el día final del rango y deja fuera los días de fuera', async () => {
      await cita(salaA, terapeutaA, DIA, '16:00', '17:00');
      await cita(salaA, terapeutaA, DIA_SIGUIENTE, '08:00', '09:00');

      const soloLunes = await agenda(`desde=${DIA}&hasta=${DIA}`);
      expect(soloLunes.body.citas).toHaveLength(1);

      const ambos = await agenda(`desde=${DIA}&hasta=${DIA_SIGUIENTE}`);
      expect(ambos.body.citas).toHaveLength(2);

      const solo2 = await agenda(`desde=${DIA_SIGUIENTE}&hasta=${DIA_SIGUIENTE}`);
      expect(solo2.body.citas).toHaveLength(1);
    });

    it('devuelve una lista vacía cuando no hay citas en el rango', async () => {
      const response = await agenda(`desde=${DIA}&hasta=${DIA_SIGUIENTE}`);
      expect(response.status).toBe(200);
      expect(response.body.citas).toEqual([]);
    });

    it('oculta las canceladas por omisión y las muestra con canceladas=true', async () => {
      const activa = await cita(salaA, terapeutaA, DIA, '09:00', '10:00');
      const cancelada = await cita(salaA, terapeutaA, DIA, '10:00', '11:00');
      const cancelar = await request(app)
        .post(`/api/v1/citas/${cancelada.id}/cancelar`)
        .set(auth())
        .send({ version: 1 });
      expect(cancelar.status).toBe(200);

      const sin = await agenda(`desde=${DIA}&hasta=${DIA}`);
      expect(sin.body.citas.map((c: { id: string }) => c.id)).toEqual([activa.id]);

      for (const valor of ['true', '1']) {
        const con = await agenda(`desde=${DIA}&hasta=${DIA}&canceladas=${valor}`);
        expect(con.body.citas).toHaveLength(2);
        expect(con.body.citas.find((c: { id: string }) => c.id === cancelada.id).estado).toBe(
          'Cancelada',
        );
      }
    });

    it('filtra por sala y por terapeuta, solos y combinados', async () => {
      const a = await cita(salaA, terapeutaA, DIA, '09:00', '10:00');
      const b = await cita(salaB, terapeutaB, DIA, '09:00', '10:00', pacienteB);
      await cita(salaA, terapeutaB, DIA, '11:00', '12:00');

      const porSala = await agenda(`desde=${DIA}&hasta=${DIA}&id_sala=${salaB}`);
      expect(porSala.body.citas.map((c: { id: string }) => c.id)).toEqual([b.id]);

      const porTerapeuta = await agenda(`desde=${DIA}&hasta=${DIA}&id_terapeuta=${terapeutaA}`);
      expect(porTerapeuta.body.citas.map((c: { id: string }) => c.id)).toEqual([a.id]);

      const combinado = await agenda(
        `desde=${DIA}&hasta=${DIA}&id_sala=${salaA}&id_terapeuta=${terapeutaB}`,
      );
      expect(combinado.body.citas).toHaveLength(1);
    });

    it('marca como Vencida una cita pendiente que ya pasó (ADR-18)', async () => {
      await cita(salaA, terapeutaA, PASADO, '09:00', '10:00');
      const response = await agenda(`desde=${PASADO}&hasta=${PASADO}`);
      expect(response.status).toBe(200);
      expect(response.body.citas).toHaveLength(1);
      expect(response.body.citas[0].estado).toBe('Vencida');
    });

    it('rechaza fechas con formato inválido o con el rango invertido (400)', async () => {
      const formato = await agenda('desde=01/03/2027&hasta=2027-03-02');
      expect(formato.status).toBe(400);
      expect(formato.body.codigo).toBe('VALIDACION_INVALIDA');

      const invertido = await agenda(`desde=${DIA_SIGUIENTE}&hasta=${DIA}`);
      expect(invertido.status).toBe(400);
    });

    it('rechaza un id_sala que no es UUID', async () => {
      const response = await agenda(`desde=${DIA}&hasta=${DIA}&id_sala=123`);
      expect(response.status).toBe(400);
    });
  });

  describe('GET /citas/dashboard/resumen (RF 7.1.1, RF 7.2.1–7.2.5)', () => {
    it('cuenta salas activas, terapeutas activos y citas pendientes en total', async () => {
      await cita(salaA, terapeutaA, DIA, '09:00', '10:00');
      await cita(salaB, terapeutaB, DIA, '09:00', '10:00', pacienteB);
      await db.query('UPDATE terapeuta SET activo = false, fecha_baja = now() WHERE id = $1', [
        terapeutaB,
      ]);

      const response = await resumen();
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        citas_pendientes_total: 2,
        salas_totales: 2,
        terapeutas_activos: 1,
      });
      expect(response.body.citas_hoy).toBeInstanceOf(Array);
    });

    it('no cuenta las salas dadas de baja', async () => {
      await db.query('UPDATE sala SET activo = false, fecha_baja = now() WHERE id = $1', [salaB]);
      const response = await resumen();
      expect(response.body.salas_totales).toBe(1);
    });

    it('excluye las citas canceladas del total de pendientes', async () => {
      const c = await cita(salaA, terapeutaA, DIA, '09:00', '10:00');
      await cita(salaB, terapeutaB, DIA, '09:00', '10:00', pacienteB);
      await request(app).post(`/api/v1/citas/${c.id}/cancelar`).set(auth()).send({ version: 1 });

      const response = await resumen();
      expect(response.body.citas_pendientes_total).toBe(1);
    });

    it('con la fecha fija de hoy lista las citas de hoy, cuenta las pendientes y los salones libres', async () => {
      await cita(salaA, terapeutaA, DIA, '09:00', '10:00'); // ya pasó a las 12:00
      await cita(salaA, terapeutaB, DIA, '14:00', '15:00'); // pendiente
      await cita(salaB, terapeutaA, DIA_SIGUIENTE, '09:00', '10:00'); // mañana
      const cancelada = await cita(salaA, terapeutaA, DIA, '15:00', '16:00');
      await request(app)
        .post(`/api/v1/citas/${cancelada.id}/cancelar`)
        .set(auth())
        .send({ version: 1 });

      const ahora = at(DIA, '12:00');
      const resultado = await citaService.dashboardSummary(ahora);

      expect(resultado.citas_hoy.map((c) => c.estado)).toEqual(['Vencida', 'Pendiente']);
      expect(resultado.citas_pendientes_hoy).toBe(1);
      expect(resultado.salas_totales).toBe(2);
      expect(resultado.salas_libres_hoy).toBe(1); // Sala B no tiene citas ese día
    });

    it('cuenta a todos los pacientes registrados, incluidos los dados de baja', async () => {
      const response = await resumen();
      expect(response.body.pacientes_totales).toBe(3);
    });
  });
});
