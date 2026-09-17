CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('pendiente_verificacion', 'activo', 'bloqueado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('administrador');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS usuario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_completo varchar(50) NOT NULL,
  telefono varchar(15) NOT NULL UNIQUE,
  correo_institucional varchar(100) NOT NULL UNIQUE,
  hash_contrasena varchar(255) NOT NULL,
  estado user_status NOT NULL DEFAULT 'pendiente_verificacion',
  rol user_role NOT NULL DEFAULT 'administrador',
  fecha_registro timestamptz NOT NULL DEFAULT now(),
  ultimo_acceso timestamptz,
  CONSTRAINT usuario_correo_uady CHECK (correo_institucional ~* '^[A-Z0-9._%+-]+@uady\\.mx$')
);

CREATE TABLE IF NOT EXISTS codigo_verificacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  codigo_hash varchar(255) NOT NULL,
  intentos smallint NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  emitido_en timestamptz NOT NULL DEFAULT now(),
  expira_en timestamptz NOT NULL,
  consumido_en timestamptz,
  CONSTRAINT codigo_verificacion_expiracion CHECK (expira_en > emitido_en)
);

CREATE TABLE IF NOT EXISTS token_recuperacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  emitido_en timestamptz NOT NULL DEFAULT now(),
  token_hash varchar(255) NOT NULL,
  ip_solicitud inet,
  expira_en timestamptz NOT NULL,
  consumido_en timestamptz,
  CONSTRAINT token_recuperacion_expiracion CHECK (expira_en > emitido_en)
);

CREATE TABLE IF NOT EXISTS sesion (
  id uuid PRIMARY KEY,
  id_usuario uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  refresh_hash varchar(255) NOT NULL,
  user_agent varchar(255),
  ip inet,
  emitido_en timestamptz NOT NULL DEFAULT now(),
  expira_en timestamptz NOT NULL,
  revocado_en timestamptz,
  CONSTRAINT sesion_expiracion CHECK (expira_en > emitido_en)
);

CREATE TABLE IF NOT EXISTS bitacora_acceso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario uuid REFERENCES usuario(id) ON DELETE SET NULL,
  evento varchar(50) NOT NULL,
  fecha timestamptz NOT NULL DEFAULT now(),
  ip inet,
  user_agent varchar(255),
  correlation_id uuid,
  detalle varchar(255)
);

CREATE INDEX IF NOT EXISTS idx_token_recuperacion_hash ON token_recuperacion(token_hash);
CREATE INDEX IF NOT EXISTS idx_sesion_refresh_hash ON sesion(refresh_hash);
CREATE INDEX IF NOT EXISTS idx_codigo_verificacion_usuario_consumido ON codigo_verificacion(id_usuario, consumido_en);
CREATE INDEX IF NOT EXISTS idx_bitacora_acceso_usuario_fecha ON bitacora_acceso(id_usuario, fecha);
