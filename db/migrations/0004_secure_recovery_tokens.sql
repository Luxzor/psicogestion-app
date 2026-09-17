ALTER TABLE token_recuperacion
  ADD COLUMN IF NOT EXISTS selector varchar(64);

UPDATE token_recuperacion
SET selector = encode(gen_random_bytes(16), 'hex')
WHERE selector IS NULL;

ALTER TABLE token_recuperacion
  ALTER COLUMN selector SET NOT NULL;

DROP INDEX IF EXISTS idx_token_recuperacion_hash;

CREATE UNIQUE INDEX IF NOT EXISTS idx_token_recuperacion_selector
  ON token_recuperacion(selector);
