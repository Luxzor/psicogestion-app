import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { mailService } from '../src/modules/auth/mail.js';
import { tokenService } from '../src/modules/auth/tokens.js';
import { calcularFin, clinicDateTimeToUtc } from '../src/modules/citas/horario.js';
import { citaRepository } from '../src/modules/citas/repository.js';
import { salaRepository } from '../src/modules/salas/repository.js';
import { db } from '../src/platform/db.js';
import { redis } from '../src/platform/redis.js';

/**
 * EDT 5.3.3. Pruebas de integración del alta, el listado y el detalle de citas contra Postgres,
 * Redis y el servicio de correo (simulado con vi.spyOn, igual que auth.integration.test.ts). Se
 * ejecutan en serie junto con las demás suites de integración (fileParallelism en false, por el
 * TRUNCATE compartido); no dependen de que otra suite deje datos ni modifican
 * modelo-salas-citas.integration.test.ts, que sigue siendo la referencia de EDT 5.2.1 para el
 * modelo de datos puro (empalmes, rejilla, bloqueo de recursos).
 */
const integration = process.env.RUN_INTEGRATION_TESTS === '1' ? describe : describe.skip;

const ZONA = 'America/Merida';
/** Día de prueba lejano y sin horario de verano (México lo abolió en 2022). */
const DIA = '2027-03-01'; // lunes futuro para que las pruebas no dependan de la hora actual
const PASADO = '2023-05-10'; // miércoles, pasado estable para la transición a Vencida
const SEMANA_LUNES = '2026-12-07';
const SEMANA_DOMINGO = '2026-12-13';
const MES_INICIO = '2027-02-01';
const MES_FIN = '2027-02-28';

const at = (fecha: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const instant = clinicDateTimeToUtc(fecha, h * 60 + m, ZONA);
  if (!instant) throw new Error(`Hora inválida: ${fecha} ${hhmm}`);
  return instant;
};

