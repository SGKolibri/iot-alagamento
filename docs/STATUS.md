# STATUS

Atualizado em 22/10/2026, ao fim da subtrilha T1a.

## Portão atual: G1 · Ingestão (parte da T1a pronta; a T1b fecha o portão)

| Prova do G1 (parte da T1a)                                                                                   | Situação                                          |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| O simulador publica por MQTT, HTTP e lote, e a medição aparece em `GET /api/v1/dispositivos/{id}/telemetria` | Passa com o compose de pé (ver "Como reproduzir") |
| Duplicata descartada                                                                                         | Passa (testes 3 e 13)                             |
| Mensagem inválida na DLQ                                                                                     | Passa (`dead_letters`, testes 2, 12, 14 e 16)     |
| Catálogo e dispositivos criados por API                                                                      | Falta: T1b                                        |

### O que passa

- `pnpm test`: 172 testes (domain 89, contracts 40, core-api 37, simulators 4, edge-node 1, panel 1). Os testes de integração 10 a 16 rodam com Testcontainers (PostgreSQL com TimescaleDB, Redis e Mosquitto) dentro do `pnpm test` e pedem Docker.
- Cobertura de `packages/domain/src/ingestion`: 99% de linhas, 96% de ramos e 100% de funções (limite de 90% configurado no Jest). core-api: 96% de linhas e 87% de ramos.
- `pnpm lint`, `pnpm typecheck` e `pnpm contracts:validate` sem erro. Os contratos não mudaram.
- Testes do handoff: 1 a 9 e 17 no domínio (`packages/domain/test/ingestion/`), 10 a 16 em `apps/core-api/test/ingestion.int.spec.ts`.
- Regras críticas conferidas por mutação: com cada regra desligada no código (divergência entre tópico e corpo, credencial, lote recusado inteiro, duplicata no lote, ordem, limite de atraso, derivada, ruído de ponto flutuante, correlação no log), algum teste fica vermelho.

### Como reproduzir a prova do portão

```
docker compose up -d
pnpm --filter @iot/core-api db:migrate
pnpm --filter @iot/core-api start:dev          # em outro terminal
pnpm --filter @iot/simulators basic-publisher --modo mqtt --n 3 --passo=-5
pnpm --filter @iot/simulators basic-publisher --modo http --n 2
pnpm --filter @iot/simulators basic-publisher --modo lote --n 4 --invalidas 1
curl localhost:3001/api/v1/dispositivos/8a7b6c5d-4e3f-4a2b-9c1d-0e1f2a3b4c01/telemetria
```

A mensagem da posição 1 do lote aparece em `dead_letters` com o motivo `campo obrigatório ausente: versao`. Valores negativos no simulador usam a forma `--passo=-5`.

### Decisões da T1a

| Decisão                                                                                                                                                                      | Registro                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `pg`, `ioredis`, `mqtt`, `pino` e `testcontainers`; pacotes do workspace pelo código-fonte; Ryuk privilegiado por causa do SELinux                                           | ADR-010                                |
| `DeviceDirectoryPort.authenticate`; grandeza, derivada pronta ou unidade inválida recusam a mensagem; `comando` recusado; ordem gravar, publicar, marcar como visto          | ADR-011                                |
| Colunas `late` e `derived` em `measurements`, além do modelo da seção 11 do PRD                                                                                              | `migrations/sql/0001_measurements.sql` |
| `dead_letters.tenant_id` e `message_id` aceitam nulo, porque a mensagem recusada pode não identificar dispositivo nem trazer UUID                                            | `migrations/sql/0001_measurements.sql` |
| Evento `measurement.ingested` por mensagem (com a lista de medições), no stream Redis de mesmo nome; evento e estado viram `device.event.received` e `device.state.reported` | domínio, `RedisStreamsEventBus`        |
| O assinante MQTT só confirma (PUBACK) depois do pipeline, com sessão persistente (`clean: false`)                                                                            | `MqttIngestionSubscriber`              |
| Duplicata responde 202 com `resultado: duplicada` no HTTP                                                                                                                    | `IngestionController`                  |
| Mensagens de erro do Ajv traduzidas para português, com o caminho do campo ausente ou extra                                                                                  | `AjvSchemaValidator`                   |
| Migrações SQL aplicadas por `pnpm --filter @iot/core-api db:migrate`, com controle em `schema_migrations`                                                                    | `sql-migrations.ts`                    |
| Variáveis novas no `.env.example`: `POSTGRES_HOST`, `REDIS_HOST`, `MQTT_HOST`, `CORE_API_PORT`, `LOG_LEVEL`, `SIM_DEVICE_TOKEN` e `SIM_EDGE_TOKEN`. O compose não mudou      | `.env.example`                         |

