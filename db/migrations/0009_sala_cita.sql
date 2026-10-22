-- EDT 5.2.1 Ajustes al modelo de datos de salas y citas (PG-DSN-003 v0.1.0, sección 4 y
-- apéndice 11.2). Entidades Sala y Cita de PG-ERS-001 v0.6.3, sección 3.4.
--
-- Migración aditiva: no modifica las tablas de las iteraciones anteriores. La cita solo referencia
-- a paciente, terapeuta y sala con ON DELETE RESTRICT, de modo que ningún registro con citas puede
-- borrarse físicamente (retención de datos, ERS 3.4).
--
-- Reglas heredadas de PG-DSN-001 4.6 y PG-DSN-002 4.4: llaves UUID (DESV-08), baja lógica,
-- control de versión optimista (ADR-23) y auditoría con created_by / updated_by como referencias
-- opcionales con ON DELETE SET NULL.
--
-- No se crean BloqueHorario, DisponibilidadTerapeuta, DisponibilidadSala ni CitaBloque (ADR-15,
-- DESV-07): los bloques de 30 minutos de 07:00 a 17:00 se calculan en código y la cita guarda su
-- rango continuo [inicio, fin).
--
-- La migración es idempotente y su reversa está en db/rollback/0009_sala_cita.sql.

