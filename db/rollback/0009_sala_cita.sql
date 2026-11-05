-- Reversa de db/migrations/0009_sala_cita.sql (EDT 5.2.1).
-- El orden importa: cita depende de sala, del tipo cita_estado y de la secuencia cita_folio_seq;
-- las restricciones EXCLUDE de cita dependen de btree_gist.
--
-- ADVERTENCIA: borra todas las salas y citas registradas. Verifícala siempre contra la base de
-- pruebas, nunca contra la de desarrollo ni la de producción (db/README.md).
--
-- DROP EXTENSION se deja sin CASCADE a propósito: si una migración posterior llegara a usar
-- btree_gist, la reversa falla de forma visible en lugar de borrar sus objetos. En ese caso se
-- omite esa sentencia.

DROP TABLE IF EXISTS cita;
DROP SEQUENCE IF EXISTS cita_folio_seq;
DROP TYPE IF EXISTS cita_estado;
DROP TABLE IF EXISTS sala;

DROP EXTENSION IF EXISTS btree_gist;

-- Permite que el runner vuelva a aplicar la migración.
DELETE FROM schema_migrations WHERE filename = '0009_sala_cita.sql';
