import type { PoolClient } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { citaDatabaseError } from '../src/modules/citas/errors.js';
import { calcularFin, clinicDateTimeToUtc } from '../src/modules/citas/horario.js';
import { citaRepository, type NuevaCita } from '../src/modules/citas/repository.js';
import { salaDatabaseError } from '../src/modules/salas/errors.js';
import { salaRepository } from '../src/modules/salas/repository.js';
import { db } from '../src/platform/db.js';

/**
 * EDT 5.2.1. Verifica contra PostgreSQL real el modelo de datos de salas y citas
 * (db/migrations/0009_sala_cita.sql) y su capa de acceso: las comprobaciones del apéndice 11.2 de
 * PG-DSN-003 (folio, tres tipos de empalme, rejilla, horario, cancelación, nombre de sala y
 * borrado restringido), la doble reserva simultánea (ADR-16) y el bloqueo de recursos (ADR-21).
 */
const integration = process.env.RUN_INTEGRATION_TESTS === '1' ? describe : describe.skip;

/** Día de prueba lejano para no depender de la fecha real; Mérida está en UTC-6. */
const DIA = '2030-03-04';
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const instant = clinicDateTimeToUtc(DIA, h * 60 + m);
  if (!instant) throw new Error(`Hora inválida: ${hhmm}`);
  return instant;
};

type DatabaseError = Error & { code?: string; constraint?: string };

/** Ejecuta una promesa que debe fallar y devuelve el error de PostgreSQL. */
async function dbFailure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as DatabaseError;
  }
  throw new Error('Se esperaba que la operación fallara.');
}

