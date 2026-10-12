import type { PoolClient } from 'pg';
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
  to_char(fecha_baja, 'YYYY-MM-DD') AS fecha_baja,
  to_char(created_at, 'YYYY-MM-DD') AS fecha_registro,
  version`;

const summaryFields = `
  id,
  nombre_completo,
  curp,
  activo,
  to_char(fecha_baja, 'YYYY-MM-DD') AS fecha_baja,
  version,
  created_at`;

/** Años cumplidos al día indicado; el "hoy" llega como parámetro desde el reloj de la clínica. */
const ageExpression = (todayParam: string) =>
  `EXTRACT(YEAR FROM age(${todayParam}::date, fecha_nacimiento))::int AS edad`;

/** Evita que un % o un _ escritos en el buscador actúen como comodines de LIKE. */
const escapeForLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

/**
 * Filtro del listado: solo activos (el filtro por estado llega con la EDT 4.3.3) y, si hay
 * búsqueda, nombre sin acentos, prefijo de CURP o prefijo de teléfono (PG-DSN-002 §5.4).
 * Recibe las posiciones de los parámetros para poder reutilizarse en el conteo.
 */
const matchClause = (searchParam: string, phoneParam: string) => `
  activo
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
   * Listado paginado de pacientes activos (RF 3.2.1). El total viaja en la misma consulta con
   * count(*) OVER() para no pagar un segundo viaje (presupuesto de RNF 3.2.1, PG-DSN-002 §3.6).
   * La búsqueda acepta nombre sin acentos, prefijo de CURP o prefijo de teléfono (§5.4).
   */
  async list(query: ListQuery, today: string, client: Queryable = db) {
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
       WHERE ${matchClause('$2', '$3')}
       ORDER BY ${orderBy}
       LIMIT $4 OFFSET $5`,
      [today, search, phonePrefix, query.tamano, (query.pagina - 1) * query.tamano],
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
      `SELECT count(*)::text AS total FROM paciente WHERE ${matchClause('$1', '$2')}`,
      [search, phonePrefix],
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
};
