-- Reversa de db/migrations/0007_paciente_busqueda.sql (EDT 4.3.2).
-- El orden importa: los índices dependen de la función y de la intercalación, y la función
-- depende de la extensión unaccent.
--
-- Los DROP EXTENSION se dejan sin CASCADE a propósito: si una migración posterior llegara a
-- usar pg_trgm o unaccent, la reversa falla de forma visible en lugar de borrar sus objetos.
-- En ese caso se omiten esas dos sentencias.

DROP INDEX IF EXISTS ix_paciente_activo_nombre_icu;
DROP INDEX IF EXISTS ix_paciente_nombre_trgm;

DROP COLLATION IF EXISTS es_mx_icu;

DROP FUNCTION IF EXISTS f_sin_acentos(text);

DROP EXTENSION IF EXISTS unaccent;
DROP EXTENSION IF EXISTS pg_trgm;

-- Permite que el runner vuelva a aplicar la migración.
DELETE FROM schema_migrations WHERE filename = '0007_paciente_busqueda.sql';
