# STATUS

Atualizado em 22/10/2026, ao fim da T1-vazão.

## T1-vazão (22/10)

### Resultado

| Prova                                                                     | Antes                             | Depois                                                                    |
| ------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| Rajada de 10.000 mensagens, 20 publicadores (`test/load/mqtt-accounting`) | 8.912 perdidas                    | 0 perdidas (10.000 gravadas, 0 descartes no broker)                       |
| Queda do core-api no meio de 6.000 mensagens (`test/load/mqtt-failures`)  | 3.438 perdidas                    | 0 perdidas                                                                |
| Queda do banco por 4 s no meio de 6.000 mensagens                         | 4.897 perdidas e o processo caía  | 0 perdidas; 214 a 672 mensagens contadas como pendentes e gravadas depois |
| 1.000 msg/s por 60 s, 20 publicadores (`pnpm test:load`)                  | 681 msg/s, p50 12,0 s, p95 26,1 s | 999 msg/s, p50 6 ms, p95 8 ms, máximo 103 a 109 ms (duas rodadas)         |
| Capacidade medida a 3.000 msg/s por 20 s                                  | sem medida                        | 2.930 msg/s, p95 333 ms                                                   |
| Lote HTTP de 5.000 com 3 inválidas                                        | 4.997 gravadas                    | 4.997 gravadas, reenvio sem duplicar                                      |

`pnpm bench:ingestion` contra o compose:

| Cenário                                     | Antes (T1a-ajustes)               | Depois                     |
| ------------------------------------------- | --------------------------------- | -------------------------- |
| MQTT sem controle de vazão, 3.000 mensagens | 1.934 perdidas                    | 0 perdidas                 |
| MQTT com janela de 500, 8 publicadores      | 664 a 686 msg/s, p95 2 ms         | 3.155 msg/s, p95 12 ms     |
| HTTP, lotes de 500, 4 em paralelo           | 26 a 27 mil msg/s, p95 87 a 96 ms | 22,8 mil msg/s, p95 126 ms |

Máquina: AMD Ryzen AI 7 PRO 350 (16 núcleos lógicos), 27 GB, Fedora 44, Node 22.23.1; broker, banco e Redis do compose na mesma máquina. O HTTP ficou um pouco mais lento porque também passa pela janela da gravação em grupo (até 5 ms).

O que ainda limita a vazão: conexões MQTT × latência por mensagem (o mqtt.js processa uma mensagem por vez em cada conexão, e cada uma espera a janela de gravação). Com 32 conexões o teto medido fica perto de 3.000 msg/s; acima disso, mais conexões, uma janela menor ou réplicas (T6).

### Mudanças (ADR-017)

1. Fila do broker por sessão limitada em 512 MB, em vez de 1.000 mensagens; persistência gravada a cada 60 s.
2. Falha transitória deixa a mensagem pendente e força a reentrega pela sessão persistente.
3. Erro de conexão do `pg.Pool` registrado em vez de derrubar o processo.
4. 32 conexões em assinatura compartilhada, cada uma com identificador estável e sessão persistente.
5. Gravação em grupo (2.000 linhas ou 5 ms) e Redis com auto pipelining.
6. `ingestao_mensagens_total{origem, desfecho}` em `GET /metrics`.

O volume do Mosquitto do compose de desenvolvimento foi recriado: guardava sessões órfãs dos benchmarks anteriores, que com o limite novo acumulariam cópias de toda a telemetria.

### Dívidas da T1-vazão

- Reduzir `MQTT_INGEST_CONNECTIONS` ou trocar `MQTT_INGEST_CLIENT_ID` deixa sessões órfãs no grupo, com mensagens presas. É preciso um procedimento (drenar e apagar as sessões excedentes) antes da T6.
- Acima de 512 MB de fila por sessão o broker volta a descartar; falta alertar no contador `$SYS/broker/publish/messages/dropped` (RF-OBS-05).
- A persistência do Mosquitto é gravada a cada 60 s: uma queda do próprio broker ainda pode perder até 60 s de mensagens enfileiradas.
- Durante uma queda longa do banco, cada conexão reconecta a cada 2 s (`MQTT_INGEST_RETRY_MS`) e reprocessa o que estava em trânsito; não há espera crescente.
- O teste de 60 s (`pnpm test:load`) não roda no CI, por depender da máquina; os testes de contabilidade rodam no `pnpm test`.
- `/metrics` não tem autenticação (T3).

### Diagnóstico (antes de qualquer correção)

Teste `apps/core-api/test/load/mqtt-accounting.int.spec.ts`, 20 publicadores, 10.000 mensagens QoS 1:

| Medida                                 | Valor                                    |
| -------------------------------------- | ---------------------------------------- |
| Confirmadas pelo broker (PUBACK)       | 10.000 em 315 ms (cerca de 31.700 msg/s) |
| Gravadas em `measurements`             | 1.088                                    |
| Em `dead_letters`                      | 0                                        |
| Faltando                               | 8.912                                    |
| `$SYS/broker/publish/messages/dropped` | 8.912                                    |

Hipóteses, uma de cada vez:

| Hipótese                                                  | Medição                                                                                                                     | Resultado                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Broker descarta na fila do assinante                      | contador `dropped` igual ao que falta; limites padrão `max_queued_messages 1000`, `max_inflight_messages 20`                | **Causa raiz**                                          |
| Sessão limpa ou identificador variável                    | `clientId` fixo, `clean: false`, MQTT 3.1.1; o log do broker mostrou a fila mantida para a sessão parada                    | Descartada                                              |
| Assinatura sem QoS 1                                      | SUBACK concede QoS 1 nos três tópicos                                                                                       | Descartada                                              |
| Confirmação antes do pipeline, ou concorrência sem limite | no mqtt.js o PUBACK sai no retorno do `handleMessage` e o próximo pacote só é lido depois: um por vez, cerca de 680 msg/s   | Limita a vazão; não perde                               |
| Pool esgotado ou erro engolido                            | o `done(erro)` do `handleMessage` é ignorado pelo mqtt.js: sem PUBACK, sem reentrega até reconectar, sem DLQ e sem contador | **Causa associada** (perda quando a janela de 20 enche) |

