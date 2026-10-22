# ROADMAP: Plataforma IoT Integrada (22/10 a 30/11)

Oct 22, 2026 · @Samuel Custódio

## 1. Premissas e veredito de viabilidade

O plano cumpre os cinco critérios de aceite do professor até segunda, 30/11, com uma pessoa e o Claude Code, mas só cabe com cerca de 5 h de trabalho por dia, todos os dias, e com o escopo seguindo a escada de corte da seção 4.

**Premissas**

- Prazo: entrega em segunda, 30/11. O início é hoje, quinta 22/10, o que dá 40 dias corridos e 200 h a 5 h por dia (a confirmar).
- Uma pessoa desenvolve. O Claude Code implementa com TDD, e a conversa de arquitetura (este chat) revisa cada portão de decisão.
- O design corre em paralelo: correções do Lote 1 até 29/10, e as telas W1 e W7 até 12/11.
- Os requisitos são os do PRD v2: 41 requisitos funcionais no MVP e os 18 não funcionais do documento do professor.
- Nenhum hardware real. Sensores, gateway e fazenda são simulados.
- A segunda 02/11 e a sexta 20/11 são feriados e contam como dias de trabalho.

**Veredito.** A estimativa do MVP completo do PRD v2 é de 193 h, contra 200 h de capacidade: 7 h de folga, ou 3,5%. Isso fecha no papel e é frágil na prática. Por isso o ROADMAP traz uma escada de corte (8 cortes, 30 h no total) e portões semanais que disparam os cortes sem discussão. A 4 h por dia o plano só fecha com todos os cortes aplicados, e a 3 h por dia não fecha (seção 4).

**Decisões de simplificação para o prazo (você pode vetar)**

| Decisão | O que muda em relação ao PRD v2 | Motivo |
| --- | --- | --- |
| Monólito modular NestJS, com módulos ingestion, catalog, rules, alarms e realtime em um processo | O PRD §10 previa serviços separados no monorepo | Menos deploy e menos configuração; as portas hexagonais permitem separar depois |
| Redis (Streams e pub/sub) como barramento interno no MVP | O ADR-004 propunha NATS com JetStream | O Redis já está na stack, e um componente a menos reduz risco; a porta permite trocar por NATS |
| Painel só com W1, W2, W3, W4, W7 e W12 | O PRD §13 previa W1 a W13 no MVP | As telas de catálogo, locais, regras, canais e usuários viram API, seeds por script e console do Keycloak |
| Pacotes de alagamento, fazenda e recursos\_hidricos criados por seed e API | O PRD falava em painel de catálogo | O critério do professor aceita API ou painel (RF-CEN-01); o cadastro de dispositivos pelo painel (W7) continua, por causa do RF-DIS-01 |

## 2. Linha do tempo

As trilhas se encadeiam por semana, e cada linha tracejada marca um portão de decisão (G1 a G4 e a entrega); a linha cheia, G5, é o congelamento do código antes do teste de 72 h.

&#91;embedded content: linha do tempo · 7 trilhas e 6 portões de decisão\]

O design (correções do Lote 1 e telas W1 e W7) termina antes de a trilha T4 começar, em 13/11. A trilha T3 aparece em três blocos porque a segurança é distribuída: logs e métricas na semana 1, TLS e ACL na semana 2, e Keycloak com isolamento por inquilino na semana 3.

## 3. Marcos e portões de decisão

Cada portão tem uma prova de pronto verificável. A regra é automática: se a prova não estiver passando ao fim do dia do portão, aplica-se o corte da última coluna sem renegociar.

