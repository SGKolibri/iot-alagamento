# Apresentação da Plataforma IoT Integrada (alagamento)

Guia para a apresentação em sala, com o projeto no estado de 22/10/2026 (fim da T1d). São 15 minutos e duas pessoas, chamadas aqui de **Pessoa A** e **Pessoa B**.

Todos os comandos deste guia foram ensaiados na máquina de desenvolvimento contra o compose, na ordem em que aparecem.

## 1. O que está pronto e o que ainda não está

Vale dizer isso logo no começo da apresentação: o professor avalia melhor quem mostra com clareza onde está no cronograma.

| Parte                                                                | Situação                                             | Trilha        |
| -------------------------------------------------------------------- | ---------------------------------------------------- | ------------- |
| Contrato aberto (JSON Schema, AsyncAPI, OpenAPI 1.4.0)               | Pronto                                               | T0 a T1d      |
| Ingestão por MQTT, HTTP e lote, com validação, DLQ e deduplicação    | Pronto (portão G1)                                   | T1a, T1b      |
| Catálogo: domínios, perfis, sites, áreas, dispositivos e credenciais | Pronto                                               | T1b           |
| Série temporal e último estado                                       | Pronto                                               | T1c           |
| Motor de regras, alarmes e ações                                     | Pronto                                               | T1d           |
| Reconexão e recuperação de falhas (broker, core-api, banco, Redis)   | Pronto e medido                                      | T1-vazão, T1c |
| WebSocket em tempo real e envio de e-mail                            | Falta                                                | T1e           |
| Nó de borda com fila local para quando a internet cai                | Falta (hoje só o esqueleto com `/health`)            | T2            |
| Login pelo Keycloak, papéis, RLS e TLS                               | Falta (hoje o inquilino vem do cabeçalho `X-Tenant`) | T3            |
| Painel web                                                           | Falta (hoje só o esqueleto em Next.js)               | T4            |

Consequência para a demonstração: **o "frontend" de hoje é o terminal**, com a API REST, o broker MQTT e as métricas. O painel Next.js sobe e mostra só o título; ele aparece rapidamente para mostrar que a estrutura existe.

## 2. Como rodar para a apresentação

### 2.1 Pré-requisitos (na véspera)

- Node.js 22.12 ou mais novo, pnpm 10, Docker com Compose v2.
- `jq` e `mosquitto_sub` instalados (só para deixar a demonstração legível).
- Sem internet na sala, tudo funciona igual: as imagens Docker e as dependências precisam estar baixadas antes. Rode a seção 2.2 inteira na véspera, na máquina da apresentação.

### 2.2 Subir do zero (uns 5 minutos, antes da aula)

```bash
cd ~/Projects/alagamento
pnpm install
cp -n .env.example .env                    # só na primeira vez
docker compose down -v                     # começa limpo: sem regras nem alarmes de ensaios anteriores
docker compose up -d                       # PostgreSQL+TimescaleDB+PostGIS, Redis, Mosquitto, Keycloak, Mailpit
docker compose ps                          # todos "healthy"
pnpm --filter @iot/core-api db:migrate     # aplica migrations/sql (inclui 0005, regras e alarmes)
```

Abra **três terminais** e deixe-os lado a lado na projeção:

**Terminal 1: backend (core-api)**

```bash
cd ~/Projects/alagamento
pnpm --filter @iot/core-api start:dev      # API em http://localhost:3001
```

**Terminal 2: frontend (painel, esqueleto)**

```bash
cd ~/Projects/alagamento
pnpm --filter @iot/panel dev               # http://localhost:3000
```

**Terminal 3: demonstração.** Cole o bloco abaixo uma vez. Ele cria atalhos para o resto da apresentação (funciona no zsh e no bash).

```bash
cd ~/Projects/alagamento
pnpm seed:dev     # cria o inquilino defesa-civil, o domínio, o perfil, o site, a área e o sensor nivel-corrego-01

API=http://localhost:3001/api/v1
api()   { curl -s -H 'X-Tenant: defesa-civil' -H 'Content-Type: application/json' "$@"; }
pub()   { pnpm --silent --filter @iot/simulators basic-publisher --modo mqtt -i 1 --espera-ms 300 "$@" 2>&1 | grep publicadas; }
metr()  { curl -s localhost:3001/metrics | grep -E "^(ingestao_mensagens_total|alarmes_|regras_latencia_abertura_alarme_segundos_(count|sum))"; }
alarme_ativo() { api "$API/alarmes?estado=ativo" | jq -r '.itens[0].id'; }
```

