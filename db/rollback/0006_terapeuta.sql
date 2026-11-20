-- Reversa de db/migrations/0006_terapeuta.sql (EDT 4.3.4).
-- Antes deben aplicarse las reversas de 0009 (cita hace referencia a terapeuta) y de 0008
-- (índices de búsqueda sobre terapeuta). DROP TABLE va sin CASCADE a propósito: si alguna sigue
-- aplicada, la reversa falla de forma visible en lugar de borrar objetos de otra migración.
--
-- ADVERTENCIA: borra todos los terapeutas registrados. Verifícala siempre contra la base de
-- pruebas, nunca contra la de desarrollo ni la de producción (db/README.md).
--
-- Los índices uq_terapeuta_correo e idx_terapeuta_activo_nombre y las restricciones se eliminan
-- junto con la tabla.

DROP TABLE IF EXISTS terapeuta;

-- Permite que el runner vuelva a aplicar la migración.
DELETE FROM schema_migrations WHERE filename = '0006_terapeuta.sql';