| Portão | Data | Prova de pronto | Corte se atrasar mais de 1 dia |
| --- | --- | --- | --- |
| M0 · Fundação | Dom 25/10 | Um comando sobe PostgreSQL com TimescaleDB e PostGIS, Redis, Mosquitto e Keycloak; CI verde; contratos v1.0 versionados com exemplos válidos e inválidos testados | Nenhum, é pré-requisito de tudo |
| G1 · Ingestão | Qui 29/10 | O simulador publica por MQTT, HTTP e lote, e a medição aparece em GET /dispositivos/{id}/telemetria; duplicata descartada, mensagem inválida na DLQ; catálogo e dispositivos criados por API | Cortes 1 e 2 |
| G2 · Alagamento pela API | Qui 05/11 | O simulador sobe o nível, a regra abre o alarme, o e-mail chega, o evento sai por WebSocket e o OpenAPI é validado no CI | Cortes 3, 4 e 5 |
| G3 · Núcleo seguro e borda viva | Qui 12/11 | Keycloak com 5 papéis, RLS com teste de vazamento, ACL e TLS no MQTT, nó de borda sincronizando em lotes (teste de 1 h) e design de W1 e W7 recebido | Cortes 6 e 7 |
| G4 · Borda completa e painel | Qui 19/11 | Regras locais, heartbeat e teste de 6 h na borda; painel com W1, W2, W3, W4 e W7 funcionando sobre a API real | Corte 8 |
| G5 · Congelamento | Seg 23/11 | Cenários urbano e rural rodando em homologação, teste de 24 h concluído sem perda, e nenhuma alteração no núcleo até a entrega | Nenhum; adiar o teste de 72 h consome toda a folga |
| Entrega | Seg 30/11 | Evidências dos cinco critérios, matriz de rastreabilidade RF e RNF, código e demonstração ensaiada | Nenhum |

## 4. Escopo do MVP e escada de corte

O escopo-base são os 41 requisitos do PRD v2 (seção 4 do PRD). A escada abaixo lista, na ordem de menor dano, o que sai se os portões dispararem; juntos, os 8 cortes liberam 30 h.

| Corte | O que sai | Horas | Requisito afetado | Aval do professor |
| --- | --- | --- | --- | --- |
| 1 | Telegram; ficam só as notificações por e-mail | 3 | RF-APP-05 (parcial) | Não |
| 2 | Terceira linguagem em Go no lugar de C++ | 2 | RF-INT-02 | Não (o critério pede três linguagens) |
| 3 | Fila única na borda, sem prioridade para alarmes | 3 | RF-EDG-05 | Não |
| 4 | Cifra da fila da borda fica documentada e sem implementação | 3 | RF-SEG-05 (Essencial) | Sim |
| 5 | Página pública W12; o RF-DAD-05 continua pela API | 4 | Passo 7 do cenário CR-1 | Não |
| 6 | Consultas espaciais com PostGIS | 4 | RF-CEN-04 | Não |
| 7 | WebSocket trocado por polling a cada 5 s | 5 | RF-APP-02 perde o critério de 2 s | Não |
| 8 | Cadastro de dispositivos só por API, sem a tela W7 | 6 | RF-DIS-01 (Essencial, parcial) | Sim |

Nunca saem: os cinco critérios de aceite do professor, a ingestão (RF-ING-01 a 08), o motor de regras e os alarmes, e a segurança de RF-SEG-01 a 04.

**Cenários por capacidade diária**

| Capacidade | Horas até 30/11 | Situação |
| --- | --- | --- |
| 5 h por dia | 200 h | Cabe o plano completo (193 h), com 7 h de folga |
| 4 h por dia | 160 h | Mesmo com os 8 cortes (163 h) faltam 3 h, então a folga é negativa e dois cortes exigem aval do professor |
| 3 h por dia | 120 h | Não fecha: é preciso alinhar escopo ou prazo com o professor antes de 29/10 |

## 5. Trilhas: tarefas, requisitos e testes

Cada tarefa começa pelo teste: a coluna "Primeiro teste" descreve o comportamento que precisa estar vermelho antes de o código existir. As horas das sete trilhas somam 193 h.

### T0. Fundação (22/10 a 25/10, 12 h)

| Tarefa | Requisitos | Primeiro teste | Horas |
| --- | --- | --- | --- |
| Monorepo pnpm com apps core-api, edge-node, panel e simulators e pacotes domain e contracts | RNF-14, RNF-15 | O comando de testes roda em todos os pacotes e falha no primeiro caso de domínio | 3 |
| Compose da central: PostgreSQL com TimescaleDB e PostGIS, Redis, Mosquitto e Keycloak | RNF-14 | Smoke test: o comando de subida termina com todos os healthchecks verdes | 3 |
| Contratos v1.0: JSON Schema canônico, AsyncAPI e esqueleto do OpenAPI, com exemplos válidos e inválidos | RF-INT-01, RNF-13 | Um exemplo inválido é aceito pelo validador, até o esquema ficar correto | 3 |
| CI no GitHub Actions: lint, testes, cobertura e validação de contratos | RNF-15 | Um contrato inválido derruba o pipeline | 1,5 |
| CLAUDE.md, ADRs 001 a 007 (ADR-004 revisado para Redis) e convenção de commit com o ID do requisito | Sem requisito | Sem teste | 1,5 |