Num **quarto terminal** (ou numa aba), deixe um assinante MQTT mostrando as ações publicadas pelo motor:

```bash
cd ~/Projects/alagamento && source <(grep -E '^MQTT_DEV_' .env)
mosquitto_sub -h localhost -u "$MQTT_DEV_USERNAME" -P "$MQTT_DEV_PASSWORD" -t 'defesa-civil/alertas' -v
```

### 2.3 Endereços úteis

| O quê                          | Endereço                                |
| ------------------------------ | --------------------------------------- |
| API (core-api)                 | http://localhost:3001/api/v1            |
| Saúde e métricas               | http://localhost:3001/health e /metrics |
| Painel (esqueleto)             | http://localhost:3000                   |
| Keycloak (sobe, sem uso ainda) | http://localhost:8080                   |
| Mailpit (sobe, sem uso ainda)  | http://localhost:8025                   |
| Contrato OpenAPI               | `docs/contracts/openapi.yaml`           |

### 2.4 Cuidados que o ensaio mostrou

1. **Publique com pausa entre as mensagens** (`--espera-ms 300`, já no atalho `pub`). A ingestão processa o MQTT em 32 conexões paralelas, e leituras com 1 s de diferença podem chegar ao motor fora de ordem; o motor ignora ponto mais antigo que o último processado, então uma rajada perde leituras para a regra. Com uma leitura por minuto, como num sensor real, isso não acontece. Está registrado como defeito a corrigir depois da apresentação.
2. **Valor negativo exige `=`**: escreva `--passo=-5`, nunca `--passo -5`.
3. **No zsh, não guarde cabeçalhos de `curl` numa variável** (`$H` sem aspas não é dividida em argumentos). Use a função `api` acima.
4. Para derrubar o core-api na demonstração, use **Ctrl+C no Terminal 1**. Evite `pkill -f`, que pode matar o próprio terminal.
5. Se algo der errado no meio, a seção 5 tem o plano B.

### 2.5 Ensaio rápido (2 minutos, antes de a turma entrar)

```bash
api "$API/regras" | jq '.total'          # responde: a API está de pé
pub --n 3 --valor-inicial 200 --passo=-1  # {"modo":"mqtt",...,"publicadas":3}
metr                                      # ingestao_mensagens_total{...aceita} 3
```

Depois do ensaio, reinicie o core-api (Ctrl+C e subir de novo) para as métricas começarem do zero na frente da turma. Não crie a regra no ensaio: se ela for criada duas vezes, cada cruzamento abre dois alarmes. Se isso acontecer, volte ao começo da seção 2.2 (o `docker compose down -v` apaga tudo).

## 3. Roteiro de 15 minutos

Divisão: a **Pessoa A** fala da plataforma, da ingestão e da resiliência; a **Pessoa B**, das regras, dos alarmes, das ações e dos testes. Quem não está falando opera o terminal para quem está.

| Tempo         | Bloco                                              | Quem fala | Quem opera |
| ------------- | -------------------------------------------------- | --------- | ---------- |
| 0:00 a 1:30   | Problema, proposta e onde estamos                  | A         | B          |
| 1:30 a 3:30   | Arquitetura e contrato aberto                      | A         | B          |
| 3:30 a 5:00   | Catálogo e ingestão ao vivo                        | A         | B          |
| 5:00 a 9:00   | Regras, alarmes e ações ao vivo                    | B         | A          |
| 9:00 a 12:30  | Reconexões e falhas ao vivo, e o caso sem internet | A         | B          |
| 12:30 a 14:30 | Testes e números                                   | B         | A          |
| 14:30 a 15:00 | Próximos passos e encerramento                     | A e B     |            |

### Bloco 1 · Problema e proposta (0:00 a 1:30) · Pessoa A

> "Alagamentos urbanos acontecem rápido: em minutos o nível de um córrego sobe e a Defesa Civil precisa saber antes de a água chegar à rua. Ao mesmo tempo, sensores no campo, numa fazenda, perdem a internet o tempo todo."
>
> "Nossa proposta é uma plataforma IoT única para os dois mundos, urbano e rural, ligados por um **contrato aberto**: qualquer sensor que fale o contrato entra, e o cenário (alagamento, irrigação) é só configuração."
>
> "Estamos no fim da trilha T1d de seis trilhas. O núcleo central está pronto: recebe medições, guarda a série, avalia regras e abre alarmes. O painel web, o nó de borda e o login ainda vêm. Hoje vamos mostrar o núcleo funcionando de verdade, pelo terminal."