### Simplificações do adaptador em memória do `DeviceDirectoryPort` (resolver na T1b)

- O cadastro vem de `config/dev/device-directory.json`, carregado na subida; mudar dispositivo exige reiniciar o core-api.
- Credenciais vêm de variáveis de ambiente apontadas no arquivo e são comparadas por hash SHA-256, sem sal, sem revogação e sem validade.
- O `GET /dispositivos/{id}/telemetria` não consulta o cadastro: responde 404 quando o id não é UUID ou quando não há nenhuma medição sem filtro, e não confere inquilino nem papel (T1c e T3).
- O perfil não é versionado, e a expressão derivada só é validada quando a primeira mensagem chega.
- O nó de borda é aceito para qualquer dispositivo do seu inquilino, sem conferir o site do nó nem o campo `origem` do lote.

### Dívidas da T1a

- `ResultadoMensagem` no OpenAPI exige `id_mensagem` como UUID, mas uma mensagem recusada no lote pode vir sem id válido; hoje a resposta devolve `null` e o cliente casa pela posição. Ajustar o contrato com ADR (campo opcional e `indice`).
- Corpo HTTP que não é JSON recebe o 400 padrão do NestJS, fora do esquema `Erro`, e não vai para a DLQ.
- Logs do próprio NestJS continuam no formato texto; só a ingestão usa pino.
- Assinante MQTT único com `clientId` fixo; réplicas (RNF-09) pedem assinatura compartilhada do MQTT 5.
- Eventos e estados são publicados no barramento, mas não são gravados em tabela (T1c e T1d).
- Último estado no Redis fica para a T1c, como previsto.
- Os testes de integração baixam a imagem do TimescaleDB no CI, o que deixa o pipeline mais lento.
- O CI no GitHub ainda não rodou: o repositório continua sem remoto (pendência do M0).

## Histórico: M0 · Fundação

| Prova do M0                                                            | Situação                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `docker compose up -d` sobe a infraestrutura e `pnpm test:infra` passa | Passa (4 de 4 verificações)                                                                                |
| `pnpm test`, `pnpm lint` e `pnpm contracts:validate` passam            | Passam                                                                                                     |
| CI verde no GitHub                                                     | Pendente: o repositório ainda não tem remoto no GitHub. A prova de falha foi feita localmente (ver abaixo) |
| `docs/STATUS.md` registra M0                                           | Este arquivo                                                                                               |

## O que passa

- `pnpm test`: 55 testes em 6 pacotes (domain 12, contracts 40, core-api 1, edge-node 1, panel 1; simulators sem testes).
- `pnpm test:cov`: contracts 98% de linhas e 76% de ramos; core-api, edge-node e panel 100%. O domínio ainda não tem código executável (só a interface `ClockPort`), então a cobertura dele aparece como 0 de 0.
- `pnpm lint` (ESLint e Prettier) e `pnpm typecheck` sem erro.
- `pnpm contracts:validate`: 25 verificações (8 exemplos válidos, 15 inválidos com o erro esperado, AsyncAPI e OpenAPI).
- `pnpm test:infra`: healthchecks dos 5 serviços, `CREATE EXTENSION` de timescaledb 2.31.0 e postgis 3.6.4 (com uma hipertabela e uma geometria de prova), MQTT recusando conexão anônima e entregando publicação QoS 1, e realm `iot` com os cinco papéis e os clients `panel` e `core-api`.
- Teste de arquitetura: `packages/domain` sem framework (dependências e imports) e nenhum termo de cenário em `packages/domain` e `apps/core-api/src`.
- Prova de falha do CI, feita localmente com os mesmos passos do workflow: com `timestamp-sem-z.json` copiado para `examples/valid/`, `pnpm test:cov` falha (2 testes) e `pnpm contracts:validate` falha (1 de 26). A alteração foi revertida.