### T1. Núcleo central (25/10 a 05/11, 56 h)

| Subtrilha | Requisitos | Primeiro teste | Horas |
| --- | --- | --- | --- |
| T1a · Ingestão e pipeline | RF-ING-01, 02, 03, 04, 06, 08; RF-PRO-01; RF-OBS-02 | Mensagem válida vira medição; inválida vai para a DLQ; duplicata é descartada; medição atrasada entra na ordem sem disparar regra; um simulador TypeScript básico publica por MQTT | 12 |
| T1b · Catálogo, dispositivos e credenciais | RF-CEN-01, 02, 03, 04; RF-DIS-01, 02, 06 | Domínio, perfil e hierarquia criados por API; credencial emitida e revogada; dispositivo sem leitura por 3 intervalos passa a Sem sinal | 12 |
| T1c · Dados | RF-DAD-01, 02, 05 | Gravação idempotente, 24 h de um dispositivo em até 1 s, último estado no Redis e API pública sem dado pessoal | 8 |
| T1d · Regras, alarmes e ações | RF-PRO-02, 03, 05 | Limite com duração, taxa, ausência, área e histerese; ciclo ativo, reconhecido e resolvido; uma estratégia por ação; 100% dos ramos do motor | 14 |
| T1e · API, tempo real e notificações | RF-APP-01, 02, 05, 07; RF-INT-06 | OpenAPI validado, paginação comum, evento por WebSocket em até 2 s, e-mail enviado (Mailpit nos testes) e endpoint de validação | 10 |

Prova de pronto: G1 para T1a e T1b, e G2 para T1c a T1e.

### T2. Borda (09/11 a 19/11, 24 h)

| Tarefa | Requisitos | Primeiro teste | Horas |
| --- | --- | --- | --- |
| Composição do nó: Mosquitto local, aplicação reduzida e fila SQLite em modo WAL | RF-EDG-01, RNF-07 | Encerrar o processo à força durante a gravação não corrompe a fila | 5 |
| Sincronização em lotes com cursor, idempotência e retomada | RF-EDG-02, RF-ING-03, RF-ING-08 | Com o link cortado no meio do lote, cada mensagem chega uma vez após reconectar, ordenada pelo horário da medição | 7 |
| Regras locais e download de regras da central | RF-EDG-03 | A regra de irrigação dispara com o link desligado e o evento sincroniza depois | 4 |
| Duas filas, com alarmes antes da telemetria | RF-EDG-05 | Em link lento, um alarme novo chega antes do lote atrasado de telemetria | 3 |
| Heartbeat e saúde do nó | RF-EDG-06 | Um nó sem sincronizar aparece com o tempo desde o último contato | 2 |
| Cifra da fila | RF-SEG-05 | O arquivo da fila lido sem a chave não revela mensagens | 3 |

Testes de duração na borda: 1 h em 12/11, 6 h em 18/11 e 24 h em 21/11. Prova de pronto: G3 e G4.

### T3. Segurança e observabilidade (distribuída em três semanas, 21 h)

| Tarefa | Requisitos | Primeiro teste | Horas |
| --- | --- | --- | --- |
| Logs JSON com id de correlação e endpoint /metrics (semana 1) | RF-OBS-01, 02 | Uma mensagem aparece com o mesmo id\_mensagem em todos os módulos, e /metrics responde no formato Prometheus | 4 |
| TLS no MQTT, HTTPS pelo Traefik e ACL por dispositivo (semana 2) | RF-SEG-04, RNF-11 | Publicar no tópico de outro dispositivo é recusado, e a conexão sem TLS também | 3 |
| Keycloak com OpenID Connect, 5 papéis e segundo fator para administrador (semana 3) | RF-SEG-01, 02 | Operador não altera regras nem dispositivos, e administrador sem segundo fator não acessa | 8 |
| Isolamento por inquilino com tenant\_id e row level security (semana 3) | RF-SEG-03 | Um teste percorre todas as rotas e confirma que o usuário de um inquilino não vê dados de outro | 6 |

### T4. Painel web (13/11 a 20/11, 36 h)