Mostrar a tabela da seção 1 num slide.

### Bloco 2 · Arquitetura e contrato (1:30 a 3:30) · Pessoa A

Pontos para falar (slide com o desenho em camadas):

- **Camadas:** sensor → broker MQTT (Mosquitto) → core-api (NestJS) → PostgreSQL com TimescaleDB (séries) e PostGIS (áreas) → Redis (último estado, deduplicação e barramento interno por Streams).
- **Arquitetura hexagonal:** o pacote `packages/domain` é TypeScript puro, sem NestJS, banco ou MQTT. Toda entrada e saída passa por portas com adaptadores, e até o relógio é uma porta. Um teste automático falha se o domínio importar um framework.
- **Núcleo neutro:** outro teste varre o código do núcleo procurando termos como "alagamento", "córrego" e "fazenda". O cenário de alagamento fica em `config/scenarios/dev-seed.json`.
- **Contrato primeiro:** a mensagem canônica (`docs/contracts/canonical-message.v1.schema.json`) tem campos em português: `versao`, `id_mensagem`, `dispositivo`, `tipo`, `timestamp`, `local`, `medidas`. A regra também é um contrato (`rule.v1.schema.json`). O OpenAPI 1.4.0 descreve a API, e cada mudança de contrato vem antes do código, com exemplos válidos e inválidos testados.

Opcional, se sobrar tempo: abrir `docs/contracts/examples/valid/telemetria-nivel-agua.json` na tela.

### Bloco 3 · Catálogo e ingestão ao vivo (3:30 a 5:00) · Pessoa A fala, Pessoa B opera

> "O `seed:dev` já cadastrou pela API um inquilino, a Defesa Civil, com o domínio alagamento, um perfil de sensor de nível, o bairro Centro, a área do córrego e o sensor `nivel-corrego-01`."

```bash
api "$API/dispositivos" | jq '.itens[0] | {slug, estado, perfil_id, area_id}'
```

> "O sensor mede a distância da água até ele. O perfil calcula sozinho o **nível da água** como grandeza derivada: altura de instalação menos a distância. Vamos publicar 3 leituras por MQTT."

```bash
pub --n 3 --valor-inicial 200 --passo=-1
D=$(api "$API/dispositivos" | jq -r '.itens[0].id')
api "$API/dispositivos/$D/ultimo-estado" | jq '.grandezas[] | {grandeza, valor, derivada, atrasada}'
```

Pontos para falar:

- A mensagem passa por um pipeline: autenticação, validação pelo schema, deduplicação por `id_mensagem`, ordenação pelo horário da medição, enriquecimento e publicação.
- Mensagem inválida é recusada com o motivo e vai para uma fila de rejeitadas (DLQ). Mensagem repetida é descartada sem erro.
- Medição mais antiga que 3 intervalos esperados entra na série marcada como **atrasada** e não dispara regra, porque descreve o passado.

### Bloco 4 · Regras, alarmes e ações ao vivo (5:00 a 9:00) · Pessoa B fala, Pessoa A opera

**4.1 Criar a regra (1 min)**

> "A regra também é um JSON validado pelo contrato. Esta diz: se o nível da água ficar em 150 cm ou mais por 3 leituras seguidas, abra um alarme de severidade alta, peça uma notificação por e-mail e publique um alerta num tópico MQTT. O alarme só fecha quando o nível cair abaixo de 140: isso é **histerese**, para o alarme não ficar abrindo e fechando quando o nível oscila perto do limite."

```bash
api -X POST "$API/regras" -d '{
  "nome": "Nível do córrego em alerta",
  "escopo": "central",
  "ativa": true,
  "condicao": {
    "grandeza": "nivel_agua", "operador": ">=", "limite": 150,
    "duracao": { "leituras": 3 },
    "saida": { "operador": "<", "limite": 140 }
  },
  "acoes": [
    { "tipo": "gerar_alarme", "severidade": "alta" },
    { "tipo": "notificar", "canais": ["email"], "supressao_s": 900 },
    { "tipo": "publicar_topico", "topico": "defesa-civil/alertas" }
  ]
}' | jq '{id, versao, nome}'
```

Mostrar também que a regra errada é recusada:

```bash
api -X POST "$API/regras" -d '{"nome":"sem ações","escopo":"central","ativa":true,"condicao":{"grandeza":"nivel_agua","operador":">","limite":1}}' | jq '.detalhes'
```