integration('citas: alta, listado y detalle con servicios reales (EDT 5.3.3)', () => {
  const app = createApp();
  let token = '';
  let userId = '';
  let pacienteConCorreo = '';
  let pacienteSinCorreo = '';
  let pacienteInactivo = '';
  let terapeutaA = '';
  let terapeutaB = '';
  let terapeutaInactivo = '';
  let salaA = '';
  let salaB = '';
  let salaInactiva = '';

  const post = (body: unknown, key?: string) => {
    const call = request(app).post('/api/v1/citas').set('Authorization', `Bearer ${token}`);
    if (key) call.set('Idempotency-Key', key);
    return call.send(body as object);
  };
  const get = (query = '') =>
    request(app).get(`/api/v1/citas${query}`).set('Authorization', `Bearer ${token}`);
  const getById = (id: string) =>
    request(app).get(`/api/v1/citas/${id}`).set('Authorization', `Bearer ${token}`);

  const cuerpo = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id_paciente: pacienteConCorreo,
    id_terapeuta: terapeutaA,
    id_sala: salaA,
    inicio: at(DIA, '09:00').toISOString(),
    duracion_bloques: 2,
    ...overrides,
  });

  /** Inserta una cita directo en la base, sin pasar por el alta (fija el pasado o los bordes). */
  async function insertarCita(
    pacienteId: string,
    terapeutaId: string,
    salaId: string,
    inicio: Date,
    bloques = 1,
  ) {
    const fin = calcularFin(inicio, bloques);
    const result = await db.query<{ id: string; folio: string }>(
      `INSERT INTO cita (id_paciente, id_terapeuta, id_sala, inicio, fin)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, folio`,
      [pacienteId, terapeutaId, salaId, inicio, fin],
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
       VALUES ('Julia Pérez', '9990000001', 'julia.perez@uady.mx', 'hash', 'activo')
       RETURNING id`,
    );
    userId = user.rows[0].id;
    token = tokenService.createAccessToken({ id: userId, rol: 'administrador' });

    const pacientes = await db.query<{ id: string }>(
      `INSERT INTO paciente (nombre_completo, curp, sexo, fecha_nacimiento, telefono, correo)
       VALUES ('Valeria Ku Escalante', 'KUEV090825MYNXSLA3', 'F', '2009-08-25', '9996402218',
               'valeria.ku@example.com'),
              ('Ana Sofía Canul Pech', 'CAPA980314MYNNCN08', 'F', '1998-03-14', '9992143381', NULL),
              ('Rosa Itzel Chan Dzul', 'DUPZ970101MYNZLRA5', 'F', '1997-01-01', '9991112222', NULL)
       RETURNING id`,
    );
    [pacienteConCorreo, pacienteSinCorreo, pacienteInactivo] = pacientes.rows.map((r) => r.id);
    await db.query('UPDATE paciente SET activo = false, fecha_baja = now() WHERE id = $1', [
      pacienteInactivo,
    ]);

    const terapeutas = await db.query<{ id: string }>(
      `INSERT INTO terapeuta
         (nombre_completo, telefono, correo_electronico, fecha_nacimiento, cedula_profesional)
       VALUES ('Victoria Méndez Rosado', '9997845213', 'victoria.mendez@correo.uady.mx',
               '1988-05-19', '7845213'),
              ('Héctor Puerto Cámara', '9996123987', 'hector.puerto@correo.uady.mx',
               '1979-09-03', '6123987'),
              ('Lucía Baas Uicab', '9995551234', 'lucia.baas@correo.uady.mx', '1985-02-02',
               '5551234')
       RETURNING id`,
    );
    [terapeutaA, terapeutaB, terapeutaInactivo] = terapeutas.rows.map((r) => r.id);
    await db.query('UPDATE terapeuta SET activo = false, fecha_baja = now() WHERE id = $1', [
      terapeutaInactivo,
    ]);

    salaA = (await salaRepository.create('Sala A', userId)).id;
    salaB = (await salaRepository.create('Sala B', userId)).id;
    salaInactiva = (await salaRepository.create('Sala X', userId)).id;
    await salaRepository.discharge(salaInactiva, userId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await Promise.allSettled([db.end(), redis.quit()]);
  });

  describe('alta de citas (RF 5.1.1-5.1.15, RF 2.3.5; PG-DSN-003 5.8)', () => {
    it('agenda una cita Pendiente con folio y confirmación por correo, en menos de 2 segundos (CA-5.1-01, RNF 5.1.2)', async () => {
      const mailSpy = vi
        .spyOn(mailService, 'sendConfirmacionCita')
        .mockResolvedValue({ enviada: true, destino: 'v***@example.com' });

      const started = Date.now();
      const response = await post(cuerpo());

      expect(response.status).toBe(201);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(response.body.codigo).toBe('CITA_REGISTRADA');
      expect(response.body.cita).toMatchObject({
        folio: expect.stringMatching(/^C\d{2}\d{6}$/),
        estado: 'Pendiente',
        paciente: { id: pacienteConCorreo, nombre_completo: 'Valeria Ku Escalante' },
        terapeuta: { id: terapeutaA, nombre_completo: 'Victoria Méndez Rosado' },
        sala: { id: salaA, nombre: 'Sala A' },
        confirmacion: { enviada: true, destino: 'v***@example.com' },
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /KUEV|9996402218|valeria\.ku@example\.com/i,
      );

      expect(mailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          correoPaciente: 'valeria.ku@example.com',
          nombrePaciente: 'Valeria Ku Escalante',
          nombreTerapeuta: 'Victoria Méndez Rosado',
          nombreSala: 'Sala A',
          folio: response.body.cita.folio,
        }),
      );
    });

    it('no asigna a un paciente dado de baja (CA-5.1-03)', async () => {
      const response = await post(cuerpo({ id_paciente: pacienteInactivo }));
      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('PACIENTE_INACTIVO_NO_ASIGNABLE');
    });

    it('no asigna a un terapeuta dado de baja (CA-2.3-03)', async () => {
      const response = await post(cuerpo({ id_terapeuta: terapeutaInactivo }));
      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('TERAPEUTA_INACTIVO_NO_ASIGNABLE');
    });

    it('rechaza una sala dada de baja (SALA_INACTIVA)', async () => {
      const response = await post(cuerpo({ id_sala: salaInactiva }));
      expect(response.status).toBe(409);
      expect(response.body.codigo).toBe('SALA_INACTIVA');
    });

    it('responde 404 cuando el paciente, el terapeuta o la sala no existen', async () => {
      const inexistente = '00000000-0000-4000-8000-000000000000';
      const porPaciente = await post(
        cuerpo({ id_paciente: inexistente, inicio: at(DIA, '10:00').toISOString() }),
      );
      expect(porPaciente.body.codigo).toBe('PACIENTE_NO_ENCONTRADO');

      const porTerapeuta = await post(
        cuerpo({ id_terapeuta: inexistente, inicio: at(DIA, '10:00').toISOString() }),
      );
      expect(porTerapeuta.body.codigo).toBe('TERAPEUTA_NO_ENCONTRADO');

      const porSala = await post(
        cuerpo({ id_sala: inexistente, inicio: at(DIA, '10:00').toISOString() }),
      );
      expect(porSala.body.codigo).toBe('SALA_NO_ENCONTRADA');
    });

    it('rechaza el empalme de sala, terapeuta y paciente con el código de cada recurso (CA-5.1-04)', async () => {
      await post(cuerpo({ inicio: at(DIA, '11:00').toISOString() }), 'empalme-base-citas');

      const porSala = await post(
        cuerpo({
          id_paciente: pacienteSinCorreo,
          id_terapeuta: terapeutaB,
          inicio: at(DIA, '11:30').toISOString(),
        }),
        'empalme-sala-citas',
      );
      expect(porSala.status).toBe(409);
      expect(porSala.body.codigo).toBe('SALA_OCUPADA');

      const porTerapeuta = await post(
        cuerpo({
          id_paciente: pacienteSinCorreo,
          id_sala: salaB,
          inicio: at(DIA, '11:30').toISOString(),
        }),
        'empalme-terapeuta-citas',
      );
      expect(porTerapeuta.status).toBe(409);
      expect(porTerapeuta.body.codigo).toBe('TERAPEUTA_OCUPADO');

      const porPaciente = await post(
        cuerpo({
          id_terapeuta: terapeutaB,
          id_sala: salaB,
          inicio: at(DIA, '11:30').toISOString(),
        }),
        'empalme-paciente-citas',
      );
      expect(porPaciente.status).toBe(409);
      expect(porPaciente.body.codigo).toBe('PACIENTE_OCUPADO');
    });

    it('rechaza una cita fuera de la rejilla y una cita en el pasado, cada una con su código (§5.7.1)', async () => {
      const fueraDeRejilla = await post(cuerpo({ inicio: at(DIA, '09:15').toISOString() }));
      expect(fueraDeRejilla.status).toBe(400);
      expect(fueraDeRejilla.body.codigo).toBe('HORARIO_INVALIDO');

      const enElPasado = await post(cuerpo({ inicio: at('2020-01-15', '09:00').toISOString() }));
      expect(enElPasado.status).toBe(422);
      expect(enElPasado.body.codigo).toBe('CITA_EN_EL_PASADO');
    });

    it('no duplica la cita al reintentar con la misma Idempotency-Key (CA-5.1-06)', async () => {
      const key = crypto.randomUUID();
      const primero = await post(cuerpo(), key);
      const reintento = await post(cuerpo(), key);

      expect(primero.status).toBe(201);
      expect(reintento.status).toBe(201);
      expect(reintento.body).toEqual(primero.body);
      const total = await db.query('SELECT count(*)::int AS n FROM cita');
      expect(total.rows[0].n).toBe(1);
    });

    it('libera la llave de idempotencia cuando el alta falla, para poder corregir y reintentar (CA-5.1-06)', async () => {
      const key = crypto.randomUUID();
      const fallido = await post(cuerpo({ id_sala: salaInactiva }), key);
      expect(fallido.status).toBe(409);

      const corregido = await post(cuerpo(), key);
      expect(corregido.status).toBe(201);
    });

    it('rechaza una llave de idempotencia reutilizada con datos distintos', async () => {
      const key = crypto.randomUUID();
      await post(cuerpo(), key);
      const conOtrosDatos = await post(cuerpo({ inicio: at(DIA, '12:00').toISOString() }), key);
      expect(conOtrosDatos.status).toBe(422);
      expect(conOtrosDatos.body.codigo).toBe('IDEMPOTENCY_KEY_REUTILIZADA');
    });

    it('registra cita_creada en la bitácora solo con el id y el folio, nunca con nombres (R01)', async () => {
      const response = await post(cuerpo());

      const log = await db.query(
        "SELECT detalle, id_usuario FROM bitacora_acceso WHERE evento = 'cita_creada'",
      );
      expect(log.rows).toEqual([
        { detalle: `${response.body.cita.id} ${response.body.cita.folio}`, id_usuario: userId },
      ]);
      expect(JSON.stringify(log.rows)).not.toMatch(/Valeria|Victoria|KUEV/i);
    });

    it('envía la confirmación cuando el paciente tiene correo registrado (CA-5.1-05)', async () => {
      vi.spyOn(mailService, 'sendConfirmacionCita').mockResolvedValue({
        enviada: true,
        destino: 'v***@example.com',
      });

      const response = await post(cuerpo());

      expect(response.status).toBe(201);
      expect(response.body.cita.confirmacion).toEqual({
        enviada: true,
        destino: 'v***@example.com',
      });
    });

    it('omite el envío si el paciente no tiene correo, sin impedir el alta (CA-5.1-05, RF 5.1.15)', async () => {
      const mailSpy = vi.spyOn(mailService, 'sendConfirmacionCita');

      const response = await post(cuerpo({ id_paciente: pacienteSinCorreo }));

      expect(response.status).toBe(201);
      expect(response.body.cita.confirmacion).toEqual({ enviada: false, motivo: 'sin_correo' });
      expect(mailSpy).toHaveBeenCalledWith(expect.objectContaining({ correoPaciente: null }));
    });

    it('conserva la cita aunque falle el envío del correo (CA-5.1-05, ADR-22)', async () => {
      vi.spyOn(mailService, 'sendConfirmacionCita').mockResolvedValue({
        enviada: false,
        motivo: 'fallo_envio',
      });

      const response = await post(cuerpo());

      expect(response.status).toBe(201);
      expect(response.body.cita.estado).toBe('Pendiente');
      expect(response.body.cita.confirmacion).toEqual({ enviada: false, motivo: 'fallo_envio' });
      const stored = await db.query('SELECT estado FROM cita WHERE id = $1', [
        response.body.cita.id,
      ]);
      expect(stored.rows[0].estado).toBe('Pendiente');
    });
  });

  describe('concurrencia y bordes de la rejilla (criterio transversal, ADR-15, ADR-16)', () => {
    it('dos altas simultáneas sobre el mismo bloque: una se guarda, la otra recibe 409, ninguna 500 (criterio transversal)', async () => {
      const inicio = at(DIA, '13:00').toISOString();
      const [a, b] = await Promise.all([
        post(cuerpo({ inicio }), 'concurrencia-citas-a'),
        post(
          cuerpo({ id_paciente: pacienteSinCorreo, id_terapeuta: terapeutaB, inicio }),
          'concurrencia-citas-b',
        ),
      ]);

      const estados = [a.status, b.status].sort();
      expect(estados).toEqual([201, 409]);
      const perdedor = a.status === 409 ? a : b;
      expect(perdedor.body.codigo).toBe('SALA_OCUPADA');
      expect(a.status).not.toBe(500);
      expect(b.status).not.toBe(500);

      const total = await db.query(
        "SELECT count(*)::int AS n FROM cita WHERE estado = 'Pendiente'",
      );
      expect(total.rows[0].n).toBe(1);
    });

    it('acepta una cita que empieza a las 07:00 y una que termina justo a las 17:00 (ADR-15)', async () => {
      const primeraDelDia = await post(
        cuerpo({ inicio: at(DIA, '07:00').toISOString(), duracion_bloques: 1 }),
      );
      expect(primeraDelDia.status).toBe(201);

      const ultimaDelDia = await post(
        cuerpo({
          id_paciente: pacienteSinCorreo,
          id_terapeuta: terapeutaB,
          inicio: at(DIA, '15:00').toISOString(),
          duracion_bloques: 4,
        }),
      );
      expect(ultimaDelDia.status).toBe(201);
      expect(ultimaDelDia.body.cita.fin).toBe(at(DIA, '17:00').toISOString());
    });

    it('rechaza una cita que empieza antes de las 07:00 o termina después de las 17:00 (HORARIO_INVALIDO)', async () => {
      const antesDeAbrir = await post(cuerpo({ inicio: at(DIA, '06:30').toISOString() }));
      expect(antesDeAbrir.body.codigo).toBe('HORARIO_INVALIDO');

      const despuesDeCerrar = await post(
        cuerpo({ inicio: at(DIA, '16:30').toISOString(), duracion_bloques: 2 }),
      );
      expect(despuesDeCerrar.body.codigo).toBe('HORARIO_INVALIDO');
    });
  });

  describe('folio (ADR-17, RNF 5.1.2)', () => {
    it('genera un folio con el formato C + AA + 6 dígitos', async () => {
      const response = await post(cuerpo());
      expect(response.body.cita.folio).toMatch(/^C\d{2}\d{6}$/);
      expect(response.body.cita.folio).toHaveLength(9);
    });

    it('deja un hueco en la numeración cuando un alta falla después de tomar el folio (PG-DSN-003 11.3)', async () => {
      const primera = await post(cuerpo({ inicio: at(DIA, '09:00').toISOString() }));
      const fallida = await post(
        cuerpo({
          id_paciente: pacienteSinCorreo,
          id_terapeuta: terapeutaB,
          inicio: at(DIA, '09:00').toISOString(),
        }),
      ); // empalme de sala: consume folio y falla
      expect(fallida.status).toBe(409);

      const segunda = await post(cuerpo({ inicio: at(DIA, '11:00').toISOString() }));

      const numeroPrimera = Number(primera.body.cita.folio.slice(3));
      const numeroSegunda = Number(segunda.body.cita.folio.slice(3));
      expect(numeroSegunda).toBeGreaterThan(numeroPrimera + 1);
    });

    it('traduce la secuencia agotada a un error controlado en vez de un 500 genérico', async () => {
      await db.query('ALTER SEQUENCE cita_folio_seq RESTART WITH 999999');
      try {
        const ultimoFolio = await post(cuerpo());
        expect(ultimoFolio.status).toBe(201);
        expect(ultimoFolio.body.cita.folio.slice(3)).toBe('999999');

        const agotada = await post(cuerpo({ inicio: at(DIA, '11:00').toISOString() }));
        expect(agotada.status).toBe(500);
        expect(agotada.body.codigo).toBe('FOLIO_AGOTADO');
        expect(agotada.body.mensaje).toBeTruthy();
      } finally {
        await db.query('ALTER SEQUENCE cita_folio_seq RESTART WITH 1');
      }
    });
  });

  describe('listado de citas (RF 5.2.1-5.2.3, RNF 5.1.4; CA-5.2-01)', () => {
    it('lista solo las citas del estatus elegido y minimiza los datos expuestos (CA-5.2-01, R01)', async () => {
      const pendiente = await post(cuerpo());
      const cancelable = await post(cuerpo({ inicio: at(DIA, '12:00').toISOString() }));
      await db.query("UPDATE cita SET estado = 'Cancelada', cancelada_en = now() WHERE id = $1", [
        cancelable.body.cita.id,
      ]);

      const response = await get('?estado=Pendiente');
      expect(response.status).toBe(200);
      const ids = response.body.datos.map((d: { id: string }) => d.id);
      expect(ids).toContain(pendiente.body.cita.id);
      expect(ids).not.toContain(cancelable.body.cita.id);

      const item = response.body.datos.find((d: { id: string }) => d.id === pendiente.body.cita.id);
      expect(Object.keys(item).sort()).toEqual([
        'estado',
        'fin',
        'folio',
        'id',
        'inicio',
        'paciente',
        'sala',
        'terapeuta',
      ]);
      expect(JSON.stringify(response.body)).not.toMatch(
        /KUEV|9996402218|valeria\.ku@example\.com/i,
      );
    });

    it('filtra por sala y por terapeuta', async () => {
      const enSalaA = await post(cuerpo({ inicio: at(DIA, '09:00').toISOString() }));
      const enSalaB = await post(
        cuerpo({
          id_paciente: pacienteSinCorreo,
          id_terapeuta: terapeutaB,
          id_sala: salaB,
          inicio: at(DIA, '09:00').toISOString(),
        }),
      );

      const porSala = await get(`?id_sala=${salaB}`);
      expect(porSala.body.datos.map((d: { id: string }) => d.id)).toEqual([enSalaB.body.cita.id]);

      const porTerapeuta = await get(`?id_terapeuta=${terapeutaA}`);
      expect(porTerapeuta.body.datos.map((d: { id: string }) => d.id)).toEqual([
        enSalaA.body.cita.id,
      ]);
    });

    it('filtra por periodo día, semana y mes, con los bordes incluidos (RF 5.2.3)', async () => {
      const dentroSemanaLunes = await insertarCita(
        pacienteConCorreo,
        terapeutaA,
        salaA,
        at(SEMANA_LUNES, '07:00'),
      );
      const dentroSemanaDomingo = await insertarCita(
        pacienteConCorreo,
        terapeutaA,
        salaA,
        at(SEMANA_DOMINGO, '16:30'),
      );
      const fueraSemanaAntes = await insertarCita(
        pacienteSinCorreo,
        terapeutaB,
        salaB,
        at('2026-12-06', '09:00'),
      );
      const fueraSemanaDespues = await insertarCita(
        pacienteSinCorreo,
        terapeutaB,
        salaB,
        at('2026-12-14', '09:00'),
      );

      const semana = await get(`?desde=${SEMANA_LUNES}&hasta=${SEMANA_DOMINGO}&tamano=100`);
      const idsSemana = semana.body.datos.map((d: { id: string }) => d.id);
      expect(idsSemana).toEqual(
        expect.arrayContaining([dentroSemanaLunes.id, dentroSemanaDomingo.id]),
      );
      expect(idsSemana).not.toEqual(
        expect.arrayContaining([fueraSemanaAntes.id, fueraSemanaDespues.id]),
      );

      const diaUnico = await get(`?desde=${SEMANA_LUNES}&hasta=${SEMANA_LUNES}&tamano=100`);
      expect(diaUnico.body.datos.map((d: { id: string }) => d.id)).toEqual([dentroSemanaLunes.id]);

      const dentroMesInicio = await insertarCita(
        pacienteConCorreo,
        terapeutaA,
        salaB,
        at(MES_INICIO, '07:00'),
      );
      const dentroMesFin = await insertarCita(
        pacienteConCorreo,
        terapeutaA,
        salaB,
        at(MES_FIN, '16:30'),
      );
      const fueraMesAntes = await insertarCita(
        pacienteSinCorreo,
        terapeutaB,
        salaA,
        at('2027-01-31', '09:00'),
      );
      const fueraMesDespues = await insertarCita(
        pacienteSinCorreo,
        terapeutaB,
        salaA,
        at('2027-03-01', '09:00'),
      );

      const mes = await get(`?desde=${MES_INICIO}&hasta=${MES_FIN}&tamano=100`);
      const idsMes = mes.body.datos.map((d: { id: string }) => d.id);
      expect(idsMes).toEqual(expect.arrayContaining([dentroMesInicio.id, dentroMesFin.id]));
      expect(idsMes).not.toEqual(expect.arrayContaining([fueraMesAntes.id, fueraMesDespues.id]));
    });

    it('busca por folio exacto', async () => {
      const creada = await post(cuerpo());
      const otra = await post(cuerpo({ inicio: at(DIA, '11:00').toISOString() }));

      const response = await get(`?folio=${creada.body.cita.folio}`);
      expect(response.body.total).toBe(1);
      expect(response.body.datos[0].id).toBe(creada.body.cita.id);
      expect(response.body.datos.map((d: { id: string }) => d.id)).not.toContain(otra.body.cita.id);

      const inexistente = await get('?folio=C99999999');
      expect(inexistente.body).toMatchObject({ total: 0, datos: [] });
    });

    it('pagina el listado y reporta el total real', async () => {
      for (let i = 0; i < 3; i += 1) {
        await insertarCita(pacienteConCorreo, terapeutaA, salaA, at(DIA, `0${7 + i}:00`));
      }

      const primera = await get('?pagina=1&tamano=2');
      expect(primera.body).toMatchObject({ pagina: 1, tamano: 2, total: 3 });
      expect(primera.body.datos).toHaveLength(2);

      const segunda = await get('?pagina=2&tamano=2');
      expect(segunda.body).toMatchObject({ pagina: 2, total: 3 });
      expect(segunda.body.datos).toHaveLength(1);
    });

    it('marca como Vencida antes de listar, de forma idempotente (ADR-18)', async () => {
      // Comprobación directa con reloj fijo, igual que ADR-18 lo exige: no depende de "ahora" real.
      const vencida = await insertarCita(pacienteConCorreo, terapeutaA, salaA, at(PASADO, '09:00'));
      const reloj = at(PASADO, '10:00');
      expect(await citaRepository.markExpired(reloj)).toBe(1);
      expect(await citaRepository.markExpired(reloj)).toBe(0); // idempotente: nada más que marcar

      // La ruta de listado hace el mismo marcado con el reloj real antes de responder.
      const otraVencida = await insertarCita(
        pacienteSinCorreo,
        terapeutaB,
        salaB,
        at(PASADO, '12:00'),
      );
      const enVencidas = await get('?estado=Vencida&tamano=100');
      const idsVencidas = enVencidas.body.datos.map((d: { id: string }) => d.id);
      expect(idsVencidas).toEqual(expect.arrayContaining([vencida.id, otraVencida.id]));

      const enPendientes = await get('?estado=Pendiente&tamano=100');
      expect(enPendientes.body.datos.map((d: { id: string }) => d.id)).not.toContain(vencida.id);
    });

    it('cada búsqueda del listado responde en menos de 5 segundos (RNF 5.1.4)', async () => {
      await post(cuerpo());
      const started = Date.now();
      const response = await get('?estado=Pendiente&tamano=25');
      expect(response.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(5000);
    });
  });

  describe('detalle de cita (RF 5.2)', () => {
    it('muestra el detalle y audita cita_consultada solo con identificadores (R01)', async () => {
      const creada = await post(cuerpo());

      const response = await getById(creada.body.cita.id);

      expect(response.status).toBe(200);
      expect(response.body.cita).toMatchObject({
        id: creada.body.cita.id,
        folio: creada.body.cita.folio,
        paciente: { nombre_completo: 'Valeria Ku Escalante' },
      });

      const log = await db.query(
        "SELECT detalle FROM bitacora_acceso WHERE evento = 'cita_consultada'",
      );
      expect(log.rows).toEqual([{ detalle: `${creada.body.cita.id} ${creada.body.cita.folio}` }]);
      expect(JSON.stringify(log.rows)).not.toMatch(/Valeria|KUEV/i);
    });

    it('responde 404 al consultar una cita inexistente', async () => {
      const response = await getById('00000000-0000-4000-8000-000000000000');
      expect(response.status).toBe(404);
      expect(response.body.codigo).toBe('CITA_NO_ENCONTRADA');
    });
  });

  describe('modificación de cita (RF 5.3.1–5.3.6)', () => {
    const futuro = '2027-03-01';
    const patch = (id: string, body: object) =>
      request(app).patch(`/api/v1/citas/${id}`).set('Authorization', `Bearer ${token}`).send(body);

    it('cambia recursos y horario, conserva folio, aumenta versión y audita', async () => {
      const original = await insertarCita(
        pacienteConCorreo,
        terapeutaA,
        salaA,
        at(futuro, '09:00'),
      );
      const response = await patch(original.id, {
        version: 1,
        id_paciente: pacienteSinCorreo,
        id_terapeuta: terapeutaB,
        id_sala: salaB,
        inicio: at(futuro, '11:00').toISOString(),
        duracion_bloques: 2,
      });
      expect(response.status).toBe(200);
      expect(response.body.cita).toMatchObject({
        folio: original.folio,
        version: 2,
        paciente: { id: pacienteSinCorreo },
        terapeuta: { id: terapeutaB },
        sala: { id: salaB },
        duracion_bloques: 2,
      });
      expect((await getById(original.id)).body.cita.inicio).toBe(at(futuro, '11:00').toISOString());
      const audit = await db.query(
        "SELECT detalle FROM bitacora_acceso WHERE evento = 'cita_modificada'",
      );
      expect(audit.rows).toEqual([{ detalle: `${original.id} ${original.folio}` }]);
    });

    it('rechaza versiones anteriores y una sala ocupada sin alterar la cita', async () => {
      const original = await insertarCita(
        pacienteConCorreo,
        terapeutaA,
        salaA,
        at(futuro, '09:00'),
      );
      await insertarCita(pacienteSinCorreo, terapeutaB, salaB, at(futuro, '10:00'));
      const ocupado = await patch(original.id, {
        version: 1,
        id_sala: salaB,
        inicio: at(futuro, '10:00').toISOString(),
      });
      expect(ocupado.status).toBe(409);
      expect(ocupado.body.codigo).toBe('SALA_OCUPADA');
      const actualizado = await patch(original.id, {
        version: 1,
        inicio: at(futuro, '11:00').toISOString(),
      });
      expect(actualizado.status).toBe(200);
      const viejo = await patch(original.id, { version: 1, id_sala: salaB });
      expect(viejo.status).toBe(409);
      expect(viejo.body.codigo).toBe('CONFLICTO_VERSION');
      expect(viejo.body.version_actual).toBe(2);
    });

    it('permite cambiar estatus a Cancelada y rechaza nuevas modificaciones', async () => {
      const original = await insertarCita(
        pacienteConCorreo,
        terapeutaA,
        salaA,
        at(futuro, '09:00'),
      );
      const response = await patch(original.id, { version: 1, estado: 'Cancelada' });
      expect(response.status).toBe(200);
      expect(response.body.cita.estado).toBe('Cancelada');
      expect(response.body.cita.cancelada_en).toBeTruthy();
      expect((await patch(original.id, { version: 2, id_sala: salaB })).body.codigo).toBe(
        'CITA_NO_MODIFICABLE',
      );
    });

    it('solo marca Vencida una cita terminada y no mezcla estatus con otros cambios', async () => {
      const futura = await insertarCita(pacienteConCorreo, terapeutaA, salaA, at(futuro, '09:00'));
      const invalida = await patch(futura.id, { version: 1, estado: 'Vencida' });
      expect(invalida.status).toBe(400);
      expect(invalida.body.codigo).toBe('ESTADO_INVALIDO');
      const mezclada = await patch(futura.id, { version: 1, estado: 'Cancelada', id_sala: salaB });
      expect(mezclada.status).toBe(400);
      expect(mezclada.body.codigo).toBe('ESTADO_INVALIDO');
      const pasada = await insertarCita(pacienteSinCorreo, terapeutaB, salaB, at(PASADO, '09:00'));
      const vencida = await patch(pasada.id, { version: 1, estado: 'Vencida' });
      expect(vencida.status).toBe(200);
      expect(vencida.body.cita.estado).toBe('Vencida');
    });
  });
});

/**
 * NOTA: "terapeuta dado de baja durante el alta" (ADR-21) no se repite aquí con una carrera
 * simulada a través de HTTP: citaService.create() no expone su transacción interna para
 * interleaving controlado, y una carrera por temporización sería intermitente. El mecanismo de
 * bloqueo (FOR SHARE) que lo garantiza es el mismo citaRepository.lockAssignables() que ya prueba
 * modelo-salas-citas.integration.test.ts ("mientras se agenda, nadie puede dar de baja al
 * terapeuta asignado"); aquí se prueba el caso que sí es controlable de forma determinista: un
 * terapeuta YA dado de baja antes del alta (CA-2.3-03, arriba).
 */