Depende do contrato da API (G2) e do design do Lote 1 corrigido, de W1 e de W7.

| Tarefa | Requisitos | Primeiro teste | Horas |
| --- | --- | --- | --- |
| Base Next.js, tokens de design, AppShell, TopBar, SideNav, BottomNav e login OIDC (W1) | RNF-16 | Rota protegida redireciona para o login, e o axe não aponta violação crítica | 6 |
| W2 Mapa operacional: MapLibre, SeverityMarker, AreaPolygon, HeatLayer, ClusterMarker, sheet e painel lateral, com tempo real | RF-APP-02 | O marcador muda de estado quando chega o evento; o enquadramento desconta os controles; existem os estados vazio, offline e carregando | 10 |
| W3 Detalhe do dispositivo: MetricCard e TimeSeriesChart com faixas de limiar | RF-DAD-01 | O gráfico de 24 h mostra as medidas suspeitas e atrasadas; existem os estados sem leituras e sem sinal | 6 |
| W4 Alarmes: abas, AlarmCard, reconhecer com nota e AlarmTimeline | RF-PRO-05 | Reconhecer move o alarme de aba e grava a nota, e o contador de abertos bate com o chip do topo | 6 |
| W7 Dispositivos: lista paginada e cadastro em 3 passos | RF-DIS-01, RF-APP-07 | A credencial aparece uma única vez, e o dispositivo cadastrado surge na lista e no mapa | 4 |
| W12 Página pública (20/11) | RF-DAD-05 | A página não expõe dispositivos individuais nem campo pessoal | 4 |

### T5. Integrações e demonstrações (20/11 a 29/11, 24 h)

A ordem na semana 5 prioriza o cenário rural e os simuladores, porque o teste de 72 h precisa deles em 24/11.

| Tarefa | Requisitos | Primeiro teste | Horas |
| --- | --- | --- | --- |
| Simuladores: evoluir o TypeScript (alagamento com chuva forte, ruído e falha) e criar o Python (fazenda com solo, clima e silo) | RF-INT-02 | Cada cenário publica mensagens canônicas válidas, e a medição aparece na API | 7 |
| Cliente em Go (ou C++) só com biblioteca genérica de MQTT | RF-INT-02 | A medição enviada pelo cliente aparece na API | 3 |
| Adaptador de nível 2 em contêiner: formato próprio para o canônico | RF-INT-03 | Subir o adaptador não exige recompilar nem reiniciar o núcleo | 3 |
| Pacotes de configuração por seed: alagamento, fazenda e recursos\_hidricos | RF-CEN-01, 02; RNF-08 | O domínio recursos\_hidricos é criado e recebe medições sem nenhum commit de código | 5 |
| Kit do integrador: guia, exemplos nas três linguagens e coleção de requisições | RF-INT-01, 07 | Seguindo só o guia, um dispositivo de teste é conectado em até 30 min, cronometrado | 4 |
| Roteiro da demonstração | Sem requisito | Sem teste | 2 |

### T6. Homologação (20/11 a 30/11, 20 h)

| Tarefa | Requisitos | Primeiro teste | Horas |
| --- | --- | --- | --- |
| Teste de carga com k6 e gerador MQTT a 1.000 mensagens por segundo (sexta 20/11) | RNF-01, 02 | O p95 da ingestão à persistência fica em até 2 s, e o do disparo de regra em até 3 s | 6 |
| Preparar e iniciar o teste de 72 h (terça 24/11, 08:00) | RNF-04, RF-EDG-02 | Após 72 h com o link cortado, as mensagens emitidas e as armazenadas são as mesmas, sem duplicatas | 4 |
| Relatório de evidências: cinco critérios, matriz RF e RNF e capturas | Todos | Cada critério aponta para um arquivo de prova | 8 |
| Ensaio final da demonstração | Sem requisito | O roteiro roda de ponta a ponta sem intervenção fora do roteiro | 2 |

## 6. Testes de duração, carga e evidências

O teste de 72 h não aceita repetição tardia, então a borda sobe uma escada de testes cada vez mais longos, e cada degrau descobre defeitos que o próximo degrau não pode mais encontrar.

