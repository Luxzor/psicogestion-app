import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { tokenService } from '../src/modules/auth/tokens.js';
import { clinicDateTimeToUtc } from '../src/modules/citas/horario.js';
import { db } from '../src/platform/db.js';
import { redis } from '../src/platform/redis.js';

/**
 * Pruebas no funcionales de tiempo de respuesta (PG-ERS-001 v0.6.5). Miden de punta a punta, a
 * través de la API real con Postgres y Redis reales, los RNF cuyo límite se puede verificar en el
 * servidor. Se hacen con un volumen representativo (varias semanas de agenda) y cada operación se
 * repite REPETICIONES veces: se exige que la peor medición quede dentro del límite del ERS.
 *
 * Alcance: miden la API en el entorno de prueba, no la red del usuario. Los RNF que dependen del
 * navegador (6.1 cambio de vista, 7.1 pantalla completa, 7.3 navegación) o de funciones que aún
 * no existen (6.3 archivo de impresión) no se cubren aquí.
 */
const integration = process.env.RUN_INTEGRATION_TESTS === '1' ? describe : describe.skip;

const ZONA = 'America/Merida';
const REPETICIONES = 5;
const DIA = '2027-03-01'; // lunes
const DIAS_CON_CITAS = 24;
const HORAS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'];

const at = (fecha: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const instant = clinicDateTimeToUtc(fecha, h * 60 + m, ZONA);
  if (!instant) throw new Error(`Hora inválida: ${fecha} ${hhmm}`);
  return instant;
};

const sumarDias = (fecha: string, dias: number) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

const esDomingo = (fecha: string) => new Date(`${fecha}T12:00:00Z`).getUTCDay() === 0;