## O que falta para fechar o M0

1. Criar o repositório no GitHub, adicionar o remoto e enviar o `main`.
2. Confirmar o workflow CI verde e repetir no GitHub a prova de falha (exemplo inválido em `valid/` num pull request).
3. Rodar o workflow manual "Infraestrutura" uma vez.

## Decisões tomadas além do handoff

| Decisão                                                                                                                                                            | Registro                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| NestJS 11 em vez do 12 (ESM puro) e TypeScript 6.0 em vez do 7                                                                                                     | ADR-008                            |
| Ajv, `@asyncapi/parser` e `@readme/openapi-parser`; schemas sem `$id` até existir URL pública                                                                      | ADR-009                            |
| AsyncAPI 3.1.0 (o parser oficial recomenda a 3.1 sobre a 3.0)                                                                                                      | ADR-009                            |
| Os papéis do realm são conferidos pela API de administração do Keycloak, porque a descoberta OpenID não lista papéis                                               | `scripts/test-infra.ts`            |
| Senhas do Redis, do Mosquitto e do client `core-api` só no `.env`; o arquivo de senhas do Mosquitto é gerado na subida                                             | `compose.yaml`, `infra/`           |
| Montagens de arquivo com rótulo SELinux `z` (o host de desenvolvimento usa Fedora)                                                                                 | `compose.yaml`                     |
| `comando` exige `comando.nome` (com `parametros` opcional); `local` é opcional e, quando presente, exige ao menos um campo; campos fora do contrato são rejeitados | `canonical-message.v1.schema.json` |
| Identificadores (`dispositivo`, `via`, `site`, `area`) restritos a letras, dígitos, ponto, hífen e sublinhado, para servirem de segmento de tópico MQTT            | `canonical-message.v1.schema.json` |
| Lote limitado a 5.000 mensagens (o tamanho do teste do RF-ING-03)                                                                                                  | `batch.v1.schema.json`             |
| Endpoint `/health` em core-api e edge-node, usado pelo teste de fumaça e pelos healthchecks futuros (RNF-03)                                                       | `apps/*/src/health.controller.ts`  |
| Lista de termos de cenário em `config/neutrality/scenario-terms.json`                                                                                              | Teste de arquitetura               |

Pontos para revisar no chat de arquitetura: o formato de `comando`, a obrigatoriedade de `local` e o limite de 5.000 mensagens por lote.

## Dívidas

- TLS no MQTT e HTTPS pelo Traefik (trilha T3, RF-ING-01 e RNF-11).
- ACL por dispositivo no Mosquitto e credencial por dispositivo consultando o cadastro (T3 e T1b). Hoje existe um único usuário de desenvolvimento, usado também pelo healthcheck.
- Keycloak em modo de desenvolvimento, com banco embutido: sem segundo fator, sem claim de inquilino e sem usuários de teste (T3).
- Publicar os contratos por URL pública e devolver o `$id` aos schemas (RF-INT-01).
- CodeQL no CI (RNF-15 cita ESLint e CodeQL; só o ESLint está ativo).
- Regras de lint do Next.js e do React no painel (o `eslint-config-next` não foi configurado) e limite de cobertura no painel.
- Migração para NestJS 12 e TypeScript 7 depois da entrega (ADR-008).
- O `CLAUDE.md` cita `docs/ROADMAP.pdf`, mas o arquivo no repositório é `docs/ROADMAP.md`; a referência foi ajustada para o `.md`.
