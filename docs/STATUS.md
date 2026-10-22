# STATUS

Atualizado em 22/10/2026, ao fim da trilha T0.

## Portão atual: M0 · Fundação

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
