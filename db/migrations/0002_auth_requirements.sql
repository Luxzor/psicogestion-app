ALTER TABLE usuario
  ADD COLUMN IF NOT EXISTS consentimiento boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consentimiento_en timestamptz;

ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_correo_uady;
ALTER TABLE usuario
  ADD CONSTRAINT usuario_correo_uady
  CHECK (correo_institucional ~* '^[A-Z0-9._%+-]+@([A-Z0-9-]+\\.)?UADY\\.MX$');

ALTER TABLE usuario
  ADD CONSTRAINT usuario_telefono_formato CHECK (telefono ~ '^[0-9]{10}$');