**4.2 A água sobe (1 min)**

> "Agora o simulador faz a água subir: distância de 160 cm até 135 cm, ou seja, nível de 140 até 165."

```bash
pub --n 6 --valor-inicial 160 --passo=-5
api "$API/alarmes?estado=ativo" | jq '.itens[] | {regra_nome, dispositivo_slug, severidade, estado, ocorrido_em, aberto_em}'
```

Apontar na tela:

- O alarme abriu na **terceira** leitura acima de 150, como manda a duração.
- `ocorrido_em` é o horário da medição; `aberto_em`, o horário em que a plataforma abriu. Os dois existem porque, com a borda, a medição pode chegar atrasada.
- No quarto terminal, o `mosquitto_sub` mostrou o alerta publicado em `defesa-civil/alertas`.
- Só existe **um alarme aberto por regra e dispositivo**, garantido por um índice único no banco. Continuar acima do limite não abre outro.

```bash
metr     # alarmes_abertos_total{severidade="alta"} 1 e a latência da abertura
```

> "A latência do recebimento da medição até o alarme aberto ficou na casa de milissegundos. A meta do requisito RNF-02 é 3 segundos."

**4.3 O operador age (1 min 30)**

> "O alarme tem um ciclo: ATIVO, RECONHECIDO e RESOLVIDO. Cada passo registra quem fez e quando, numa linha do tempo."

```bash
A=$(alarme_ativo)
api -X PATCH -H 'X-Ator: operador-ana' "$API/alarmes/$A/reconhecer" -d '{"nota":"equipe a caminho"}' | jq '{estado, reconhecido_por, nota_reconhecimento}'

# resolver sem motivo é recusado
api -X PATCH -H 'X-Ator: gestor-bruno' "$API/alarmes/$A/resolver" -d '{}' | jq '.detalhes'

api -X PATCH -H 'X-Ator: gestor-bruno' "$API/alarmes/$A/resolver" -d '{"motivo":"água baixou, vistoria feita"}' \
  | jq '{estado, resolucao, motivo_resolucao, linha_do_tempo: [.linha_do_tempo[].tipo]}'
```

Pontos para falar:

- Reconhecer um alarme já reconhecido responde 409 (conflito), com o motivo.
- O autor vem hoje do cabeçalho `X-Ator`, por uma porta chamada `ActorContext`. Na T3 o adaptador troca para o usuário do token do Keycloak, sem mudar o resto.
- O alarme também resolve sozinho quando a medição sai da condição (abaixo de 140, no exemplo).

**4.4 As outras ações (30 s, só falar)**

- **Webhook:** chama uma URL com tempo limite por tentativa e até 3 tentativas, com espera crescente (500 ms e 1 s).
- **Enviar comando:** publica uma mensagem canônica de comando no tópico do dispositivo, por exemplo para acionar uma sirene.
- **Supressão:** dentro da janela (900 s no exemplo), o mesmo dispositivo não gera outro aviso, exceto se a severidade subir.
- **Ausência:** uma varredura periódica avisa quando o sensor fica N intervalos sem mandar nada. Ela não abre alarme, porque sensor calado é problema de manutenção e não de enchente.
- O e-mail de verdade sai na T1e: hoje o pedido de notificação vai para o barramento interno (`notification.requested`).

### Bloco 5 · Reconexões e falhas ao vivo (9:00 a 12:30) · Pessoa A fala, Pessoa B opera

> "Agora a parte que mais importa para IoT: **o que acontece quando algo cai**. Vamos derrubar peças da plataforma com a turma olhando."

**5.1 A central cai (1 min 30)**

> "Vou derrubar o core-api, o servidor central. O sensor continua publicando."

Pessoa B: **Ctrl+C no Terminal 1**. Depois, no Terminal 3:

```bash
curl -s -m 2 localhost:3001/health || echo "API fora"
pub --n 10 --valor-inicial 200 --passo=-1     # o broker aceita mesmo com a central fora
```

Pessoa B sobe o core-api de novo no Terminal 1 (`pnpm --filter @iot/core-api start:dev`). Quando aparecer `Nest application successfully started`:

```bash
metr      # ingestao_mensagens_total{origem="mqtt",desfecho="aceita"} 10
```

