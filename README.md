# Plataforma IoT Integrada

Plataforma IoT que integra projetos urbanos e rurais por contrato aberto, em camadas, com nó de borda para locais sem conexão estável. Trabalho da disciplina de Internet das Coisas (UniEVANGÉLICA).

- Requisitos e arquitetura: [`docs/PRD.md`](docs/PRD.md)
- Calendário e portões: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Contratos (JSON Schema, AsyncAPI e OpenAPI): [`docs/contracts/`](docs/contracts/)
- Decisões de arquitetura: [`docs/adr/`](docs/adr/)
- Estado atual: [`docs/STATUS.md`](docs/STATUS.md)

## Pré-requisitos

- Node.js 22.12 ou mais novo (`.nvmrc`)
- pnpm 10 (`npm install -g pnpm@10` ou `corepack enable`)
- Docker com Compose v2

## Subir do zero

```
git clone <url-do-repositório> plataforma-iot
cd plataforma-iot
pnpm install
cp .env.example .env        # valores de desenvolvimento; troque as senhas fora da máquina local
docker compose up -d        # PostgreSQL (TimescaleDB e PostGIS), Redis, Mosquitto, Keycloak e Mailpit
pnpm test:infra             # confere healthchecks, extensões, MQTT e o realm iot
```

Serviços em desenvolvimento (portas configuráveis no `.env`):

| Serviço          | Endereço                                                                 |
| ---------------- | ------------------------------------------------------------------------ |
| PostgreSQL       | `localhost:5432`                                                         |
| Redis            | `localhost:6379`                                                         |
| Mosquitto (MQTT) | `localhost:1883`                                                         |
| Keycloak         | http://localhost:8080 (console de administração com o usuário do `.env`) |
| Mailpit          | SMTP em `localhost:1025`, interface em http://localhost:8025             |

Para derrubar tudo e apagar os volumes: `docker compose down -v`.

## Comandos

| Comando                   | O que faz                                            |
| ------------------------- | ---------------------------------------------------- |
| `pnpm test`               | Testes de todos os pacotes                           |
| `pnpm test:cov`           | Testes com cobertura                                 |
| `pnpm lint`               | ESLint e checagem do Prettier                        |
| `pnpm format`             | Formata o código com o Prettier                      |
| `pnpm typecheck`          | Checagem de tipos de todos os pacotes                |
| `pnpm contracts:validate` | Valida schemas, exemplos, AsyncAPI e OpenAPI         |
| `pnpm test:infra`         | Sobe o compose e roda o smoke test da infraestrutura |

## Estrutura

```
apps/core-api       API central (NestJS, monólito modular)
apps/edge-node      Nó de borda (NestJS reduzido)
apps/panel          Painel web (Next.js)
apps/simulators     Simuladores de dispositivos
packages/domain     Núcleo de domínio puro, compartilhado entre central e borda
packages/contracts  Validação dos contratos abertos
config/scenarios/   Pacotes de cenário (configuração)
migrations/sql/     SQL versionado (TimescaleDB, PostGIS e RLS)
infra/              Configuração do Mosquitto e realm do Keycloak
scripts/            Smoke test da infraestrutura
docs/               PRD, ROADMAP, contratos, ADRs e STATUS
```
