-- Reversa de db/migrations/0008_terapeuta_busqueda.sql (EDT 4.3.5).
-- Solo quita los dos índices que esta migración agregó. La función f_sin_acentos y la colación
-- es_mx_icu no se tocan: 0007_paciente_busqueda.sql las sigue usando para paciente.

DROP INDEX IF EXISTS ix_terapeuta_activo_nombre_icu;
DROP INDEX IF EXISTS ix_terapeuta_nombre_trgm;

-- Permite que el runner vuelva a aplicar la migración.
DELETE FROM schema_migrations WHERE filename = '0008_terapeuta_busqueda.sql';