> "As 10 mensagens chegaram, mesmo publicadas com a central fora. Três mecanismos garantem isso. O sensor publica com **QoS 1**. O core-api tem uma **sessão persistente** no broker, então o broker guarda as mensagens enquanto ele está fora. E o core-api só confirma (PUBACK) depois de gravar: se cair no meio do processamento, o broker entrega de novo, e a deduplicação por `id_mensagem` impede a duplicata."

**5.2 O banco cai (1 min)**

```bash
docker compose stop postgres
pub --n 10 --valor-inicial 190 --passo=-1
metr      # aparecem tentativas com desfecho="pendente"
docker compose start postgres
sleep 5; metr   # as 10 viram "aceita"
```

> "Com o banco fora, a mensagem não é confirmada ao broker e fica **pendente**. O core-api tenta de novo com **espera crescente e aleatória**, de 500 ms até 30 s, para não martelar o banco quando ele voltar. No ensaio, 4 segundos depois de o banco voltar, as 10 estavam gravadas, sem perda."

**5.3 E quando a internet cai? (1 min)**

Este ponto é só falado, com um slide. Seja direto: a parte de borda é a próxima trilha.

> "No campo, a falha mais comum é a internet. Para isso existe o **nó de borda** (trilha T2): um computador pequeno no local, que recebe os sensores pela rede local, **guarda tudo numa fila local** enquanto a internet está fora e, quando ela volta, envia em **lotes**. Ele também roda as regras localmente, para a sirene tocar mesmo sem internet."
>
> "O que já está pronto na central para receber isso:"
>
> - "O **endpoint de lote** (`POST /ingestao/lote`) responde mensagem por mensagem, e reenviar o mesmo lote não duplica nada, pela deduplicação por `id_mensagem`."
> - "A medição vem com o **horário da medição** (`timestamp`), separado do horário de chegada. Os dados de 2 horas sem internet entram na série na posição certa."
> - "Esses dados antigos entram marcados como **atrasados** e não disparam alarme de estado atual: ninguém quer uma sirene por uma enchente de duas horas atrás."
> - "O motor de regras tem o **estado salvo no banco**: se a central reinicia no meio de uma condição, ela continua de onde parou."
> - "A regra tem o campo `escopo: borda`, e o contrato é o mesmo para a borda validar as regras que baixar."
>
> "Os testes de duração da borda, de 1 h, 6 h e 24 h, estão no cronograma do portão G3 em diante."

### Bloco 6 · Testes e números (12:30 a 14:30) · Pessoa B

> "O projeto segue **TDD**: todo comportamento entra com um teste que falha antes, e o histórico do git mostra isso, um commit `test(...)` vermelho seguido do `feat(...)` que o deixa verde."

Slide com os números (todos medidos e registrados em `docs/STATUS.md`):

**Resiliência (testes automatizados com Testcontainers, contêineres reais)**

| Teste                                                 | Antes da correção                 | Hoje                                                             |
| ----------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| Rajada de 10.000 mensagens com 20 publicadores        | 8.912 perdidas                    | 0 perdidas                                                       |
| Queda do core-api no meio de 6.000 mensagens          | 3.438 perdidas                    | 0 perdidas                                                       |
| Queda do banco por 4 s no meio de 6.000 mensagens     | 4.897 perdidas e o processo caía  | 0 perdidas (214 a 672 ficaram pendentes e foram gravadas depois) |
| Reiniciar o core-api no meio de uma condição de regra |                                   | não perde a contagem nem duplica o alarme                        |
| Reentrega do mesmo evento ao motor                    |                                   | nada muda                                                        |
| Reduzir de 32 para 8 conexões MQTT                    | mensagens presas em sessões órfãs | 2.400 mensagens drenadas e gravadas (`pnpm mqtt:drain-sessions`) |

> "Os números de 'antes' contam uma história: os testes de carga **acharam** o problema. O broker descartava mensagens porque o core-api tinha uma conexão só. A correção foi distribuir a assinatura em 32 conexões e gravar em grupo, e os mesmos testes provaram a correção."

**Desempenho**

| Medida                                                         | Resultado                              | Meta        |
| -------------------------------------------------------------- | -------------------------------------- | ----------- |
| Ingestão a 1.000 msg/s por 60 s                                | 999 msg/s, p95 de 8 ms                 | 1.000 msg/s |
| Regra: publicação até o alarme aberto, 500 msg/s por 60 s      | p95 de 191 ms (1.500 de 1.500 alarmes) | 3 s         |
| 24 h de série de um dispositivo, sobre 8,6 milhões de medições | 16 ms no pior caso                     | 1 s         |
| 30 dias agregados por hora                                     | 14 ms no pior caso                     | 1 s         |