integration('modelo de datos de salas y citas con PostgreSQL (EDT 5.2.1)', () => {
  let userId = '';
  let pacienteA = '';
  let pacienteB = '';
  let terapeutaA = '';
  let terapeutaB = '';
  let sala1 = '';
  let sala2 = '';

  const cita = (overrides: Partial<NuevaCita> & { desde: string; bloques?: number }) => {
    const inicio = at(overrides.desde);
    return {
      id_paciente: overrides.id_paciente ?? pacienteA,
      id_terapeuta: overrides.id_terapeuta ?? terapeutaA,
      id_sala: overrides.id_sala ?? sala1,
      inicio,
      fin: overrides.fin ?? calcularFin(inicio, overrides.bloques ?? 2),
    };
  };

  beforeEach(async () => {
    await db.query(
      'TRUNCATE cita, sala, terapeuta, paciente, bitacora_acceso, token_recuperacion, codigo_verificacion, sesion, usuario CASCADE',
    );
    const user = await db.query<{ id: string }>(
      `INSERT INTO usuario (nombre_completo, telefono, correo_institucional, hash_contrasena, estado)
       VALUES ('Julia Pérez', '9990000001', 'julia.perez@uady.mx', 'hash', 'activo')
       RETURNING id`,
    );
    userId = user.rows[0].id;

    const pacientes = await db.query<{ id: string }>(
      `INSERT INTO paciente (nombre_completo, curp, sexo, fecha_nacimiento, telefono, correo)
       VALUES ('Valeria Ku Escalante', 'KUEV090825MYNXSLA3', 'F', '2009-08-25', '9996402218', NULL),
              ('Ana Sofía Canul Pech', 'CAPA980314MYNNCN08', 'F', '1998-03-14', '9992143381',
               'anasofia.canul@gmail.com')
       RETURNING id`,
    );
    [pacienteA, pacienteB] = pacientes.rows.map((row) => row.id);

    const terapeutas = await db.query<{ id: string }>(
      `INSERT INTO terapeuta
         (nombre_completo, telefono, correo_electronico, fecha_nacimiento, cedula_profesional)
       VALUES ('Victoria Méndez Rosado', '9997845213', 'victoria.mendez@correo.uady.mx',
               '1988-05-19', '7845213'),
              ('Héctor Puerto Cámara', '9996123987', 'hector.puerto@correo.uady.mx',
               '1979-09-03', '6123987')
       RETURNING id`,
    );
    [terapeutaA, terapeutaB] = terapeutas.rows.map((row) => row.id);

    sala1 = (await salaRepository.create('Sala 1', userId)).id;
    sala2 = (await salaRepository.create('Sala 2', userId)).id;
  });

  afterAll(async () => {
    await db.end();
  });

  describe('sala', () => {
    it('crea una sala activa con versión 1 y la lista por nombre (CA-4.1-01, CA-4.3-01)', async () => {
      const sala = await salaRepository.create('Gesell', userId);
      expect(sala).toMatchObject({ nombre: 'Gesell', activo: true, fecha_baja: null, version: 1 });
      expect(sala.fecha_registro).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const started = Date.now();
      const activas = await salaRepository.list('activas');
      expect(Date.now() - started).toBeLessThan(2000);
      expect(activas.map((row) => row.nombre)).toEqual(['Gesell', 'Sala 1', 'Sala 2']);
    });

    it('rechaza un nombre repetido sin distinguir mayúsculas ni espacios laterales (CA-4.1-02)', async () => {
      const started = Date.now();
      expect(await salaRepository.isNameTaken('  sala 1 ')).toBe(true);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(await salaRepository.isNameTaken('Sala 1', sala1)).toBe(false);
      expect(await salaRepository.isNameTaken('Sala 3')).toBe(false);

      for (const nombre of ['SALA 1', ' sala 1']) {
        const error = await dbFailure(salaRepository.create(nombre, userId));
        expect(error).toMatchObject({ code: '23505', constraint: 'uq_sala_nombre' });
        expect(salaDatabaseError(error)).toMatchObject({ status: 409, code: 'NOMBRE_SALA_EN_USO' });
      }
    });

    it('la base impide nombres vacíos o de más de 10 caracteres (CA-4.1-03)', async () => {
      expect(await dbFailure(salaRepository.create('   ', userId))).toMatchObject({
        code: '23514',
        constraint: 'sala_nombre_no_vacio',
      });
      const tooLong = await dbFailure(salaRepository.create('Sala Grupal', userId));
      expect(tooLong.code).toBe('22001');
      expect(salaDatabaseError(tooLong)).toMatchObject({ code: 'VALIDACION_INVALIDA' });
    });

    it('cambia el nombre con control de versión y rechaza una versión desfasada (ADR-23)', async () => {
      const renamed = await salaRepository.rename(sala1, 'Sala A', 1, userId);
      expect(renamed).toMatchObject({ nombre: 'Sala A', version: 2 });
      expect(await salaRepository.rename(sala1, 'Sala B', 1, userId)).toBeNull();
      expect((await salaRepository.findById(sala1))?.nombre).toBe('Sala A');
    });

    it('da de baja y reactiva de forma lógica; el nombre sigue ocupado mientras está inactiva (ADR-19)', async () => {
      const baja = await salaRepository.discharge(sala2, userId);
      expect(baja).toMatchObject({ activo: false, version: 2 });
      expect(baja?.fecha_baja).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(await salaRepository.discharge(sala2, userId)).toBeNull();
      expect((await salaRepository.list('activas')).map((row) => row.id)).toEqual([sala1]);
      expect((await salaRepository.list('inactivas')).map((row) => row.id)).toEqual([sala2]);
      expect(await salaRepository.list('todas')).toHaveLength(2);
      expect(await salaRepository.rename(sala2, 'Sala X', 2, userId)).toBeNull();

      const duplicate = await dbFailure(salaRepository.create('sala 2', userId));
      expect(salaDatabaseError(duplicate)?.code).toBe('NOMBRE_SALA_EN_USO');

      const stored = await db.query('SELECT baja_por FROM sala WHERE id = $1', [sala2]);
      expect(stored.rows[0].baja_por).toBe(userId);

      const restored = await salaRepository.restore(sala2, userId);
      expect(restored).toMatchObject({ activo: true, fecha_baja: null, version: 3 });
      expect(await salaRepository.restore(sala2, userId)).toBeNull();
    });

    it('la coherencia de la baja la garantiza la base', async () => {
      expect(
        await dbFailure(db.query('UPDATE sala SET activo = false WHERE id = $1', [sala1])),
      ).toMatchObject({ code: '23514', constraint: 'sala_baja_coherente' });
    });

    it('cuenta las citas Pendientes que aún no terminan y no permite borrar una sala con citas (CA-4.2-02)', async () => {
      await citaRepository.create(cita({ desde: '09:00' }), userId);
      const cancelada = await citaRepository.create(cita({ desde: '12:00' }), userId);
      await citaRepository.cancel(cancelada.id, 1, userId);

      expect(await salaRepository.countPendingAppointments(sala1, at('08:00'))).toBe(1);
      expect(await salaRepository.countPendingAppointments(sala1, at('11:00'))).toBe(0);
      expect(await salaRepository.countPendingAppointments(sala2, at('08:00'))).toBe(0);

      expect(await dbFailure(db.query('DELETE FROM sala WHERE id = $1', [sala1]))).toMatchObject({
        code: '23503',
      });
    });
  });

  describe('cita', () => {
    it('agenda una cita Pendiente con folio C + AA + 6 dígitos y la devuelve unida a los nombres (CA-5.1-01)', async () => {
      const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Merida', year: '2-digit' })
        .format(new Date())
        .slice(-2);

      const started = Date.now();
      const created = await citaRepository.create(cita({ desde: '09:00' }), userId);
      expect(Date.now() - started).toBeLessThan(2000);

      expect(created.folio).toMatch(new RegExp(`^C${year}\\d{6}$`));
      expect(created.folio).toHaveLength(9);
      expect(created).toMatchObject({
        estado: 'Pendiente',
        inicio: '2030-03-04T15:00:00.000Z',
        fin: '2030-03-04T16:00:00.000Z',
        duracion_bloques: 2,
        paciente: { id: pacienteA, nombre_completo: 'Valeria Ku Escalante' },
        terapeuta: { id: terapeutaA, nombre_completo: 'Victoria Méndez Rosado' },
        sala: { id: sala1, nombre: 'Sala 1' },
        cancelada_en: null,
        version: 1,
      });
      // R01: la cita no expone datos personales del paciente.
      expect(JSON.stringify(created)).not.toMatch(/KUEV|9996402218|curp|correo/i);

      expect(await citaRepository.findById(created.id)).toEqual(created);
      expect(await citaRepository.findByFolio(created.folio)).toEqual(created);
      expect(await citaRepository.findByFolio('C99999999')).toBeNull();

      const second = await citaRepository.create(cita({ desde: '11:00' }), userId);
      expect(Number(second.folio.slice(3))).toBeGreaterThan(Number(created.folio.slice(3)));
    });

    it('impide empalmes de sala, terapeuta y paciente, y acepta citas contiguas (CA-5.1-04)', async () => {
      await citaRepository.create(cita({ desde: '09:00', bloques: 2 }), userId);

      const casos = [
        {
          data: cita({ desde: '09:30', id_paciente: pacienteB, id_terapeuta: terapeutaB }),
          constraint: 'cita_sala_sin_empalme',
          code: 'SALA_OCUPADA',
        },
        {
          data: cita({ desde: '09:30', id_paciente: pacienteB, id_sala: sala2 }),
          constraint: 'cita_terapeuta_sin_empalme',
          code: 'TERAPEUTA_OCUPADO',
        },
        {
          data: cita({ desde: '09:30', id_terapeuta: terapeutaB, id_sala: sala2 }),
          constraint: 'cita_paciente_sin_empalme',
          code: 'PACIENTE_OCUPADO',
        },
      ];
      for (const caso of casos) {
        const error = await dbFailure(citaRepository.create(caso.data, userId));
        expect(error).toMatchObject({ code: '23P01', constraint: caso.constraint });
        expect(citaDatabaseError(error)).toMatchObject({ status: 409, code: caso.code });
      }

      // Rango semiabierto: 10:00 a 11:00 empieza justo cuando termina la primera.
      const contigua = await citaRepository.create(cita({ desde: '10:00' }), userId);
      expect(contigua.estado).toBe('Pendiente');
      const anterior = await citaRepository.create(cita({ desde: '08:00' }), userId);
      expect(anterior.fin).toBe('2030-03-04T15:00:00.000Z');
    });

    it('dos solicitudes simultáneas por el mismo bloque: una se guarda y la otra se rechaza (CA-5.1-04)', async () => {
      const clients: PoolClient[] = await Promise.all([db.connect(), db.connect()]);
      try {
        await Promise.all(clients.map((client) => client.query('BEGIN')));
        const intentos = await Promise.allSettled([
          citaRepository.create(cita({ desde: '13:00' }), userId, clients[0]),
          citaRepository.create(
            cita({ desde: '13:30', id_paciente: pacienteB, id_terapeuta: terapeutaB }),
            userId,
            clients[1],
          ),
          // El segundo INSERT espera al primero; se confirma el primero para liberarlo.
          new Promise((resolve) => setTimeout(resolve, 300)).then(() => clients[0].query('COMMIT')),
        ]);
        const fallo = intentos[1];
        expect(intentos[0].status).toBe('fulfilled');
        expect(fallo.status).toBe('rejected');
        if (fallo.status === 'rejected') {
          expect(citaDatabaseError(fallo.reason)?.code).toBe('SALA_OCUPADA');
        }
      } finally {
        await clients[1].query('ROLLBACK');
        clients.forEach((client) => client.release());
      }
      const total = await db.query(
        "SELECT count(*)::int AS total FROM cita WHERE estado = 'Pendiente'",
      );
      expect(total.rows[0].total).toBe(1);
    });

    it('la base exige la rejilla de 30 minutos, el horario de 07:00 a 17:00 y el mismo día (ADR-15)', async () => {
      const casos: Array<{ data: NuevaCita; constraint: string }> = [
        { data: cita({ desde: '09:15' }), constraint: 'cita_rejilla_30min' },
        { data: cita({ desde: '06:30', bloques: 2 }), constraint: 'cita_horario_operativo' },
        { data: cita({ desde: '16:30', bloques: 2 }), constraint: 'cita_horario_operativo' },
        {
          data: { ...cita({ desde: '09:00' }), fin: at('09:00') },
          constraint: 'cita_rango_valido',
        },
        {
          data: {
            ...cita({ desde: '16:00' }),
            fin: new Date(at('16:00').getTime() + 24 * 3_600_000),
          },
          constraint: 'cita_mismo_dia',
        },
        {
          data: { ...cita({ desde: '09:00' }), inicio: new Date(at('09:00').getTime() + 1000) },
          constraint: 'cita_rejilla_30min',
        },
      ];
      for (const caso of casos) {
        const error = await dbFailure(citaRepository.create(caso.data, userId));
        expect(error).toMatchObject({ code: '23514', constraint: caso.constraint });
        expect(citaDatabaseError(error)?.code).toBe('HORARIO_INVALIDO');
      }
      // Los límites exactos se aceptan: 07:00 a 07:30 y 15:00 a 17:00.
      await citaRepository.create(cita({ desde: '07:00', bloques: 1 }), userId);
      await citaRepository.create(cita({ desde: '15:00', bloques: 4 }), userId);
    });

    it('traduce las llaves foráneas inexistentes y restringe borrar pacientes o terapeutas con citas', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      const error = await dbFailure(
        citaRepository.create(cita({ desde: '09:00', id_terapeuta: missing }), userId),
      );
      expect(citaDatabaseError(error)?.code).toBe('TERAPEUTA_NO_ENCONTRADO');

      await citaRepository.create(cita({ desde: '09:00' }), userId);
      expect(
        await dbFailure(db.query('DELETE FROM paciente WHERE id = $1', [pacienteA])),
      ).toMatchObject({ code: '23503' });
      expect(
        await dbFailure(db.query('DELETE FROM terapeuta WHERE id = $1', [terapeutaA])),
      ).toMatchObject({ code: '23503' });
    });

    it('cancela con control de versión, conserva la cita y libera el horario (CA-5.4-01, ADR-20)', async () => {
      const created = await citaRepository.create(cita({ desde: '09:00' }), userId);
      expect(await citaRepository.cancel(created.id, 7, userId)).toBeNull();

      const cancelada = await citaRepository.cancel(created.id, 1, userId);
      expect(cancelada).toMatchObject({ estado: 'Cancelada', version: 2, folio: created.folio });
      expect(cancelada?.cancelada_en).not.toBeNull();
      const stored = await db.query('SELECT cancelada_por FROM cita WHERE id = $1', [created.id]);
      expect(stored.rows[0].cancelada_por).toBe(userId);

      // CA-5.4-02: una cita ya cancelada no cambia.
      expect(await citaRepository.cancel(created.id, 2, userId)).toBeNull();
      // El mismo horario vuelve a estar libre.
      const nueva = await citaRepository.create(cita({ desde: '09:00' }), userId);
      expect(nueva.folio).not.toBe(created.folio);
    });

    it('la coherencia de la cancelación la garantiza la base (ADR-20)', async () => {
      const created = await citaRepository.create(cita({ desde: '09:00' }), userId);
      expect(
        await dbFailure(
          db.query("UPDATE cita SET estado = 'Cancelada' WHERE id = $1", [created.id]),
        ),
      ).toMatchObject({ code: '23514', constraint: 'cita_cancelacion_coherente' });
      expect(
        await dbFailure(
          db.query("UPDATE cita SET folio = 'C-2030-00001' WHERE id = $1", [created.id]),
        ),
      ).toMatchObject({ code: '22001' });
      expect(
        await dbFailure(
          db.query("UPDATE cita SET folio = 'X30000001' WHERE id = $1", [created.id]),
        ),
      ).toMatchObject({ code: '23514', constraint: 'cita_folio_formato' });
    });

    it('modifica una cita Pendiente con control de versión y valida el empalme (CA-5.3-01, CA-5.3-02)', async () => {
      const created = await citaRepository.create(cita({ desde: '09:00' }), userId);
      await citaRepository.create(
        cita({ desde: '11:00', id_paciente: pacienteB, id_terapeuta: terapeutaB, id_sala: sala2 }),
        userId,
      );

      const moved = await citaRepository.update(
        created.id,
        { id_sala: sala2, id_terapeuta: terapeutaB, inicio: at('12:00'), fin: at('13:30') },
        1,
        userId,
      );
      expect(moved).toMatchObject({
        sala: { id: sala2, nombre: 'Sala 2' },
        terapeuta: { id: terapeutaB },
        inicio: '2030-03-04T18:00:00.000Z',
        duracion_bloques: 3,
        version: 2,
        folio: created.folio,
      });

      expect(await citaRepository.update(created.id, { id_sala: sala1 }, 1, userId)).toBeNull();

      const error = await dbFailure(
        citaRepository.update(created.id, { inicio: at('11:00'), fin: at('12:00') }, 2, userId),
      );
      expect(citaDatabaseError(error)?.code).toBe('SALA_OCUPADA');

      await citaRepository.cancel(created.id, 2, userId);
      expect(await citaRepository.update(created.id, { id_sala: sala1 }, 3, userId)).toBeNull();
      expect(await citaRepository.findSummaryById(created.id)).toMatchObject({
        estado: 'Cancelada',
        version: 3,
        id_sala: sala2,
      });
    });

    it('marca como Vencidas las citas Pendientes cuyo fin ya pasó, de forma idempotente (ADR-18)', async () => {
      const primera = await citaRepository.create(cita({ desde: '09:00' }), userId);
      const segunda = await citaRepository.create(cita({ desde: '12:00' }), userId);
      const cancelada = await citaRepository.create(cita({ desde: '14:00' }), userId);
      await citaRepository.cancel(cancelada.id, 1, userId);

      expect(await citaRepository.markExpired(at('09:59'))).toBe(0);
      expect(await citaRepository.markExpired(at('10:00'))).toBe(1);
      expect(await citaRepository.markExpired(at('10:00'))).toBe(0);

      expect(await citaRepository.findById(primera.id)).toMatchObject({
        estado: 'Vencida',
        version: 2,
      });
      expect((await citaRepository.findById(segunda.id))?.estado).toBe('Pendiente');
      expect((await citaRepository.findById(cancelada.id))?.estado).toBe('Cancelada');

      // Una cita Vencida ya no participa en las restricciones de empalme.
      const encima = await citaRepository.create(cita({ desde: '09:00' }), userId);
      expect(encima.estado).toBe('Pendiente');
    });

    it('devuelve la ocupación del día: Pendientes y Vencidas, sin Canceladas (RF 4.3.2, RF 5.1.3)', async () => {
      const pendiente = await citaRepository.create(cita({ desde: '09:00' }), userId);
      const vencida = await citaRepository.create(
        cita({ desde: '07:00', id_paciente: pacienteB, id_terapeuta: terapeutaB, id_sala: sala2 }),
        userId,
      );
      const cancelada = await citaRepository.create(cita({ desde: '13:00' }), userId);
      await citaRepository.cancel(cancelada.id, 1, userId);
      await citaRepository.markExpired(at('08:30'));
      await db.query(
        `INSERT INTO cita (id_paciente, id_terapeuta, id_sala, inicio, fin)
         VALUES ($1, $2, $3, $4, $5)`,
        [pacienteA, terapeutaA, sala1, '2030-03-05T15:00:00Z', '2030-03-05T16:00:00Z'],
      );

      const started = Date.now();
      const ocupadas = await citaRepository.occupiedBetween(at('07:00'), at('17:00'));
      expect(Date.now() - started).toBeLessThan(3000);
      expect(ocupadas.map((row) => [row.folio, row.estado])).toEqual([
        [vencida.folio, 'Vencida'],
        [pendiente.folio, 'Pendiente'],
      ]);
      expect(ocupadas[1]).toMatchObject({
        id_sala: sala1,
        id_terapeuta: terapeutaA,
        terapeuta_nombre: 'Victoria Méndez Rosado',
        inicio: at('09:00'),
        fin: at('10:00'),
      });
    });
  });

  describe('asignación de recursos (ADR-21)', () => {
    it('lee paciente, terapeuta y sala con su estado; un recurso inexistente vuelve como null', async () => {
      await db.query('UPDATE terapeuta SET activo = false, fecha_baja = now() WHERE id = $1', [
        terapeutaB,
      ]);
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        expect(
          await citaRepository.lockAssignables(
            { id_paciente: pacienteB, id_terapeuta: terapeutaB, id_sala: sala1 },
            client,
          ),
        ).toEqual({
          paciente: { id: pacienteB, activo: true, correo: 'anasofia.canul@gmail.com' },
          terapeuta: { id: terapeutaB, activo: false },
          sala: { id: sala1, activo: true },
        });
        expect(
          await citaRepository.lockAssignables(
            { id_sala: '00000000-0000-4000-8000-000000000000' },
            client,
          ),
        ).toEqual({ sala: null });
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    it('mientras se agenda, nadie puede dar de baja al terapeuta asignado', async () => {
      const agenda = await db.connect();
      const baja = await db.connect();
      try {
        await agenda.query('BEGIN');
        await citaRepository.lockAssignables({ id_terapeuta: terapeutaA }, agenda);

        await baja.query('BEGIN');
        await baja.query("SET LOCAL lock_timeout = '200ms'");
        expect(
          await dbFailure(
            baja.query('UPDATE terapeuta SET activo = false, fecha_baja = now() WHERE id = $1', [
              terapeutaA,
            ]),
          ),
        ).toMatchObject({ code: '55P03' });
        await baja.query('ROLLBACK');

        await citaRepository.create(cita({ desde: '09:00' }), userId, agenda);
        await agenda.query('COMMIT');
      } finally {
        agenda.release();
        baja.release();
      }
      const summary = await db.query('SELECT activo FROM terapeuta WHERE id = $1', [terapeutaA]);
      expect(summary.rows[0].activo).toBe(true);
    });
  });
});
