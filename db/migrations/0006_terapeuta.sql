-- EDT 4.3.4 Registro de terapeutas (RF 2.1.1 a RF 2.1.15).
-- La baja es lógica (TP2-03): el registro se conserva con activo = false.
-- Reglas de diseño de PG-DSN-002 4.3.2 y 4.4: UUID, teléfono único de 10 dígitos,
-- correo único normalizado en minúsculas, cédula profesional única de 7 u 8 dígitos,
-- fecha de nacimiento anterior al registro, baja lógica coherente y auditoría con
-- created_by / updated_by con ON DELETE SET NULL.

CREATE TABLE IF NOT EXISTS terapeuta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_completo varchar(50) NOT NULL,
  telefono varchar(15) NOT NULL,
  correo_electronico varchar(100) NOT NULL,
  fecha_nacimiento date NOT NULL,
  cedula_profesional varchar(20) NOT NULL,
  foto_perfil text,
  foto_actualizada_en timestamptz,
  activo boolean NOT NULL DEFAULT true,
  fecha_baja timestamptz,
  baja_por uuid REFERENCES usuario(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES usuario(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT uq_terapeuta_telefono UNIQUE (telefono),
  CONSTRAINT uq_terapeuta_cedula UNIQUE (cedula_profesional),
  CONSTRAINT terapeuta_nombre_no_vacio CHECK (length(btrim(nombre_completo)) > 0),
  CONSTRAINT terapeuta_telefono_formato CHECK (telefono ~ '^[0-9]{10}$'),
  CONSTRAINT terapeuta_cedula_formato CHECK (cedula_profesional ~ '^[0-9]{7,8}$'),
  CONSTRAINT terapeuta_correo_formato CHECK (
    correo_electronico ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  CONSTRAINT terapeuta_fecha_nacimiento_rango CHECK (fecha_nacimiento >= DATE '1900-01-01'),
  CONSTRAINT ck_terapeuta_fecha_nac CHECK (fecha_nacimiento < (created_at AT TIME ZONE 'America/Merida')::date),
  CONSTRAINT terapeuta_baja_coherente CHECK (
    (activo AND fecha_baja IS NULL) OR (NOT activo AND fecha_baja IS NOT NULL)
  ),
  CONSTRAINT terapeuta_version_positiva CHECK (version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_terapeuta_correo ON terapeuta (lower(correo_electronico));
CREATE INDEX IF NOT EXISTS idx_terapeuta_activo_nombre ON terapeuta(activo, nombre_completo);