**Qualidade**

- Cobertura do motor de regras: 100% das linhas e dos ramos, exigido pela configuração dos testes. O mínimo do professor é 70%.
- **Teste de mutação** (Stryker): o programa altera o código de propósito (troca `>` por `>=`, apaga uma linha) e confere se algum teste percebe. No domínio, 99,86% das mutações são pegas; no motor de regras, 99,48%.
- Isolamento entre inquilinos: um teste percorre **todas as rotas** da API e falha se alguma rota nova não estiver coberta pela checagem de que um inquilino não lê dado de outro.

### Bloco 7 · Próximos passos e encerramento (14:30 a 15:00) · Pessoas A e B

> **A:** "Próximos passos: tempo real por WebSocket e e-mail na T1e, o nó de borda na T2, login e segurança na T3 e o painel web na T4. Entrega em 30 de novembro."
>
> **B:** "O que mostramos hoje é o coração da plataforma: um contrato aberto, um núcleo que não perde mensagem quando as peças caem, e regras que viram alarmes em milissegundos. Obrigado. Perguntas?"

## 4. Perguntas prováveis e respostas curtas

| Pergunta                                       | Resposta                                                                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Por que MQTT e também HTTP?                    | MQTT é leve e mantém a conexão, bom para sensor com bateria. HTTP serve a quem não fala MQTT e ao lote da borda.                                                                                    |
| O que é QoS 1?                                 | Entrega "pelo menos uma vez": o broker repete até receber a confirmação. A duplicata possível é descartada pelo `id_mensagem`.                                                                      |
| E se o broker cair?                            | Ele grava a persistência a cada 60 s. Medimos o risco: a 1.000 msg/s, o pico de mensagens confirmadas e ainda não gravadas foi 99 (cerca de 0,1 s de tráfego). Está registrado como risco residual. |
| Por que TimescaleDB?                           | É PostgreSQL com tabelas particionadas por tempo. A consulta de 30 dias por hora sobre 8,6 milhões de linhas responde em 14 ms.                                                                     |
| Como um inquilino não vê o dado do outro?      | Toda tabela tem `tenant_id` e toda consulta filtra por ele, com um teste que cobre todas as rotas. Row level security no banco entra na T3.                                                         |
| Por que o alarme não abre na primeira leitura? | A duração (3 leituras) evita alarme falso por uma leitura ruim, por exemplo uma folha na frente do sensor.                                                                                          |
| O que é histerese?                             | Limite de entrada e de saída diferentes (150 e 140), para o alarme não piscar quando o nível oscila perto do limite.                                                                                |
| Por que a ausência de sinal não abre alarme?   | Sensor calado é manutenção; o alarme fica para o operador tratar a enchente. A ausência notifica o gestor.                                                                                          |
| Funciona para o cenário rural?                 | O núcleo não conhece "alagamento": domínio, grandezas e regras são configuração. O cenário rural é outro arquivo em `config/scenarios/` (T5).                                                       |
| Por que o painel ainda não existe?             | O cronograma constrói de dentro para fora: primeiro o núcleo que garante os dados, depois a borda e a segurança, e o painel na T4, sobre a API já validada.                                         |

## 5. Plano B (se algo falhar ao vivo)

- **Alarme não abriu:** confira se publicou com pausa (`pub` já tem `--espera-ms 300`). Se a regra já tinha contado leituras antes, publique de novo `pub --n 6 --valor-inicial 160 --passo=-5`: a primeira leitura (nível 140) zera a contagem e as seguintes abrem.
- **`alarme_ativo` devolve `null`:** não há alarme ativo; repita o passo 4.2.
- **core-api não sobe de novo:** `docker compose ps` para ver se o PostgreSQL e o Redis estão `healthy`; se o banco ficou parado, `docker compose start postgres`.
- **Nada funciona:** mostre a saída dos testes automatizados, que provam os mesmos comportamentos com contêineres próprios, sem depender do compose:

```bash
pnpm --filter @iot/core-api test test/rules        # regras, alarmes, ações, reinício no meio da condição (cerca de 25 s)
pnpm --filter @iot/domain test test/rules          # motor puro: 56 testes, instantâneo
```

Vale deixar a saída desses dois comandos já rodada numa aba, como garantia.

## 6. Depois da apresentação

```bash
# Ctrl+C nos terminais do core-api e do painel
docker compose down        # mantém os dados
docker compose down -v     # apaga tudo (volta ao zero)
```