| Teste | Quando | Duração | O que prova |
| --- | --- | --- | --- |
| Curto | Qui 12/11 (G3) | 1 h | Sincronização em lotes sem duplicata |
| Médio | Qua 18/11 (antes de G4) | 6 h | Retomada de lote e prioridade de alarmes |
| Longo | Sáb 21/11 a dom 22/11 | 24 h | Estabilidade, crescimento da fila e consumo de memória |
| Final | Ter 24/11, 08:00, a sex 27/11, 08:00 | 72 h | RNF-04 e o critério de desconexão do professor |

**Método.** O link entre o nó e a central é cortado com regra de firewall ou com tc netem (perda total). Os simuladores continuam publicando no nó, e cada um mantém um contador sequencial por mensagem. Ao fim, o link volta, e o script compara mensagens emitidas, armazenadas e duplicadas.

**Contingência do teste de 72 h.** Se falhar sem tempo de repetir, a evidência passa a ser o teste real de 24 h concluído em 22/11 mais um teste automatizado com relógio simulado cobrindo 72 h, documentado como tal e comunicado ao professor. A pergunta sobre aceitar essa alternativa está na seção 9 e deve ser respondida antes de 12/11.

**Teste de carga (sexta 20/11).** Roda em ambiente de homologação com Docker Compose, em máquina dedicada. O k6 exercita POST /ingestao e POST /ingestao/lote, e um gerador MQTT publica em paralelo, a 1.000 mensagens por segundo durante 10 min. A medição vem dos histogramas Prometheus: p95 da ingestão à persistência até 2 s, p95 até o disparo de regra até 3 s e nenhuma mensagem perdida na comparação de contadores. Para o RNF-09, duas instâncias da API consomem com assinatura compartilhada do MQTT 5.

**Evidências dos cinco critérios**

| Critério do professor | Arquivo de prova | Como gerar |
| --- | --- | --- |
| Um projeto urbano e um rural, o rural com nó de borda | Capturas e logs da demonstração | Roteiros CR-1 e CR-2 |
| Link da borda cortado por 72 h sem perda nem duplicação | Relatório com as contagens de emitidas, armazenadas e duplicadas | Script de contagem do teste final |
| Domínio novo só por configuração | Registro do seed e diff do repositório sem alteração de código | Roteiro CR-3 |
| Integração em três linguagens | Os três clientes rodando e as três medições na API | Kit do integrador |
| Teste de carga para RNF-01 e RNF-02 | Relatório do k6 e histogramas | Trilha T6 |

A matriz de rastreabilidade dos 69 RF e 18 RNF (atendido, parcial ou fora, com a prova) é gerada a partir da seção 8 do PRD e vai no mesmo relatório.

## 7. Regras de trabalho com o Claude Code

O Claude Code implementa, e você decide e aprova em cada portão. O repositório carrega as regras no arquivo CLAUDE.md, e cada tarefa entra por um prompt de handoff com formato fixo.

**CLAUDE.md na raiz.** Stack, comandos de teste, lint e subida, convenções (TDD, arquitetura hexagonal, mudanças aditivas, nomes de componentes do design, commit com o ID do requisito) e a localização dos contratos e do PRD em docs/. O arquivo é um dos entregáveis desta etapa.

**Ciclo por tarefa**

1. Você cola o handoff da tarefa (template abaixo).
2. O Claude Code escreve o teste e mostra a falha.
3. Implementa o mínimo até o teste ficar verde.
4. Refatora com os testes verdes.
5. Roda a suíte completa e o lint.
6. Faz um commit pequeno, por exemplo `feat(RF-ING-08): descarta duplicata por id_mensagem`.
7. Ao fim do portão, você roda a prova do portão e traz a saída e o diff para a revisão de arquitetura neste chat.

**Template de handoff**

```
Contexto: <trilha, portão, o que já existe e não deve mudar>
Requisitos: <IDs de RF e RNF>
Teste primeiro: <comportamento que deve falhar antes do código>
Pode alterar: <arquivos e pastas>
Não pode alterar: <o que passou no portão anterior>
Pronto quando: <comandos que devem passar e a prova do portão>
Ao terminar: <testes, cobertura, decisões tomadas e dívidas>
```

**Mudanças aditivas.** O que passou em um portão não é refatorado sem pedido explícito, e todo handoff cita arquivos e componentes pelo nome. Novos módulos entram ao lado dos existentes.

