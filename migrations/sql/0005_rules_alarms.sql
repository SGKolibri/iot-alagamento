-- 0005: regras de processamento, estado do motor, alarmes e linha do tempo (T1d, ADR-021).
-- SQL escrito à mão, como o 0004: o Prisma fica com o catálogo (ADR-015) e estas tabelas são
-- lidas e gravadas pelo motor numa transação só (estado do par, alarme e eventos).
CREATE TABLE rules (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants (id),
  name        text        NOT NULL,
  scope       text        NOT NULL CHECK (scope IN ('central', 'borda')),
  active      boolean     NOT NULL,
  version     integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- condicao e acoes no formato do contrato rule.v1 (ADR-020).
  condition   jsonb       NOT NULL,
  actions     jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
CREATE INDEX rules_tenant_idx ON rules (tenant_id, scope, active);

-- Estado do par regra e dispositivo (sequências de entrada e saída, janela da taxa, último
-- ponto processado) e da ausência. Sobrevive a reinício do core-api.
CREATE TABLE rule_states (
  tenant_id   uuid        NOT NULL,
  rule_id     uuid        NOT NULL,
  device_id   uuid        NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  state       jsonb,
  absence     jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, device_id),
  FOREIGN KEY (rule_id, tenant_id) REFERENCES rules (id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE alarms (
  id                uuid        PRIMARY KEY,
  tenant_id         uuid        NOT NULL,
  rule_id           uuid        NOT NULL,
  rule_version      integer     NOT NULL,
  device_id         uuid        NOT NULL REFERENCES devices (id),
  severity          text        NOT NULL CHECK (severity IN ('baixa', 'media', 'alta', 'critica')),
  state             text        NOT NULL CHECK (state IN ('ATIVO', 'RECONHECIDO', 'RESOLVIDO')),
  -- occurred_at é o horário da medição; opened_at, o da abertura pela plataforma.
  occurred_at       timestamptz NOT NULL,
  opened_at         timestamptz NOT NULL,
  acknowledged_at   timestamptz,
  acknowledged_by   text,
  acknowledge_note  text,
  resolved_at       timestamptz,
  resolved_by       text,
  resolve_reason    text,
  resolution        text        CHECK (resolution IN ('manual', 'automatica')),
  FOREIGN KEY (rule_id, tenant_id) REFERENCES rules (id, tenant_id)
);
-- No máximo um alarme aberto por par regra e dispositivo (RF-PRO-05).
CREATE UNIQUE INDEX alarms_one_open_idx ON alarms (rule_id, device_id) WHERE state <> 'RESOLVIDO';
CREATE INDEX alarms_tenant_idx ON alarms (tenant_id, state, opened_at DESC);

CREATE TABLE alarm_events (
  id           bigserial   PRIMARY KEY,
  tenant_id    uuid        NOT NULL,
  alarm_id     uuid        NOT NULL REFERENCES alarms (id) ON DELETE CASCADE,
  type         text        NOT NULL CHECK (type IN ('aberto', 'reconhecido', 'resolvido')),
  at           timestamptz NOT NULL,
  measured_at  timestamptz,
  actor        text,
  note         text,
  reason       text
);
CREATE INDEX alarm_events_alarm_idx ON alarm_events (alarm_id, id);
