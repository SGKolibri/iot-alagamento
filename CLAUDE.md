# CLAUDE.md: Plataforma IoT Integrada

## Projeto

Plataforma IoT básica que integra projetos urbanos e rurais por contrato aberto, em camadas, com nó de borda para locais sem conexão estável. É o trabalho da disciplina de Internet das Coisas (UniEVANGÉLICA), com entrega em 30/11/2026. Uma pessoa desenvolve, com o Claude Code implementando.

Documentos de referência (leia antes de implementar qualquer tarefa):

- `docs/PRD.md`: PRD v2. Seção 7 (contratos), 8 (requisitos RF), 9 (requisitos RNF), 10 (decisões de arquitetura), 11 (modelo de dados e pipeline) e 12 (motor de regras).
- `docs/ROADMAP.md`: calendário, portões, trilhas T0 a T6 e a escada de corte.
- `docs/contracts/`: JSON Schema canônico, AsyncAPI e OpenAPI.
- `docs/adr/`: registros de decisão de arquitetura.
- `docs/STATUS.md`: estado atual (portão, o que passa, o que falta, dívidas).

## Stack

- Monorepo pnpm: `apps/core-api` (NestJS, monólito modular), `apps/edge-node` (NestJS reduzido), `apps/panel` (Next.js), `apps/simulators`, `packages/domain` (núcleo puro, compartilhado entre central e borda) e `packages/contracts`.
- PostgreSQL com TimescaleDB e PostGIS. O Prisma cuida só do catálogo; hipertabelas, agregados e geometrias ficam em SQL versionado em `migrations/sql/`.
- Redis para último estado, deduplicação e barramento interno (Streams e pub/sub). Mosquitto como broker MQTT. Keycloak para identidade. Traefik para TLS e roteamento (T3). Docker Compose.
- Testes: Jest, Testcontainers, Supertest e k6; no painel, Testing Library, Playwright e axe.

## Regras invioláveis

1. **TDD.** Nenhum comportamento entra sem um teste vermelho antes, mostrado na saída do terminal. Depois verde, depois refatoração.
2. **Arquitetura hexagonal.** `packages/domain` não importa NestJS, Prisma, Redis, MQTT, SQLite nem Next.js. Toda entrada e saída passa por portas (interfaces) com adaptadores, e o relógio é uma porta injetável (`ClockPort`).
3. **Núcleo neutro.** Nenhum termo de cenário (alagamento, córrego, talhão, silo, fazenda) em `packages/domain` nem em `apps/core-api/src`. Cenários são configuração, em `config/scenarios/`. Um teste varre o código do núcleo procurando esses termos.
4. **Contrato primeiro.** Schemas, AsyncAPI e OpenAPI mudam antes do código, com exemplos válidos e inválidos atualizados e testes de contrato. Versionamento semântico, e quebra só em versão MAJOR.
5. **Mudanças aditivas.** Não refatore o que já passou em um portão sem pedido explícito no handoff. Módulos novos entram ao lado dos existentes.
6. **Isolamento por inquilino.** `tenant_id` em toda tabela e consulta, com row level security. Segredos só por variáveis de ambiente, nunca no repositório.
7. **Idempotência.** Toda mensagem tem `id_mensagem`. Reprocessar a mesma mensagem não duplica nada.
8. **Tempo.** A ordenação usa o horário da medição (`timestamp`). O horário de chegada fica em campo separado.

## Convenções

- Identificadores de código em inglês. Os campos do contrato canônico ficam em português, exatamente como no contrato (`versao`, `id_mensagem`, `dispositivo`, `tipo`, `timestamp`, `via`, `local`, `medidas`), com conversão nos adaptadores de borda.
- Commits em português, pequenos, com o ID do requisito: `feat(RF-ING-08): descarta duplicata por id_mensagem`. Tipos: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`.
- Textos em português (documentação, README, mensagens de interface): sem travessão, e sem construções do tipo "não é A, e sim B".
- Cobertura: 70% no núcleo é o mínimo do professor (RNF-15); a meta interna é 80%, e 100% dos ramos do motor de regras.
- Dependência nova e relevante: registre uma linha em `docs/adr/` com o motivo.
- Lint e formatação com ESLint e Prettier; o CI precisa passar antes de cada commit.

## Comandos

Comandos implementados na T0 (Node 22.12+, pnpm 10, Docker com Compose v2):

```
pnpm install
pnpm test               # testes de todos os pacotes (Jest)
pnpm test:cov           # com cobertura; mínimo de 70% em domain, contracts, core-api e edge-node
pnpm lint               # ESLint e prettier --check
pnpm format             # prettier --write
pnpm typecheck          # tsc em scripts/ e em todos os pacotes
pnpm contracts:validate # schemas, exemplos válidos e inválidos, AsyncAPI e OpenAPI
pnpm test:infra         # sobe o compose e roda o smoke test (requer .env)
cp .env.example .env    # variáveis de desenvolvimento, antes da primeira subida
docker compose up -d    # sobe a infraestrutura central
docker compose down -v  # derruba e apaga os volumes
pnpm --filter @iot/<pacote> test   # testes de um pacote só
pnpm test:mutation       # Stryker na ingestão do domínio (mínimo de 85%; relatório em packages/domain/reports/mutation)
pnpm test:load           # 1.000 msg/s por 60 s com p95 até 2 s (Testcontainers; fora do CI)
pnpm bench:ingestion     # linha de base de desempenho com a infraestrutura local de pé (MQTT e lotes HTTP)
pnpm seed:dev            # aplica config/scenarios/dev-seed.json pela API e grava SIM_DEVICE_TOKEN no .env
pnpm --filter @iot/core-api db:migrate          # aplica migrations/sql no PostgreSQL do .env
pnpm --filter @iot/simulators basic-publisher --modo mqtt|http|lote --n 10   # publica mensagens de teste (negativos: --passo=-5)
```

## Ciclo de trabalho

1. Cada tarefa chega por um handoff com Contexto, Requisitos, Teste primeiro, Pode alterar, Não pode alterar, Pronto quando e Ao terminar.
2. Mostre o teste falhando antes de implementar, depois implemente o mínimo até ficar verde e só então refatore.
3. Ao terminar, atualize `docs/STATUS.md` com o portão atual, o que passa, o que falta, decisões tomadas e dívidas.
4. Quando algo falhar, mostre o sintoma exato e diagnostique a causa raiz antes de propor qualquer correção. O teste que reproduz o defeito entra primeiro.
5. Dúvida de escopo: pergunte antes. Não invente requisito; consulte a seção correspondente do `docs/PRD.md`.
6. Se a tarefa estourar o tempo estimado do handoff em mais de 25%, pare e reporte o que falta e por quê.
7. Um comportamento por ciclo. O histórico do git mostra, para cada comportamento, um commit `test(...)` com o teste vermelho e, depois, o commit `feat(...)` ou `fix(...)` que o deixa verde. Refatorações vão em commits `refactor(...)` com os testes verdes.
