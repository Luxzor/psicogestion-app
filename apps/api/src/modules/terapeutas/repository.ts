import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { db } from '../../platform/db.js';
import {
  EDITABLE_FIELDS,
  type EditableField,
  type ListQuery,
  type TherapistInput,
  type UpdateTherapistInput,
} from './schemas.js';

type Queryable = Pick<PoolClient, 'query'>;

export type TherapistRecord = {
  id: string;
  nombre_completo: string;
  telefono: string;
  correo_electronico: string;
  fecha_nacimiento: string;
  cedula_profesional: string;
  foto_perfil: string | null;
  foto_actualizada_en: string | null;
  activo: boolean;
  fecha_baja: string | null;
  fecha_registro: string;
  version: number;
};

/**
 * Elemento del listado (PG-DSN-002 5.12.4): a diferencia de paciente, no minimiza correo ni
 * cédula, porque el diseño de la lista de terapeutas (5.7) ya los muestra como columnas.
 */
export type TherapistListItem = {
  id: string;
  nombre_completo: string;
  cedula_profesional: string;
  telefono: string;
  correo_electronico: string;
  foto_actualizada_en: string | null;
  activo: boolean;
};

/** Estado mínimo para decidir sobre una operación (control de versión, baja y reactivación). */
export type TherapistSummary = Pick<
  TherapistRecord,
  'id' | 'activo' | 'fecha_baja' | 'version'
> & { created_at: Date };

/**
 * Zona horaria de la clínica como literal de SQL. `env` ya validó que es un nombre IANA válido;
 * aun así se duplican las comillas para que nunca pueda cerrar el literal.
 */
const clinicZone = `'${env.CLINIC_TIME_ZONE.replace(/'/g, "''")}'`;

/**
 * Día de la baja en la zona de la clínica (EDT 4.3.5). `fecha_baja` es timestamptz: sin la
 * conversión, una baja hecha después de las 18:00 en Mérida se mostraría con la fecha del día
 * siguiente, porque la sesión de PostgreSQL trabaja en UTC. Antes de esta tarea no había baja de
 * terapeutas, así que `fecha_baja` era siempre NULL y esta expresión no cambia ninguna respuesta
 * existente (NULL AT TIME ZONE sigue siendo NULL).
 */
const dischargeDate = `to_char(fecha_baja AT TIME ZONE ${clinicZone}, 'YYYY-MM-DD') AS fecha_baja`;

const therapistFields = `
  id,
  nombre_completo,
  telefono,
  correo_electronico,
  to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
  cedula_profesional,
  foto_perfil,
  foto_actualizada_en,
  activo,
  ${dischargeDate},
  to_char(created_at, 'YYYY-MM-DD') AS fecha_registro,
  version`;

const summaryFields = `
  id,
  activo,
  ${dischargeDate},
  version,
  created_at`;

/** Evita que un % o un _ escritos en el buscador actúen como comodines de LIKE. */
const escapeForLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

/**
 * Filtro del listado: terapeutas activos, dados de baja o todos según `estado` (`activeParam` en
 * null para "todos") y, si hay búsqueda, nombre sin acentos, prefijo de cédula, de teléfono o de
 * correo (PG-DSN-002 5.7). Recibe las posiciones de los parámetros para poder reutilizarse en el
 * conteo.
 */
const matchClause = (
  activeParam: string,
  searchParam: string,
  digitsParam: string,
) => `
  (${activeParam}::boolean IS NULL OR activo = ${activeParam}::boolean)
  AND (${searchParam}::text IS NULL
       OR f_sin_acentos(lower(nombre_completo))
            LIKE '%' || f_sin_acentos(lower(${searchParam})) || '%'
       OR lower(correo_electronico) LIKE lower(${searchParam}) || '%'
       OR (${digitsParam}::text IS NOT NULL AND cedula_profesional LIKE ${digitsParam} || '%')
       OR (${digitsParam}::text IS NOT NULL AND telefono LIKE ${digitsParam} || '%'))`;

