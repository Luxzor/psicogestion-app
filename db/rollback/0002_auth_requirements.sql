-- Reversa de db/migrations/0002_auth_requirements.sql (EDT 3.3).
-- Quita el consentimiento y la regla de formato del teléfono, y deja la restricción
-- usuario_correo_uady con la definición exacta de 0001_core_auth.sql.
--
-- La restricción de 0001 se restaura con NOT VALID: su patrón '@uady\\.mx$' exige una barra
-- invertida literal antes de "mx" (standard_conforming_strings está activo), así que ninguna
-- cuenta real la cumple; por eso 0003 la corrigió. Con NOT VALID la definición queda igual a la
-- original sin rechazar las filas existentes; las filas nuevas sí se validan, como en 0001.
--
-- ADVERTENCIA: se pierde el registro de consentimiento de cada cuenta.

ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_telefono_formato;

ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_correo_uady;
ALTER TABLE usuario
  ADD CONSTRAINT usuario_correo_uady
  CHECK (correo_institucional ~* '^[A-Z0-9._%+-]+@uady\\.mx$') NOT VALID;

ALTER TABLE usuario
  DROP COLUMN IF EXISTS consentimiento_en,
  DROP COLUMN IF EXISTS consentimiento;

-- Permite que el runner vuelva a aplicar la migración.
DELETE FROM schema_migrations WHERE filename = '0002_auth_requirements.sql';
