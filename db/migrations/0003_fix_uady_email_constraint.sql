ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_correo_uady;
ALTER TABLE usuario
  ADD CONSTRAINT usuario_correo_uady
  CHECK (correo_institucional ~* '^[A-Z0-9._%+-]+@([A-Z0-9-]+\.)?UADY\.MX$');
