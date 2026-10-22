# Contratos abertos v1.0

Qualquer linguagem que fale MQTT ou HTTP e monte um JSON consegue integrar com a plataforma, sem biblioteca própria (RF-INT-01, RNF-13).

| Arquivo                                 | Formato             | O que descreve                                                                                          |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| `canonical-message.v1.schema.json`      | JSON Schema 2020-12 | Mensagem canônica: telemetria, evento, estado e comando                                                 |
| `batch.v1.schema.json`                  | JSON Schema 2020-12 | Lote de mensagens canônicas (`POST /ingestao/lote` e sincronização da borda)                            |
| `asyncapi.yaml`                         | AsyncAPI 3.1        | Tópicos MQTT, sentido de cada operação e carga de cada mensagem                                         |
| `openapi.yaml`                          | OpenAPI 3.1         | Esqueleto da API REST `/api/v1`                                                                         |
| `examples/valid/` e `examples/invalid/` | JSON                | Exemplos aceitos e rejeitados; o erro esperado de cada inválido está em `examples/expected-errors.json` |

## Regras principais da mensagem canônica

- `versao` é `"1.0"`; uma versão desconhecida é rejeitada.
- `id_mensagem` é um UUID gerado na origem e serve para descartar duplicatas.
- `timestamp` é o horário da medição em UTC e termina em `Z` (por exemplo, `2026-10-20T21:10:00Z`).
- `local.geo` é GeoJSON (Point, LineString ou Polygon), na ordem longitude, latitude.
- `medidas` traz `grandeza`, `valor` numérico e `unidade` em código UCUM (`cm`, `mV`, `Cel`, `%`).
- Por tipo: `telemetria` exige ao menos uma medida, `evento` exige `evento.codigo`, `estado` exige o objeto `estado` e `comando` exige `comando.nome`.
- Campos fora do contrato são rejeitados; um campo novo exige uma versão nova do contrato.

## Versionamento

Versionamento semântico. Mudança compatível (campo opcional novo) gera versão MINOR, com um schema novo ao lado do anterior; quebra só em versão MAJOR, com um arquivo `*.v2.schema.json`. Toda mudança vem com exemplos válidos e inválidos atualizados.

## Como validar

```
pnpm contracts:validate
```

O comando confere todos os exemplos contra os schemas e valida o AsyncAPI e o OpenAPI com os parsers oficiais (`@asyncapi/parser` e `@readme/openapi-parser`).
