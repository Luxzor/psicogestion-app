-- EDT 4.3.5 Consulta y edición de terapeutas.
-- Índices que sostienen el listado y la búsqueda de la lista de terapeutas
-- (PG-DSN-002 §4.4 "Índices" y "Orden alfabético"; presupuesto de RNF 2.2.1 en §3.6).
--
-- Reutiliza la función f_sin_acentos y la colación es_mx_icu que ya crea
-- 0007_paciente_busqueda.sql: ambas son genéricas (no específicas de paciente), así que esta
-- migración no vuelve a crearlas, solo las usa. No modifica las tablas creadas por
-- 0005_paciente.sql ni 0006_terapeuta.sql. La reversa está en db/rollback/0008_terapeuta_busqueda.sql.
--
-- La búsqueda por prefijo de cédula, teléfono o correo (q en GET /terapeutas) no tiene un índice
-- dedicado, igual que CURP y teléfono en paciente: bajo la colación de BD en_US.utf8 un índice
-- btree normal no sirve un LIKE 'prefijo%' (se necesitaría text_pattern_ops o locale C), y un
-- Seq Scan sobre 100 000 filas de prueba resuelve esas tres búsquedas en 5-23 ms, dentro del
-- presupuesto de la lista (PG-DSN-002 §3.6). Se documenta aquí para no repetir el análisis.

-- Búsqueda por nombre sin acentos ni mayúsculas (cuadro de búsqueda de PG-DSN-002 §5.7).
CREATE INDEX IF NOT EXISTS ix_terapeuta_nombre_trgm ON terapeuta
  USING gin (f_sin_acentos(lower(nombre_completo)) gin_trgm_ops);

-- Orden alfabético del listado con la intercalación ICU es-MX (acompaña a
-- idx_terapeuta_activo_nombre de 0006, igual que ix_paciente_activo_nombre_icu acompaña a
-- idx_paciente_activo_nombre en pacientes).
CREATE INDEX IF NOT EXISTS ix_terapeuta_activo_nombre_icu ON terapeuta
  (activo, nombre_completo COLLATE es_mx_icu);
