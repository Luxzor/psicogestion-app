-- Reversa de db/migrations/0001_core_auth.sql (EDT 3.3, cuentas de usuario).
-- Es la última reversa que se aplica: 0005, 0006 y 0009 hacen referencia a usuario, así que sus
-- reversas deben ir antes. El orden de este script importa: las tablas hijas dependen de usuario
-- y usuario depende de los tipos user_status y user_role.
--
-- ADVERTENCIA: borra todas las cuentas, sesiones, códigos, tokens y la bitácora de acceso.
-- Verifícala siempre contra la base de pruebas, nunca contra la de desarrollo ni la de
-- producción (db/README.md).
--
-- Los índices de 0001 se eliminan junto con sus tablas. La tabla schema_migrations la crea el
-- runner, no esta migración, y se conserva.
--
-- DROP EXTENSION se deja sin CASCADE a propósito: si otra migración llegara a usar pgcrypto, la
-- reversa falla de forma visible en lugar de borrar sus objetos. En ese caso se omite esa
-- sentencia.

DROP TABLE IF EXISTS bitacora_acceso;
DROP TABLE IF EXISTS sesion;
DROP TABLE IF EXISTS token_recuperacion;
DROP TABLE IF EXISTS codigo_verificacion;
DROP TABLE IF EXISTS usuario;

DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS user_status;

DROP EXTENSION IF EXISTS pgcrypto;

-- Permite que el runner vuelva a aplicar la migración.
DELETE FROM schema_migrations WHERE filename = '0001_core_auth.sql';
