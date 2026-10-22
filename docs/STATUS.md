# STATUS

Atualizado em 22/10/2026, ao fim da T1a-ajustes.

## Portão atual: G1 · Ingestão (parte da T1a pronta; a T1b fecha o portão)

| Prova do G1 (parte da T1a)                                                                                   | Situação                                          |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| O simulador publica por MQTT, HTTP e lote, e a medição aparece em `GET /api/v1/dispositivos/{id}/telemetria` | Passa com o compose de pé (ver "Como reproduzir") |
| Duplicata descartada                                                                                         | Passa (testes 3 e 13)                             |
| Mensagem inválida na DLQ                                                                                     | Passa (`dead_letters`, testes 2, 12, 14 e 16)     |
| Catálogo e dispositivos criados por API                                                                      | Falta: T1b                                        |

## T1a-ajustes (22/10)

### O que passa

- `pnpm test`: 249 testes (domain 138, core-api 56, contracts 49, simulators 4, edge-node 1, panel 1). `pnpm lint`, `pnpm typecheck` e `pnpm contracts:validate` (30 verificações) sem erro.
- Cobertura de `packages/domain/src/ingestion`: 100% de linhas e funções e 98% de ramos. core-api: 97% de linhas e 90% de ramos.
- CI simulado num clone limpo do `main` (sem `.env`, como no runner): lint, typecheck, `test:cov` e `contracts:validate` passam.

### Teste de mutação (`pnpm test:mutation`, ADR-013)

| Arquivo                      | Linha de base                                  | Final                                                         |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `steps/authenticate.step.ts` | 80,33%                                         | 100%                                                          |
| `steps/dead-letter.step.ts`  | 80,00%                                         | 100%                                                          |
| `steps/deduplicate.step.ts`  | 72,73%                                         | 100%                                                          |
| `steps/enrich.step.ts`       | 76,92%                                         | 100%                                                          |
| `steps/order.step.ts`        | 75,00%                                         | 100%                                                          |
| `steps/publish.step.ts`      | 72,00%                                         | 100%                                                          |
| `steps/step.ts`              | 68,75%                                         | 100%                                                          |
| `steps/validate.step.ts`     | 87,50%                                         | 100%                                                          |
| `expression.ts`              | 83,67%                                         | 100%                                                          |
| `pipeline.ts`                | 44,74%                                         | 100%                                                          |
| `units.ts`                   | 78,57%                                         | 100%                                                          |
| **Ingestão**                 | **76,81%** (95 sobreviventes, 1 sem cobertura) | **100%** (392 mortos, 12 por tempo esgotado, 0 sobreviventes) |

A nota final desconta 5 mutantes equivalentes marcados no código com `Stryker disable` e o motivo (laço de espaços, `Number.isFinite(null)`, campo de corpo que não é objeto e as duas dimensões de unidade única). Sem essas marcações, a nota seria 98,8%. Mais 318 mutantes não compilam e são descartados pelo verificador de tipos. O ciclo dos logs achou um defeito: no HTTP, o registro "mensagem recebida" dizia `principal: broker` (corrigido com `fix(RF-OBS-02)`).

### Linha de base de desempenho (`pnpm bench:ingestion`)

Máquina: AMD Ryzen AI 7 PRO 350 (16 núcleos lógicos), 27 GB de RAM, Fedora 44 (Linux 7.2.11), Node 22.23.1, infraestrutura do `compose.yaml` na mesma máquina, core-api no mesmo processo do benchmark, log em `warn`. Latência: do recebimento no core-api até o evento `measurement.ingested` no Redis, que só sai depois da gravação.

| Cenário                                               | Mensagens | Vazão                              | Latência p50 | p95        | Máx.         |
| ----------------------------------------------------- | --------- | ---------------------------------- | ------------ | ---------- | ------------ |
| MQTT QoS 1, 8 publicadores, no máximo 500 em trânsito | 5.000     | 664 a 686 msg/s                    | 1 ms         | 2 ms       | 20 a 33 ms   |
| HTTP, lotes de 500, 4 em paralelo                     | 10.000    | 26 a 27 mil msg/s                  | 38 a 40 ms   | 87 a 96 ms | 108 a 113 ms |
| MQTT QoS 1, 8 publicadores, sem controle de vazão     | 3.000     | 1.066 gravadas, **1.934 perdidas** |              |            |              |

