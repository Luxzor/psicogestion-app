-- Reversa de db/migrations/0004_secure_recovery_tokens.sql (EDT 3.3, recuperación de contraseña).
-- Quita el selector de los tokens de recuperación y vuelve a crear el índice por token_hash que
-- 0004 eliminó, con la misma definición de 0001_core_auth.sql.
--
-- ADVERTENCIA: los tokens de recuperación vigentes dejan de servir, porque la API los busca por
-- selector. Conviene vaciar token_recuperacion antes o después de aplicarla.

DROP INDEX IF EXISTS idx_token_recuperacion_selector;

ALTER TABLE token_recuperacion DROP COLUMN IF EXISTS selector;

CREATE INDEX IF NOT EXISTS idx_token_recuperacion_hash ON token_recuperacion(token_hash);

-- Permite que el runner vuelva a aplicar la migración.
DELETE FROM schema_migrations WHERE filename = '0004_secure_recovery_tokens.sql';