Detalhes e decisão no ADR-017.

## Portão atual: G1 · Ingestão (completo)

| Prova do G1                                                                                                  | Situação                                         |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| O simulador publica por MQTT, HTTP e lote, e a medição aparece em `GET /api/v1/dispositivos/{id}/telemetria` | Passa contra o catálogo real (seed + API)        |
| Duplicata descartada                                                                                         | Passa (HTTP responde `duplicada`; testes 3 e 13) |
| Mensagem inválida na DLQ                                                                                     | Passa (`dead_letters`, com o motivo)             |
| Catálogo e dispositivos criados por API                                                                      | Passa (testes 4 a 8)                             |

### Como reproduzir

```
docker compose up -d
pnpm seed:dev                                   # migrações, catálogo e SIM_DEVICE_TOKEN no .env
pnpm --filter @iot/core-api start:dev           # em outro terminal
pnpm --filter @iot/simulators basic-publisher --modo mqtt --n 3 --passo=-5
pnpm --filter @iot/simulators basic-publisher --modo http --n 2
pnpm --filter @iot/simulators basic-publisher --modo lote --n 4 --invalidas 1
curl -H 'X-Tenant: defesa-civil' localhost:3001/api/v1/dispositivos/<id>/telemetria
```

## T1b (22/10)

### O que passa

- `pnpm test`: 321 testes (domain 158, core-api 98, contracts 59, simulators 4, edge-node 1, panel 1). `pnpm lint`, `pnpm typecheck` e `pnpm contracts:validate` (40 verificações) sem erro. O CI simulado num clone limpo passa, com o cliente do Prisma gerado no `postinstall`.
- Testes do handoff: 1 a 3 no domínio (`test/devices`, `test/catalog`); 4, 5, 7 e 8 em `apps/core-api/test/catalog/catalog.int.spec.ts`; 6 e 10 em `test/ingestion.int.spec.ts`; 9 em `test/devices/device-status.int.spec.ts`.
- Cobertura dos módulos novos do domínio: `catalog` 97,8% de linhas e 97,3% de ramos; `devices` 100%. Limite de 90% configurado. core-api: 95% de linhas e 81% de ramos.
- Prova do G1 contra o compose: MQTT, HTTP (202) e lote com uma recusada; a mesma mensagem enviada duas vezes responde `aceita` e depois `duplicada`; a série devolve a derivada calculada; sem `X-Tenant`, 401; o dispositivo passou a ONLINE com o último contato da medição.

### Decisões da T1b

| Decisão                                                                                                                                                                        | Registro                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| Contrato do catálogo (OpenAPI 1.2.0), `X-Tenant` provisório, token `<id>.<segredo>` com scrypt e sal, `ST_Covers`                                                              | ADR-014                          |
| Prisma 7 com o SQL do catálogo gerado em `migrations/sql/0002`, geometrias e GIST à mão na `0003`, um só executor de migrações e chaves compostas por inquilino                | ADR-015                          |
| Estado por consumidor e varredura, volta a ONLINE também publicada, 401 sem inquilino, Jest com `--experimental-vm-modules`, `@Inject` explícito e seed como pacote de cenário | ADR-016                          |
| Corpo das requisições validado contra os esquemas do OpenAPI, com as mensagens em português da ingestão                                                                        | `catalog/request-validator.ts`   |
| Inquilinos criados fora da API (seed ou administrador); não há rota de inquilino no MVP                                                                                        | `config/scenarios/dev-seed.json` |

### Defeitos achados e corrigidos na T1b

- O `tsx` (start:dev e seed) não emite metadados de decorator: o `CatalogEvents` chegava `undefined` e o `POST /sites` respondia 500, enquanto o Jest passava. Teste que sobe o app pelo `tsx` e correção com `@Inject` explícito.
- O seed tinha termos de cenário em `apps/core-api/src`; o teste de núcleo neutro acusou, e os dados foram para `config/scenarios/dev-seed.json`.

### Dívidas

- O site declarado por um nó de borda ainda não é conferido contra o dispositivo, e a credencial de nó de borda não existe no catálogo (T2).
- Isolamento só na aplicação (filtro por `tenant_id` e chaves compostas); row level security no PostgreSQL fica para a T3, junto com a claim do token no lugar do `X-Tenant`.
- O broker MQTT continua com o arquivo de senhas de desenvolvimento; credencial por dispositivo no broker e ACL na T3.
- A varredura de estado carrega todos os dispositivos ONLINE a cada passada; precisa de janela ou índice parcial antes de escalar.
- O consumidor de estado lê só o stream `measurement.ingested`; evento e estado do dispositivo sem medidas não contam como contato.
- O teste de mutação ainda cobre só `src/ingestion`; os módulos `catalog` e `devices` do domínio entram no Stryker numa próxima rodada.
- Dois casos de teste nasceram verdes, depois da implementação, e foram conferidos por mutação: dado atrasado em dispositivo SEM_SINAL e a troca de `ST_Covers` por `ST_Contains`.
- Continuam da T1a-ajustes: perda MQTT sob rajada e vazão abaixo do RNF-01; sessão persistente do core-api acumulando fila no broker.

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
