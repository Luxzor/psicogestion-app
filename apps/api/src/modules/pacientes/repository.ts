import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { db } from '../../platform/db.js';
import {
  EDITABLE_FIELDS,
  type EditableField,
  type ListQuery,
  type PatientInput,
  type UpdatePatientInput,
} from './schemas.js';

type Queryable = Pick<PoolClient, 'query'>;

export type PatientRecord = {
  id: string;
  nombre_completo: string;
  curp: string;
  sexo: 'F' | 'M' | 'O';
  fecha_nacimiento: string;
  telefono: string;
  correo: string | null;
  consentimiento: boolean;
  activo: boolean;
  fecha_baja: string | null;
  fecha_registro: string;
  version: number;
};

/** Perfil completo del paciente (RF 3.2.3); agrega la edad y el sello de actualización. */
export type PatientProfile = PatientRecord & { edad: number; updated_at: Date };

/**
 * Elemento del listado. Solo lleva el mínimo de datos: el CURP y el correo aparecen únicamente
 * en el perfil (minimización de datos, R01 y PG-DSN-002 §4.6).
 */
export type PatientListItem = {
  id: string;
  nombre_completo: string;
  telefono: string;
  edad: number;
  activo: boolean;
};

/**
 * Estado mínimo para decidir sobre una operación. `created_at` viaja como marca de tiempo para
 * que el servicio obtenga el día de registro con el reloj de la clínica (`todayInClinic`) y no
 * con la zona de la sesión de la base de datos.
 */
export type PatientSummary = Pick<
  PatientRecord,
  'id' | 'nombre_completo' | 'curp' | 'activo' | 'fecha_baja' | 'version'
> & { created_at: Date };

/**
 * Zona horaria de la clínica como literal de SQL. `env` ya validó que es un nombre IANA válido;
 * aun así se duplican las comillas para que nunca pueda cerrar el literal.
 */
const clinicZone = `'${env.CLINIC_TIME_ZONE.replace(/'/g, "''")}'`;

/**
 * Día de la baja en la zona de la clínica (EDT 4.3.3). `fecha_baja` es timestamptz: sin la
 * conversión, una baja hecha después de las 18:00 en Mérida se mostraría con la fecha del día
 * siguiente, porque la sesión de PostgreSQL trabaja en UTC.
 */
const dischargeDate = `to_char(fecha_baja AT TIME ZONE ${clinicZone}, 'YYYY-MM-DD') AS fecha_baja`;

const patientFields = `
  id,
  nombre_completo,
  curp,
  sexo,
  to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
  telefono,
  correo,
  consentimiento,
  activo,
  ${dischargeDate},
  to_char(created_at, 'YYYY-MM-DD') AS fecha_registro,
  version`;

const summaryFields = `
  id,
  nombre_completo,
  curp,
  activo,
  ${dischargeDate},
  version,
  created_at`;

/** Años cumplidos al día indicado; el "hoy" llega como parámetro desde el reloj de la clínica. */
const ageExpression = (todayParam: string) =>
  `EXTRACT(YEAR FROM age(${todayParam}::date, fecha_nacimiento))::int AS edad`;

/** Evita que un % o un _ escritos en el buscador actúen como comodines de LIKE. */
const escapeForLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

/**
 * Filtro del listado: pacientes activos o dados de baja según `estado` (EDT 4.3.3) y, si hay
 * búsqueda, nombre sin acentos, prefijo de CURP o prefijo de teléfono (PG-DSN-002 §5.4).
 * Recibe las posiciones de los parámetros para poder reutilizarse en el conteo. El filtro por
 * `activo` va primero para aprovechar el índice (activo, nombre_completo COLLATE es_mx_icu).
 */
const matchClause = (activeParam: string, searchParam: string, phoneParam: string) => `
  activo = ${activeParam}::boolean
  AND (${searchParam}::text IS NULL
       OR f_sin_acentos(lower(nombre_completo))
            LIKE '%' || f_sin_acentos(lower(${searchParam})) || '%'
       OR curp LIKE upper(${searchParam}) || '%'
       OR (${phoneParam}::text IS NOT NULL AND telefono LIKE ${phoneParam} || '%'))`;

