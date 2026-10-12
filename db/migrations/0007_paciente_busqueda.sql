-- EDT 4.3.2 Consulta y edición de pacientes.
-- Índices que sostienen el listado y la búsqueda de la lista de pacientes
-- (PG-DSN-002 §4.4 "Índices" y "Orden alfabético"; presupuesto de RNF 3.2.1 en §3.6:
-- GET de la lista en 400 ms o menos con 25 filas por página).
--
-- La migración es idempotente y su reversa está en db/rollback/0007_paciente_busqueda.sql.
-- No modifica las tablas creadas por 0005_paciente.sql ni 0006_terapeuta.sql.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() es STABLE porque depende del diccionario que resuelva el search_path, y una
-- función así no puede indexarse. Al fijar el diccionario con un regdictionary explícito el
-- resultado solo depende de los argumentos, por lo que la envoltura sí puede declararse
-- IMMUTABLE (PG-DSN-002 §11.3, nota de implementación).
CREATE OR REPLACE FUNCTION f_sin_acentos(texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, texto)
$$;

COMMENT ON FUNCTION f_sin_acentos(text) IS
  'Quita los acentos de un texto de forma inmutable, para poder indexarlo (PG-DSN-002 4.4).';

-- Búsqueda por nombre sin acentos ni mayúsculas (cuadro de búsqueda de PG-DSN-002 §5.4).
CREATE INDEX IF NOT EXISTS ix_paciente_nombre_trgm ON paciente
  USING gin (f_sin_acentos(lower(nombre_completo)) gin_trgm_ops);

-- Orden alfabético del listado: la intercalación ICU es-MX coloca la "Ñ" y las vocales
-- acentuadas en su lugar, a diferencia del orden por punto de código de la base de datos.
CREATE COLLATION IF NOT EXISTS es_mx_icu (provider = icu, locale = 'es-MX');

COMMENT ON COLLATION es_mx_icu IS
  'Intercalación del listado de pacientes y terapeutas (PG-DSN-002 4.4).';

-- Acompaña a idx_paciente_activo_nombre (0005): el filtro por estado más el orden que
-- realmente usa el listado, de modo que la página se resuelva sin ordenar en memoria.
CREATE INDEX IF NOT EXISTS ix_paciente_activo_nombre_icu ON paciente
  (activo, nombre_completo COLLATE es_mx_icu);
