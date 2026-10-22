-- 0001: série temporal de medições e fila de mensagens recusadas (T1a).
-- Modelo da seção 11 do PRD. As colunas late e derived foram acrescentadas pela T1a.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE measurements (
  tenant_id   uuid             NOT NULL,
  device_id   uuid             NOT NULL,
  quantity    text             NOT NULL,
  ts          timestamptz      NOT NULL,
  value       double precision NOT NULL,
  unit        text             NOT NULL,
  suspect     boolean          NOT NULL DEFAULT false,
  late        boolean          NOT NULL DEFAULT false,
  derived     boolean          NOT NULL DEFAULT false,
  message_id  uuid             NOT NULL,
  received_at timestamptz      NOT NULL DEFAULT now(),
  -- A chave torna a gravação idempotente: INSERT ... ON CONFLICT DO NOTHING.
  PRIMARY KEY (device_id, quantity, ts)
);

SELECT create_hypertable('measurements', 'ts');

CREATE INDEX measurements_tenant_ts_idx ON measurements (tenant_id, ts DESC);
CREATE INDEX measurements_message_idx ON measurements (message_id);

-- Dead Letter Channel. tenant_id fica nulo quando a mensagem não chegou a identificar um
-- dispositivo cadastrado. message_id é texto porque a mensagem recusada pode trazer um id inválido.
CREATE TABLE dead_letters (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid,
  message_id  text,
  source      text        NOT NULL CHECK (source IN ('mqtt', 'http', 'batch')),
  topic       text,
  payload     jsonb       NOT NULL,
  issues      jsonb       NOT NULL,
  received_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dead_letters_tenant_received_idx ON dead_letters (tenant_id, received_at DESC);
CREATE INDEX dead_letters_message_idx ON dead_letters (message_id);