export const patientRepository = {
  async findByCurp(curp: string, client: Queryable = db) {
    const result = await client.query<PatientSummary>(
      `SELECT ${summaryFields} FROM paciente WHERE curp = $1`,
      [curp],
    );
    return result.rows[0] ?? null;
  },

  async findFullByCurp(curp: string, client: Queryable = db) {
    const result = await client.query<PatientRecord>(
      `SELECT ${patientFields} FROM paciente WHERE curp = $1`,
      [curp],
    );
    return result.rows[0] ?? null;
  },

  async findSummaryById(id: string, client: Queryable = db, lock = false) {
    const result = await client.query<PatientSummary>(
      `SELECT ${summaryFields} FROM paciente WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  /** Perfil completo, activo o no (RF 3.2.2–3.2.3). */
  async findById(id: string, today: string, client: Queryable = db) {
    const result = await client.query<PatientProfile>(
      `SELECT ${patientFields},
              ${ageExpression('$2')},
              updated_at
       FROM paciente WHERE id = $1`,
      [id, today],
    );
    return result.rows[0] ?? null;
  },

  /**
   * Listado paginado de pacientes activos (RF 3.2.1) o dados de baja (EDT 4.3.3, filtro
   * "Dados de baja" de PG-DSN-002 §5.4). El total viaja en la misma consulta con
   * count(*) OVER() para no pagar un segundo viaje (presupuesto de RNF 3.2.1, PG-DSN-002 §3.6).
   * La búsqueda acepta nombre sin acentos, prefijo de CURP o prefijo de teléfono (§5.4).
   */
  async list(query: ListQuery, today: string, client: Queryable = db) {
    const active = query.estado === 'activos';
    const search = query.q ? escapeForLike(query.q) : null;
    const phonePrefix = search && /^\d+$/.test(search) ? search : null;
    const orderBy =
      query.orden === '-fecha_registro'
        ? 'created_at DESC, id DESC'
        : 'nombre_completo COLLATE es_mx_icu ASC, id ASC';

    const result = await client.query<PatientListItem & { total: string }>(
      `SELECT id,
              nombre_completo,
              telefono,
              ${ageExpression('$1')},
              activo,
              count(*) OVER() AS total
       FROM paciente
       WHERE ${matchClause('$2', '$3', '$4')}
       ORDER BY ${orderBy}
       LIMIT $5 OFFSET $6`,
      [today, active, search, phonePrefix, query.tamano, (query.pagina - 1) * query.tamano],
    );

    // Se copian los campos uno por uno: la lista no expone el CURP ni el correo (R01, §4.6).
    const datos: PatientListItem[] = result.rows.map((row) => ({
      id: row.id,
      nombre_completo: row.nombre_completo,
      telefono: row.telefono,
      edad: row.edad,
      activo: row.activo,
    }));
    if (result.rows.length) return { datos, total: Number(result.rows[0].total) };

    // count(*) OVER() solo viaja en las filas devueltas: si la página quedó fuera de rango hay
    // que preguntar el total aparte para que el cliente pueda corregir la paginación.
    if (query.pagina === 1) return { datos, total: 0 };
    const counted = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM paciente WHERE ${matchClause('$1', '$2', '$3')}`,
      [active, search, phonePrefix],
    );
    return { datos, total: Number(counted.rows[0].total) };
  },

  /** Indica si el CURP pertenece a un paciente distinto de excludeId (RF 3.2.5). */
  async isCurpTaken(curp: string, excludeId?: string | null, client: Queryable = db) {
    const result = await client.query(
      `SELECT 1 FROM paciente
       WHERE curp = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
       LIMIT 1`,
      [curp, excludeId ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  },

  /** Indica si el teléfono pertenece a un paciente distinto de excludeId. */
  async isPhoneTaken(telefono: string, excludeId?: string | null, client: Queryable = db) {
    const result = await client.query(
      `SELECT 1 FROM paciente
       WHERE telefono = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
       LIMIT 1`,
      [telefono, excludeId ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async create(data: PatientInput, userId: string, client: Queryable = db) {
    const result = await client.query<PatientRecord>(
      `INSERT INTO paciente
        (nombre_completo, curp, sexo, fecha_nacimiento, telefono, correo,
         consentimiento, consentimiento_en, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 THEN now() END, $8, $8)
       RETURNING ${patientFields}`,
      [
        data.nombre_completo,
        data.curp,
        data.sexo,
        data.fecha_nacimiento,
        data.telefono,
        data.correo,
        data.consentimiento,
        userId,
      ],
    );
    return result.rows[0];
  },

  /**
   * Edición parcial con control de versión optimista (ADR-10). Es un solo UPDATE condicionado a
   * la versión leída: si no afecta ninguna fila, el servicio averigua la causa. Las columnas se
   * arman desde la lista blanca EDITABLE_FIELDS, nunca desde las llaves del cuerpo.
   */
  async update(
    id: string,
    input: UpdatePatientInput,
    userId: string,
    today: string,
    client: Queryable = db,
  ) {
    const changed = EDITABLE_FIELDS.filter((field) => field in input);
    const params: unknown[] = [id, input.version, userId, today];
    const assignments = changed.map((field) => {
      params.push(input[field as EditableField]);
      return `${field} = $${params.length}`;
    });

    const result = await client.query<PatientProfile>(
      `UPDATE paciente SET
         ${assignments.join(',\n         ')},
         version = version + 1,
         updated_at = now(),
         updated_by = $3
       WHERE id = $1 AND version = $2 AND activo = true
       RETURNING ${patientFields},
                 ${ageExpression('$4')},
                 updated_at`,
      params,
    );
    return result.rows[0] ?? null;
  },

  /** Reactiva un paciente dado de baja reemplazando sus datos por los capturados. */
  async reactivate(id: string, data: PatientInput, userId: string, client: Queryable = db) {
    const result = await client.query<PatientRecord>(
      `UPDATE paciente SET
         nombre_completo = $2,
         sexo = $3,
         fecha_nacimiento = $4,
         telefono = $5,
         correo = $6,
         consentimiento = $7,
         consentimiento_en = CASE WHEN $7 THEN now() END,
         activo = true,
         fecha_baja = NULL,
         version = version + 1,
         updated_at = now(),
         updated_by = $8
       WHERE id = $1 AND activo = false
       RETURNING ${patientFields}`,
      [
        id,
        data.nombre_completo,
        data.sexo,
        data.fecha_nacimiento,
        data.telefono,
        data.correo,
        data.consentimiento,
        userId,
      ],
    );
    return result.rows[0] ?? null;
  },

  /**
   * EDT 4.3.3. Baja lógica (RF 3.3.1): el registro se conserva con activo = false y la fecha de
   * la baja; ningún dato del perfil se borra ni se modifica. Solo afecta a un paciente activo, de
   * modo que una segunda baja no cambia la fecha de la primera. Sube la versión (ADR-10) para que
   * una edición abierta en otra pestaña detecte que el perfil cambió.
   */
  async discharge(id: string, userId: string, today: string, client: Queryable = db) {
    const result = await client.query<PatientProfile>(
      `UPDATE paciente SET
         activo = false,
         fecha_baja = now(),
         version = version + 1,
         updated_at = now(),
         updated_by = $2
       WHERE id = $1 AND activo = true
       RETURNING ${patientFields},
                 ${ageExpression('$3')},
                 updated_at`,
      [id, userId, today],
    );
    return result.rows[0] ?? null;
  },

  /**
   * EDT 4.3.3. Reactivación desde el perfil: el paciente vuelve a estar activo con los mismos
   * datos que tenía. No hace falta verificar la unicidad de CURP ni de teléfono porque las
   * restricciones únicas abarcan también a los pacientes dados de baja.
   */
  async restore(id: string, userId: string, today: string, client: Queryable = db) {
    const result = await client.query<PatientProfile>(
      `UPDATE paciente SET
         activo = true,
         fecha_baja = NULL,
         version = version + 1,
         updated_at = now(),
         updated_by = $2
       WHERE id = $1 AND activo = false
       RETURNING ${patientFields},
                 ${ageExpression('$3')},
                 updated_at`,
      [id, userId, today],
    );
    return result.rows[0] ?? null;
  },
};