export const therapistRepository = {
  async findById(id: string, client: Queryable = db) {
    const result = await client.query<TherapistRecord>(
      `SELECT ${therapistFields} FROM terapeuta WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  /** Estado mínimo para control de versión, baja y reactivación (RF 2.2.4, ADR-10). */
  async findSummaryById(id: string, client: Queryable = db, lock = false) {
    const result = await client.query<TherapistSummary>(
      `SELECT ${summaryFields} FROM terapeuta WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  /**
   * Listado paginado de terapeutas activos, dados de baja o todos (RF 2.2.1, EDT 4.3.5). El total
   * viaja en la misma consulta con count(*) OVER() para no pagar un segundo viaje (presupuesto de
   * RNF 2.2.1, PG-DSN-002 3.6). La búsqueda acepta nombre sin acentos, prefijo de cédula, de
   * teléfono o de correo (5.7).
   */
  async list(query: ListQuery, client: Queryable = db) {
    const active = query.estado === 'todos' ? null : query.estado === 'activos';
    const search = query.q ? escapeForLike(query.q) : null;
    const digitsPrefix = search && /^\d+$/.test(search) ? search : null;
    const orderBy =
      query.orden === '-fecha_registro'
        ? 'created_at DESC, id DESC'
        : 'nombre_completo COLLATE es_mx_icu ASC, id ASC';

    const result = await client.query<TherapistListItem & { total: string }>(
      `SELECT id,
              nombre_completo,
              cedula_profesional,
              telefono,
              correo_electronico,
              foto_actualizada_en,
              activo,
              count(*) OVER() AS total
       FROM terapeuta
       WHERE ${matchClause('$1', '$2', '$3')}
       ORDER BY ${orderBy}
       LIMIT $4 OFFSET $5`,
      [active, search, digitsPrefix, query.tamano, (query.pagina - 1) * query.tamano],
    );

    const datos: TherapistListItem[] = result.rows.map((row) => ({
      id: row.id,
      nombre_completo: row.nombre_completo,
      cedula_profesional: row.cedula_profesional,
      telefono: row.telefono,
      correo_electronico: row.correo_electronico,
      foto_actualizada_en: row.foto_actualizada_en,
      activo: row.activo,
    }));
    if (result.rows.length) return { datos, total: Number(result.rows[0].total) };

    // count(*) OVER() solo viaja en las filas devueltas: si la página quedó fuera de rango hay
    // que preguntar el total aparte para que el cliente pueda corregir la paginación.
    if (query.pagina === 1) return { datos, total: 0 };
    const counted = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM terapeuta WHERE ${matchClause('$1', '$2', '$3')}`,
      [active, search, digitsPrefix],
    );
    return { datos, total: Number(counted.rows[0].total) };
  },

  async isPhoneTaken(telefono: string, excludeId?: string | null, client: Queryable = db) {
    const result = await client.query(
      `SELECT 1 FROM terapeuta
       WHERE telefono = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
       LIMIT 1`,
      [telefono, excludeId ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async isEmailTaken(correo: string, excludeId?: string | null, client: Queryable = db) {
    const result = await client.query(
      `SELECT 1 FROM terapeuta
       WHERE lower(correo_electronico) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)
       LIMIT 1`,
      [correo, excludeId ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async isCedulaTaken(cedula: string, excludeId?: string | null, client: Queryable = db) {
    const result = await client.query(
      `SELECT 1 FROM terapeuta
       WHERE cedula_profesional = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
       LIMIT 1`,
      [cedula, excludeId ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async create(data: TherapistInput, userId: string, client: Queryable = db) {
    const result = await client.query<TherapistRecord>(
      `INSERT INTO terapeuta
        (nombre_completo, telefono, correo_electronico, fecha_nacimiento,
         cedula_profesional, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING ${therapistFields}`,
      [
        data.nombre_completo,
        data.telefono,
        data.correo_electronico.toLowerCase(),
        data.fecha_nacimiento,
        data.cedula_profesional,
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
    input: UpdateTherapistInput,
    userId: string,
    client: Queryable = db,
  ) {
    const changed = EDITABLE_FIELDS.filter((field) => field in input);
    const params: unknown[] = [id, input.version, userId];
    const assignments = changed.map((field) => {
      params.push(input[field as EditableField]);
      return `${field} = $${params.length}`;
    });

    const result = await client.query<TherapistRecord>(
      `UPDATE terapeuta SET
         ${assignments.join(',\n         ')},
         version = version + 1,
         updated_at = now(),
         updated_by = $3
       WHERE id = $1 AND version = $2 AND activo = true
       RETURNING ${therapistFields}`,
      params,
    );
    return result.rows[0] ?? null;
  },

  /**
   * EDT 4.3.5. Baja lógica (RF 2.3.1): el registro se conserva con activo = false, la fecha de la
   * baja y quién la hizo (baja_por); ningún otro dato del perfil cambia y la fotografía no se
   * toca. Solo afecta a un terapeuta activo, de modo que una segunda baja no cambia la fecha de la
   * primera. Sube la versión (ADR-10) para que una edición abierta en otra pestaña detecte que el
   * perfil cambió.
   */
  async discharge(id: string, userId: string, client: Queryable = db) {
    const result = await client.query<TherapistRecord>(
      `UPDATE terapeuta SET
         activo = false,
         fecha_baja = now(),
         baja_por = $2,
         version = version + 1,
         updated_at = now(),
         updated_by = $2
       WHERE id = $1 AND activo = true
       RETURNING ${therapistFields}`,
      [id, userId],
    );
    return result.rows[0] ?? null;
  },

  /**
   * EDT 4.3.5. Reactivación desde el perfil (RF 2.3.4): el terapeuta vuelve a estar activo;
   * fecha_baja y baja_por se limpian. No hace falta verificar unicidad porque las restricciones
   * únicas de teléfono, correo y cédula ya abarcan a los terapeutas dados de baja.
   */
  async restore(id: string, userId: string, client: Queryable = db) {
    const result = await client.query<TherapistRecord>(
      `UPDATE terapeuta SET
         activo = true,
         fecha_baja = NULL,
         baja_por = NULL,
         version = version + 1,
         updated_at = now(),
         updated_by = $2
       WHERE id = $1 AND activo = false
       RETURNING ${therapistFields}`,
      [id, userId],
    );
    return result.rows[0] ?? null;
  },

  async updatePhoto(id: string, storageKey: string, userId: string, client: Queryable = db) {
    const result = await client.query<TherapistRecord>(
      `UPDATE terapeuta
       SET foto_perfil = $2,
           foto_actualizada_en = now(),
           updated_at = now(),
           updated_by = $3
       WHERE id = $1
       RETURNING ${therapistFields}`,
      [id, storageKey, userId],
    );
    return result.rows[0] ?? null;
  },

  async removePhoto(id: string, userId: string, client: Queryable = db) {
    const result = await client.query<TherapistRecord>(
      `UPDATE terapeuta
       SET foto_perfil = NULL,
           foto_actualizada_en = NULL,
           updated_at = now(),
           updated_by = $2
       WHERE id = $1
       RETURNING ${therapistFields}`,
      [id, userId],
    );
    return result.rows[0] ?? null;
  },
};