integration('RNF de tiempo de respuesta con volumen representativo (PG-ERS-001)', () => {
  const app = createApp();
  let token = '';
  let idPaciente = '';
  let idTerapeuta = '';
  let idSala = '';
  let nombreSalaNueva = 0;
  let citasInsertadas = 0;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  /** Ejecuta la operación REPETICIONES veces y devuelve la peor duración en milisegundos. */
  async function peor(operacion: () => Promise<void>): Promise<number> {
    const duraciones: number[] = [];
    for (let i = 0; i < REPETICIONES; i += 1) {
      const inicio = performance.now();
      await operacion();
      duraciones.push(performance.now() - inicio);
    }
    return Math.max(...duraciones);
  }

  beforeAll(async () => {
    await db.query(
      'TRUNCATE cita, sala, terapeuta, paciente, bitacora_acceso, token_recuperacion, codigo_verificacion, sesion, usuario CASCADE',
    );
    await redis.flushdb();

    const user = await db.query<{ id: string }>(
      `INSERT INTO usuario (nombre_completo, telefono, correo_institucional, hash_contrasena, estado)
       VALUES ('Julia Pérez', '9990000001', 'julia.perez@uady.mx', 'hash', 'activo') RETURNING id`,
    );
    token = tokenService.createAccessToken({ id: user.rows[0].id, rol: 'administrador' });

    // 60 pacientes, 12 terapeutas y 8 salas: varias veces el tamaño real de la clínica piloto.
    const pacientes = await db.query<{ id: string }>(
      `INSERT INTO paciente (nombre_completo, curp, sexo, fecha_nacimiento, telefono)
       SELECT 'Paciente Prueba ' || n,
              'PAAA000101MAA' || substr('BCDFGHJKLMNP', n / 12 + 1, 1) || substr('BCDFGHJKLMNP', n % 12 + 1, 1) || 'BA0',
              'F', DATE '2000-01-01', '99900' || lpad(n::text, 5, '0')
       FROM generate_series(1, 60) AS n RETURNING id`,
    );
    const terapeutas = await db.query<{ id: string }>(
      `INSERT INTO terapeuta (nombre_completo, telefono, correo_electronico, fecha_nacimiento, cedula_profesional)
       SELECT 'Terapeuta Prueba ' || n, '99800' || lpad(n::text, 5, '0'),
              'terapeuta' || n || '@correo.uady.mx', DATE '1985-01-01', (1000000 + n)::text
       FROM generate_series(1, 12) AS n RETURNING id`,
    );
    const salas = await db.query<{ id: string }>(
      `INSERT INTO sala (nombre) SELECT 'Sala ' || n FROM generate_series(1, 8) AS n RETURNING id`,
    );
    idPaciente = pacientes.rows[0].id;
    idTerapeuta = terapeutas.rows[0].id;
    idSala = salas.rows[0].id;

    // Una cita por horario (sin empalmes posibles), rotando paciente, terapeuta y sala.
    const p: string[] = [];
    const t: string[] = [];
    const s: string[] = [];
    const ini: Date[] = [];
    const fin: Date[] = [];
    let n = 0;
    for (let d = 0; d < DIAS_CON_CITAS; d += 1) {
      const fecha = sumarDias(DIA, d);
      if (esDomingo(fecha)) continue;
      for (const hora of HORAS) {
        const inicio = at(fecha, hora);
        p.push(pacientes.rows[n % pacientes.rows.length].id);
        t.push(terapeutas.rows[n % terapeutas.rows.length].id);
        s.push(salas.rows[n % salas.rows.length].id);
        ini.push(inicio);
        fin.push(new Date(inicio.getTime() + 60 * 60 * 1000));
        n += 1;
      }
    }
    citasInsertadas = n;
    await db.query(
      `INSERT INTO cita (id_paciente, id_terapeuta, id_sala, inicio, fin)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::timestamptz[], $5::timestamptz[])`,
      [p, t, s, ini, fin],
    );
  });

  afterAll(async () => {
    await db.end();
    redis.disconnect();
  });

  it('parte de un volumen representativo de citas', () => {
    expect(citasInsertadas).toBeGreaterThanOrEqual(120);
  });

  it('la lista de pacientes carga en menos de 2 s (RNF 3.2.1)', async () => {
    const ms = await peor(async () => {
      const r = await request(app).get('/api/v1/pacientes?pagina=1&tamano=20').set(auth());
      expect(r.status).toBe(200);
    });
    expect(ms).toBeLessThan(2000);
  });

  it('la búsqueda de pacientes por nombre responde en menos de 2 s (RNF 3.2.1)', async () => {
    const ms = await peor(async () => {
      const r = await request(app).get('/api/v1/pacientes?q=Prueba%2012').set(auth());
      expect(r.status).toBe(200);
    });
    expect(ms).toBeLessThan(2000);
  });

  it('la vista detallada de un terapeuta carga en menos de 2 s (RNF 2.2.1)', async () => {
    const ms = await peor(async () => {
      const r = await request(app).get(`/api/v1/terapeutas/${idTerapeuta}`).set(auth());
      expect(r.status).toBe(200);
    });
    expect(ms).toBeLessThan(2000);
  });

  it('la lista de salas carga en menos de 2 s (RNF 4.2.1)', async () => {
    const ms = await peor(async () => {
      const r = await request(app).get('/api/v1/salas?estado=activas').set(auth());
      expect(r.status).toBe(200);
      expect(r.body.salas.length).toBeGreaterThanOrEqual(8);
    });
    expect(ms).toBeLessThan(2000);
  });

  it('el alta de una sala, con la validación de unicidad del nombre, tarda menos de 2 s (RNF 4.1.2)', async () => {
    const ms = await peor(async () => {
      nombreSalaNueva += 1;
      const r = await request(app)
        .post('/api/v1/salas')
        .set(auth())
        .set('Idempotency-Key', `rnf-sala-${nombreSalaNueva}-${Date.now()}`)
        .send({ nombre: `N${nombreSalaNueva}` });
      expect(r.status).toBe(201);
    });
    expect(ms).toBeLessThan(2000);
  });

  it('los horarios disponibles de las salas se muestran en menos de 3 s (RNF 5.1.1)', async () => {
    const ms = await peor(async () => {
      const r = await request(app)
        .get(`/api/v1/salas/disponibilidad?fecha=${DIA}&duracion=2`)
        .set(auth());
      expect(r.status).toBe(200);
      expect(r.body.salas.length).toBeGreaterThanOrEqual(8);
    });
    expect(ms).toBeLessThan(3000);
  });

  it('la disponibilidad con paciente y terapeuta elegidos también cumple 3 s (RNF 5.1.1)', async () => {
    const ms = await peor(async () => {
      const r = await request(app)
        .get(
          `/api/v1/salas/disponibilidad?fecha=${DIA}&duracion=2&id_paciente=${idPaciente}&id_terapeuta=${idTerapeuta}`,
        )
        .set(auth());
      expect(r.status).toBe(200);
    });
    expect(ms).toBeLessThan(3000);
  });

  it('las búsquedas de citas por estado, terapeuta, sala y periodo no pasan de 5 s (RNF 5.1.4)', async () => {
    const consultas = [
      '?estado=Pendiente',
      `?id_terapeuta=${idTerapeuta}`,
      `?id_sala=${idSala}`,
      `?desde=${DIA}&hasta=${sumarDias(DIA, 30)}`,
      `?desde=${DIA}&hasta=${sumarDias(DIA, 5)}`,
    ];
    for (const consulta of consultas) {
      const ms = await peor(async () => {
        const r = await request(app).get(`/api/v1/citas${consulta}`).set(auth());
        expect(r.status, consulta).toBe(200);
      });
      expect(ms, consulta).toBeLessThan(5000);
    }
  });

  it('la lista de horarios (agenda) de un día se genera en menos de 3 s (RNF 6.2)', async () => {
    const ms = await peor(async () => {
      const r = await request(app)
        .get(`/api/v1/citas/agenda?desde=${DIA}&hasta=${DIA}`)
        .set(auth());
      expect(r.status).toBe(200);
      expect(r.body.citas).toHaveLength(HORAS.length);
    });
    expect(ms).toBeLessThan(3000);
  });

  it('la agenda de una semana y de un mes completo responde en menos de 3 s (RNF 6.1, 6.2)', async () => {
    const semana = await peor(async () => {
      const r = await request(app)
        .get(`/api/v1/citas/agenda?desde=${DIA}&hasta=${sumarDias(DIA, 5)}`)
        .set(auth());
      expect(r.status).toBe(200);
    });
    const mes = await peor(async () => {
      const r = await request(app)
        .get(`/api/v1/citas/agenda?desde=${DIA}&hasta=${sumarDias(DIA, 30)}`)
        .set(auth());
      expect(r.status).toBe(200);
      expect(r.body.citas.length).toBe(citasInsertadas);
    });
    expect(semana).toBeLessThan(3000);
    expect(mes).toBeLessThan(3000);
  });

  it('el resumen de la pantalla de inicio responde en menos de 2 s (RNF 7.1)', async () => {
    const ms = await peor(async () => {
      const r = await request(app).get('/api/v1/citas/dashboard/resumen').set(auth());
      expect(r.status).toBe(200);
    });
    expect(ms).toBeLessThan(2000);
  });

  it('una cancelación se refleja en la agenda en menos de 1 s (RNF 5.1.3)', async () => {
    const ultima = await db.query<{ id: string; version: number }>(
      `SELECT id, version FROM cita WHERE inicio >= $1 AND inicio < $2 ORDER BY inicio LIMIT 1`,
      [at(DIA, '00:00'), at(sumarDias(DIA, 1), '00:00')],
    );
    const { id, version } = ultima.rows[0];

    const inicio = performance.now();
    const cancelada = await request(app)
      .post(`/api/v1/citas/${id}/cancelar`)
      .set(auth())
      .send({ version });
    expect(cancelada.status).toBe(200);
    const agenda = await request(app)
      .get(`/api/v1/citas/agenda?desde=${DIA}&hasta=${DIA}`)
      .set(auth());
    const ms = performance.now() - inicio;

    expect(agenda.status).toBe(200);
    expect(agenda.body.citas.map((c: { id: string }) => c.id)).not.toContain(id);
    expect(ms).toBeLessThan(1000);
  });
});
