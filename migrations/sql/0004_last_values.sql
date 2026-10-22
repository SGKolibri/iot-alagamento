-- 0004: espelho do último valor por dispositivo e grandeza (RF-DAD-02, T1c).
-- O consumidor de measurement.ingested grava aqui e no Redis; a regra é o horário da medição:
-- o upsert só substitui quando a medição nova é mais recente (WHERE last_values.ts < EXCLUDED.ts).
CREATE TABLE last_values (
  tenant_id   uuid             NOT NULL,
  device_id   uuid             NOT NULL,
  quantity    text             NOT NULL,
  ts          timestamptz      NOT NULL,
  value       double precision NOT NULL,
  unit        text             NOT NULL,
  late        boolean          NOT NULL,
  suspect     boolean          NOT NULL,
  derived     boolean          NOT NULL,
  message_id  uuid             NOT NULL,
  updated_at  timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, quantity)
);

CREATE INDEX last_values_tenant_idx ON last_values (tenant_id, device_id);
