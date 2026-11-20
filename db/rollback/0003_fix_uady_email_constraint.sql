-- Reversa de db/migrations/0003_fix_uady_email_constraint.sql (EDT 3.3).
-- Deja la restricción usuario_correo_uady con la definición exacta de
-- 0002_auth_requirements.sql.
--
-- Se restaura con NOT VALID: el patrón de 0002 ('\\.' dentro de la cadena) exige una barra
-- invertida literal antes de "UADY" y de "MX", así que ninguna cuenta real lo cumple; ese es el
-- defecto que 0003 corrigió. Con NOT VALID la definición queda igual a la de 0002 sin rechazar
-- las filas existentes; las filas nuevas sí se validan, como antes de 0003.

ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_correo_uady;
ALTER TABLE usuario
  ADD CONSTRAINT usuario_correo_uady
  CHECK (correo_institucional ~* '^[A-Z0-9._%+-]+@([A-Z0-9-]+\\.)?UADY\\.MX$') NOT VALID;

-- Permite que el runner vuelva a aplicar la migración.
DELETE FROM schema_migrations WHERE filename = '0003_fix_uady_email_constraint.sql';
