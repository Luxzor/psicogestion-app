-- EDT 4.3.1 Registro de pacientes (RF 3.1.1 a RF 3.1.14).
-- La baja es lógica (RF 3.3.1): el registro se conserva con activo = false.
-- Reglas de diseño de PG-DSN-001 4.6: UUID, baja lógica y auditoría con
-- created_by / updated_by como referencias opcionales con ON DELETE SET NULL.

CREATE TABLE IF NOT EXISTS paciente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_completo varchar(50) NOT NULL,
  curp char(18) NOT NULL,
  sexo char(1) NOT NULL,
  fecha_nacimiento date NOT NULL,
  telefono varchar(10) NOT NULL,
  correo varchar(100),
  consentimiento boolean NOT NULL DEFAULT false,
  consentimiento_en timestamptz,
  activo boolean NOT NULL DEFAULT true,
  fecha_baja timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES usuario(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT paciente_curp_unico UNIQUE (curp),
  CONSTRAINT paciente_telefono_unico UNIQUE (telefono),
  CONSTRAINT paciente_nombre_no_vacio CHECK (length(btrim(nombre_completo)) > 0),
  CONSTRAINT paciente_curp_formato CHECK (
    curp ~ '^[A-Z][AEIOUX][A-Z]{2}[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9][0-9]$'
  ),
  CONSTRAINT paciente_sexo_valido CHECK (sexo IN ('F', 'M', 'O')),
  CONSTRAINT paciente_telefono_formato CHECK (telefono ~ '^[0-9]{10}$'),
  CONSTRAINT paciente_correo_formato CHECK (
    correo IS NULL OR correo ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  CONSTRAINT paciente_fecha_nacimiento_rango CHECK (fecha_nacimiento >= DATE '1900-01-01'),
  CONSTRAINT paciente_consentimiento_fecha CHECK (NOT consentimiento OR consentimiento_en IS NOT NULL),
  CONSTRAINT paciente_baja_coherente CHECK (
    (activo AND fecha_baja IS NULL) OR (NOT activo AND fecha_baja IS NOT NULL)
  ),
  CONSTRAINT paciente_version_positiva CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_paciente_activo_nombre ON paciente(activo, nombre_completo);