**Quando algo falhar.** Cole o sintoma exato (mensagem, trecho de log e comando) e peça o diagnóstico da causa raiz antes de qualquer correção. Depois do diagnóstico, o teste que reproduz o defeito entra primeiro, e só então a correção.

**Sessões e estado.** Uma sessão do Claude Code por subtrilha, com commit antes de encerrar. Ao fim de cada sessão, o arquivo docs/STATUS.md recebe o portão atual, o que passa e o que falta, para a próxima sessão e para este chat.

**Handoffs prontos agora:** o CLAUDE.md, a trilha T0 e a subtrilha T1a. Os demais saem deste chat a cada portão, com o código real em mãos, para que o prompt cite arquivos que existem.

## 8. Riscos de calendário

O critério para todas as respostas é cortar escopo antes de comprimir um teste de duração, porque o teste de 72 h não tem como ser refeito perto da entrega.

| Risco | Gatilho | Resposta |
| --- | --- | --- |
| Capacidade real abaixo de 5 h por dia | Em um portão, 6 h ou mais atrás do plano | Aplicar o próximo corte da escada, na ordem da seção 4 |
| Um ou mais dias sem trabalhar | Qualquer dia perdido | Replanejar com o próximo corte; nunca comprimir os testes de duração |
| Keycloak e RLS travam | G3 atrasado em 1 dia | Segundo fator só para o administrador e testes de papéis priorizados; o isolamento por inquilino não é cortado |
| Corrupção ou duplicata na borda | Teste de caos vermelho em G3 ou G4 | Congelar funcionalidades novas na borda e corrigir só isso; é o item de maior risco do prazo |
| Teste de 72 h falha | Falha antes de qua 25/11, 08:00 | Corrigir e reiniciar, o que ainda fecha em 28/11; depois disso, valer a contingência da seção 6 |
| Painel de 36 h estoura | G4 atrasado | Corte 8 e corte 5; gráfico de W3 simplificado |
| A máquina de homologação não sustenta 1.000 mensagens por segundo | Reprovação no teste de 20/11 | Gravação em lote na hipertabela, menos logs e ajuste do Mosquitto; registrar o limite medido e a meta no relatório |
| Resposta do professor tarde ou mudança de requisito | Sem resposta até 29/10 | Seguir o plano e registrar as suposições no relatório |
| Imagem Docker ou serviço externo muda | Build quebra sem alteração de código | Versões fixas das imagens e Mailpit local em vez de serviço externo de e-mail |

## 9. Perguntas ao professor e pendências

O plano depende de respostas que só o professor pode dar. Envie as perguntas hoje, porque a resposta muda o corte que vale a partir de G1 (29/10).

**Perguntas ao professor**

1. O trabalho será feito por uma pessoa. O escopo do documento v2.0 continua o mesmo ou pode ser reduzido para um trabalho individual?
2. Quais requisitos são obrigatórios no MVP: só os 33 Essenciais, ou também os Importantes?
3. Se o teste real de 72 h falhar e não houver tempo de repetir, vale um teste real de 24 h mais um teste de 72 h com relógio simulado, documentado como tal?
4. Posso usar Go no lugar de C++ como terceira linguagem?
5. Simuladores no lugar de sensores e gateway LoRaWAN físicos são aceitos nas demonstrações?
6. Onde roda a homologação e a apresentação (máquina própria ou servidor da universidade), e qual é o formato e a hora da entrega em 30/11 (repositório, relatório e demonstração)?
7. Se faltar tempo, posso declarar como dívida a cifra da fila da borda (RF-SEG-05) e o painel de cadastro de dispositivos (RF-DIS-01)?

**Pendências suas**

- Confirmar a capacidade diária de 5 h, ou informar a real, até 29/10.
- Vetar ou aprovar as quatro simplificações da seção 1.
- Reenviar ao Claude Design o prompt de correções do Lote 1 e devolver o PDF corrigido até 29/10.
- Desenhar W1 e W7 (Lote 2) até 12/11 e, se quiser a base visual do BRUT, enviar os tokens até a mesma data. As telas W9, W10, W5, W6, W8, W11 e W13 ficam para depois do MVP.
- Criar o repositório e exportar o PRD v2 em Markdown para docs/PRD.md, e este ROADMAP em PDF para docs/ROADMAP.pdf.
- Entregar o CLAUDE.md e o handoff da trilha T0 ao Claude Code para iniciar hoje.