**Perda de mensagens MQTT sob rajada (fere o RNF-10).** O Mosquitto guarda no máximo 1.000 mensagens QoS 1 na fila de cada assinante (`max_queued_messages`, padrão) e descarta o excesso ("Outgoing messages are being dropped" no log do broker). O assinante do core-api é único, processa uma mensagem por vez e só confirma (PUBACK) depois do pipeline, a cerca de 1,5 ms por mensagem; os publicadores entregam bem mais rápido que isso, a fila enche e o broker descarta. A vazão sustentável (664 msg/s) fica acima de 300 msg/s, mas abaixo da meta de 1.000 msg/s do RNF-01. Proposta, sem aplicar:

1. Aumentar `max_queued_messages` e limitar por bytes (`max_queued_bytes`) no Mosquitto, para absorver rajadas sem descarte silencioso.
2. Processar as mensagens MQTT em lote no core-api: acumular até N mensagens ou T ms e passar ao pipeline como lote, com uma gravação, um MGET e um XADD em pipeline, confirmando o PUBACK de cada uma depois da gravação do lote.
3. Assinatura compartilhada do MQTT 5 (`$share/core-api/...`) com réplicas do core-api (RNF-09).
4. Monitorar descarte no broker (`$SYS/broker/messages/dropped`) e alarmar (RF-OBS-05).

### Decisões da T1a-ajustes

| Decisão                                                                                                                                         | Registro                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `ResultadoMensagem` com `indice` e `id_mensagem` anulável; OpenAPI 1.1.0; exemplos de resposta validados contra o OpenAPI                       | ADR-012                    |
| Stryker 10 no domínio, modo `inPlace` e plugins declarados por causa do pnpm                                                                    | ADR-013                    |
| Erros do body-parser (JSON inválido 400, corpo grande demais 413) tratados por um middleware do Express antes do Nest, que perde o tipo do erro | `src/http/error.filter.ts` |
| Filtro global: toda resposta de erro no esquema `Erro`; rota inexistente vira `nao_encontrado`; erro interno vira `erro_interno` sem detalhe    | `src/http/error.filter.ts` |
| Payload MQTT que não é JSON vai à DLQ cortado em 2 KB, sem partir caractere UTF-8                                                               | `MqttIngestionSubscriber`  |
| Um pino para o app inteiro, com um registro por requisição HTTP com `id_mensagem` ou `id_lote`                                                  | `src/logging/`             |
| Ryuk privilegiado só pela variável `TESTCONTAINERS_RYUK_PRIVILEGED` do `.env`; o setup dos testes copia só variáveis `TESTCONTAINERS_*`         | README, ADR-010            |
| Pasta vazia do fixture `sem-expectativa/valid` versionada com `.gitkeep`: era a causa da falha do CI no GitHub em `0378344`                     | `fix(RF-INT-01)`           |

### Dívidas que sobraram

- Perda MQTT sob rajada e vazão sustentável de 664 msg/s, abaixo do RNF-01 (proposta acima).
- A sessão MQTT persistente `core-api-ingestao` (`clean: false`) acumula fila no broker enquanto o core-api está parado; ao subir, ele processa esse acúmulo, inclusive mensagens de benchmark.
- O commit `fix(RF-OBS-02)` do principal deixou um import sem uso, corrigido logo depois em `refactor(RF-OBS-02)`; nesse intervalo o lint falhava.
- Dois testes da T1a-ajustes não nasceram vermelhos: o do erro 500 (o ramo foi escrito junto com o filtro) e os que matam mutantes (o vermelho é o relatório do Stryker com o mutante vivo).
- O workflow manual de mutação ainda não rodou no GitHub.

## T1a (22/10)

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

- Resolvida na T1a-ajustes: `ResultadoMensagem` com `indice` e `id_mensagem` anulável (ADR-012).
- Resolvida na T1a-ajustes: corpo que não é JSON responde 400 no esquema `Erro` (continua fora da DLQ, que guarda só mensagens).
- Resolvida na T1a-ajustes: o NestJS inteiro loga em JSON pelo pino.
- Assinante MQTT único com `clientId` fixo; réplicas (RNF-09) pedem assinatura compartilhada do MQTT 5.
- Eventos e estados são publicados no barramento, mas não são gravados em tabela (T1c e T1d).
- Último estado no Redis fica para a T1c, como previsto.
- Os testes de integração baixam a imagem do TimescaleDB no CI, o que deixa o pipeline mais lento.
- O remoto `SGKolibri/iot-alagamento` existe; o CI rodou em `0378344` e falhou no `contracts` (pasta vazia não versionada), corrigido na T1a-ajustes. O `main` local está à frente do remoto, sem push.

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