-- ADR-16: las restricciones EXCLUDE combinan igualdad sobre UUID con traslape de rangos, lo que
-- requiere las clases de operadores de btree_gist. Es una extensión de confianza desde
-- PostgreSQL 13, por lo que el dueño de la base puede crearla sin ser superusuario.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------------------------
-- Sala (PG-DSN-003 4.3.1; RF 4.1.1 a RF 4.1.4; ADR-19)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sala (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre varchar(10) NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  fecha_baja timestamptz,
  baja_por uuid REFERENCES usuario(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES usuario(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT sala_nombre_no_vacio CHECK (length(btrim(nombre)) BETWEEN 1 AND 10),
  CONSTRAINT sala_baja_coherente CHECK (
    (activo AND fecha_baja IS NULL) OR (NOT activo AND fecha_baja IS NOT NULL)
  ),
  CONSTRAINT sala_version_positiva CHECK (version >= 1)
);

COMMENT ON TABLE sala IS
  'Salas de atención de la clínica (ERS 3.4). La baja es lógica: activo = false (ADR-19).';

-- RF 4.1.4 y RNF 4.1.2: el nombre es único sin distinguir mayúsculas ni espacios laterales. El
-- índice abarca también a las salas dadas de baja: su nombre sigue ocupado hasta reactivarlas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sala_nombre ON sala (lower(btrim(nombre)));

-- ---------------------------------------------------------------------------------------------
-- Cita (PG-DSN-003 4.3.2; RF 5.1 a RF 5.4; ADR-16 a ADR-18 y ADR-20)
-- ---------------------------------------------------------------------------------------------

-- RF 5.2.2: los tres estados de la cita. CREATE TYPE no admite IF NOT EXISTS, por lo que se
-- protege con un bloque anónimo para que la migración sea idempotente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cita_estado') THEN
    CREATE TYPE cita_estado AS ENUM ('Pendiente', 'Cancelada', 'Vencida');
  END IF;
END
$$;

-- ADR-17: el número del folio. Sin ciclo: si se agota, la secuencia falla en lugar de repetir un
-- folio. Un alta que falla después de tomar el número deja un hueco; es el comportamiento
-- esperado (PG-DSN-003 11.3).
CREATE SEQUENCE IF NOT EXISTS cita_folio_seq AS integer MINVALUE 1 MAXVALUE 999999 NO CYCLE;

CREATE TABLE IF NOT EXISTS cita (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RF 5.1.12 y RNF 5.1.2: «C» + año de dos dígitos en la zona de la clínica + 6 dígitos, por
  -- ejemplo C26000001. Lo asigna la base en el mismo INSERT, sin un segundo viaje.
  folio varchar(10) NOT NULL DEFAULT (
    'C' || to_char(now() AT TIME ZONE 'America/Merida', 'YY')
        || lpad(nextval('cita_folio_seq')::text, 6, '0')
  ),
  id_paciente uuid NOT NULL REFERENCES paciente(id) ON DELETE RESTRICT,
  id_terapeuta uuid NOT NULL REFERENCES terapeuta(id) ON DELETE RESTRICT,
  id_sala uuid NOT NULL REFERENCES sala(id) ON DELETE RESTRICT,
  inicio timestamptz NOT NULL,
  fin timestamptz NOT NULL,
  estado cita_estado NOT NULL DEFAULT 'Pendiente',
  cancelada_en timestamptz,
  cancelada_por uuid REFERENCES usuario(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES usuario(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT uq_cita_folio UNIQUE (folio),
  CONSTRAINT cita_folio_formato CHECK (folio ~ '^C[0-9]{2}[0-9]{6}$'),
  CONSTRAINT cita_rango_valido CHECK (fin > inicio),
  -- ADR-15: rejilla de 30 minutos (minutos 0 o 30 y segundos en cero) en la hora de Mérida.
  CONSTRAINT cita_rejilla_30min CHECK (
    extract(minute FROM inicio AT TIME ZONE 'America/Merida') IN (0, 30)
    AND extract(minute FROM fin AT TIME ZONE 'America/Merida') IN (0, 30)
    AND extract(second FROM inicio) = 0
    AND extract(second FROM fin) = 0
  ),
  CONSTRAINT cita_mismo_dia CHECK (
    (inicio AT TIME ZONE 'America/Merida')::date = (fin AT TIME ZONE 'America/Merida')::date
  ),
  -- RF 6.2.2: horario operativo de 07:00 a 17:00. Si el cliente confirma 19:00 (H3-08, TP3-02),
  -- este límite cambia en una migración nueva junto con la constante del cliente.
  CONSTRAINT cita_horario_operativo CHECK (
    (inicio AT TIME ZONE 'America/Merida')::time >= TIME '07:00'
    AND (fin AT TIME ZONE 'America/Merida')::time <= TIME '17:00'
  ),
  -- ADR-20: una cita Cancelada siempre registra cuándo se canceló, y solo ella.
  CONSTRAINT cita_cancelacion_coherente CHECK (
    (estado = 'Cancelada') = (cancelada_en IS NOT NULL)
  ),
  CONSTRAINT cita_version_positiva CHECK (version >= 1),
  -- ADR-16 y ERS 3.7: ninguna sala, terapeuta ni paciente puede tener dos citas Pendientes que se
  -- traslapen. El rango es semiabierto, así que las citas contiguas (09:00 a 10:00 y 10:00 a
  -- 11:00) sí se permiten. Al cancelar o vencer una cita, su horario deja de estar ocupado.
  CONSTRAINT cita_sala_sin_empalme EXCLUDE USING gist (
    id_sala WITH =, tstzrange(inicio, fin) WITH &&
  ) WHERE (estado = 'Pendiente'),
  CONSTRAINT cita_terapeuta_sin_empalme EXCLUDE USING gist (
    id_terapeuta WITH =, tstzrange(inicio, fin) WITH &&
  ) WHERE (estado = 'Pendiente'),
  CONSTRAINT cita_paciente_sin_empalme EXCLUDE USING gist (
    id_paciente WITH =, tstzrange(inicio, fin) WITH &&
  ) WHERE (estado = 'Pendiente')
);

COMMENT ON TABLE cita IS
  'Citas entre un paciente y un terapeuta en una sala (ERS 3.4). No se borran: cancelar cambia el estado (ADR-20).';
COMMENT ON COLUMN cita.folio IS
  'Folio legible y único, C + AA + 6 dígitos (ADR-17). No se reutiliza.';
COMMENT ON COLUMN cita.fin IS
  'Fin exclusivo del rango [inicio, fin). Lo calcula el servidor a partir de la duración en bloques.';

-- RNF 5.1.1 y RNF 5.1.4: listado por periodo, por estado, por sala, por terapeuta y por paciente.
-- idx_cita_estado_inicio también sostiene el marcado de citas Vencidas (ADR-18).
CREATE INDEX IF NOT EXISTS idx_cita_inicio ON cita (inicio);
CREATE INDEX IF NOT EXISTS idx_cita_estado_inicio ON cita (estado, inicio);
CREATE INDEX IF NOT EXISTS idx_cita_sala_inicio ON cita (id_sala, inicio);
CREATE INDEX IF NOT EXISTS idx_cita_terapeuta_inicio ON cita (id_terapeuta, inicio);
CREATE INDEX IF NOT EXISTS idx_cita_paciente_inicio ON cita (id_paciente, inicio);
