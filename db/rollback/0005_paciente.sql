-- Reversa de db/migrations/0005_paciente.sql (EDT 4.3.1).
-- Antes deben aplicarse las reversas de 0009 (cita hace referencia a paciente) y de 0007 (índices
-- de búsqueda sobre paciente). DROP TABLE va sin CASCADE a propósito: si alguna sigue aplicada,
-- la reversa falla de forma visible en lugar de borrar objetos de otra migración.
--
-- ADVERTENCIA: borra todos los pacientes registrados. Verifícala siempre contra la base de
-- pruebas, nunca contra la de desarrollo ni la de producción (db/README.md).
--
-- El índice idx_paciente_activo_nombre y las restricciones se eliminan junto con la tabla.

DROP TABLE IF EXISTS paciente;

-- Permite que el runner vuelva a aplicar la migración.
DELETE FROM schema_migrations WHERE filename = '0005_paciente.sql';
