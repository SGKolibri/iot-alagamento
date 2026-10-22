# PRD v2: Plataforma IoT Integrada

Oct 20, 2026 · @Samuel Custódio

## 1. Visão, contexto e relação com os outros documentos

A Plataforma IoT Integrada é a base comum onde projetos de IoT que hoje funcionam isolados passam a enviar dados, ser administrados e ser consultados em um só lugar, na cidade ou no campo, sem que o núcleo conheça qualquer cenário específico.

**Contexto.** O documento de requisitos v2.0 da disciplina de Internet das Coisas (UniEVANGÉLICA) define o que a plataforma precisa fazer: seis camadas (dispositivos, ingestão, gestão de dispositivos, regras, dados e aplicação), um contrato canônico de mensagens, a hierarquia inquilino, local, área e dispositivo, e um nó de borda que opera sem internet e sincroniza depois. Este PRD traduz esse documento em decisões de produto, escopo e entrega do grupo, e mantém a numeração RF e RNF do professor para dar rastreabilidade.

**Papel do grupo.** O grupo constrói a plataforma. O alerta de alagamento (Cota), que vinha sendo projetado como produto fechado com app Flutter, passa a ser o cenário urbano de referência: um projeto integrado que prova que o núcleo funciona.

**O que muda em relação ao PRD v1 (Cota)**

| Tema | PRD v1 (Cota) | PRD v2 (plataforma) |
| --- | --- | --- |
| Produto | Sistema de alerta de alagamento de ponta a ponta | Núcleo neutro, com o alagamento como pacote de configuração de um domínio |
| Interface | App Flutter nativo | Interface web responsiva (o documento deixa o app nativo para uma fase futura) |
| Mensagens | Payload e tópicos próprios | Contrato canônico e tópicos definidos pelo documento |
| Modelo de locais | Sensor solto com latitude e longitude | Inquilino, local, área e dispositivo, com geometria GeoJSON |
| Conectividade limitada | Não prevista | Nó de borda essencial no MVP |
| Acesso | JWT próprio, papéis GESTOR e ADMIN | OpenID Connect, cinco papéis e isolamento por inquilino |
| Aproveitado do v1 | Regras de risco, telas de mapa e alarmes, estratégia de TDD | Reaproveitado como domínio de referência (seções 12 e 13) |

## 2. Objetivos, critérios de aceite do MVP e métricas

O MVP está pronto quando os cinco critérios de aceite do documento (seção 9.3) forem demonstrados, e cada um tem abaixo a evidência que o grupo vai produzir.

**Objetivos**

1. Receber dados de projetos urbanos e rurais por contrato aberto, sem biblioteca obrigatória.
2. Funcionar em locais com conectividade limitada, por meio de um nó de borda que guarda, decide e sincroniza.
3. Aceitar um domínio novo apenas por configuração.
4. Dar ao operador uma visão integrada: mapa, séries, alarmes e saúde das integrações.
5. Servir de referência de arquitetura IoT para a disciplina, com as decisões documentadas.

**Critérios de aceite do MVP e evidência planejada**

| Critério do documento | Evidência planejada |
| --- | --- |
| Um projeto urbano e um rural integrados, o rural com nó de borda | Cota (alagamento) como projeto urbano e uma fazenda simulada com solo e clima como projeto rural, com nó de borda, em demonstração ao vivo |
| Link da borda cortado por 72 h, sem perda nem duplicação | Teste automatizado com relógio simulado e uma execução real de 72 h antes da apresentação, comparando mensagens emitidas e armazenadas |
| Domínio novo criado só por configuração (RNF-08) | Criar o domínio "recursos\_hidricos" (caso UC-06) pelo painel, com o repositório sem nenhum commit de código no processo |
| Integração demonstrada em ao menos três linguagens | Dispositivos de exemplo em TypeScript, Python e C++ (firmware ESP32 ou simulador), usando só bibliotecas genéricas de MQTT e HTTP |
| Teste de carga comprovando RNF-01 e RNF-02 | k6 para HTTP e gerador de carga MQTT a 1.000 mensagens por segundo, com p95 até 2 s da ingestão à persistência, em ambiente de homologação com Docker Compose |

**Métricas de acompanhamento**

| Métrica | Meta |
| --- | --- |
| Cobertura de testes automatizados no núcleo | 70% ou mais (RNF-15), com meta interna de 80% |
| Mensagens perdidas ou duplicadas após reconexão da borda | Zero |
| Tempo para um integrador novo conectar um dispositivo de teste seguindo só o guia (RF-INT-07) | Até 30 min |
| Tempo para criar um domínio, perfil e painel novos por configuração | Até 15 min |

**Fora de escopo**

- Projeto e fabricação de dispositivos e gateways.
- Infraestrutura de rede (antenas, LoRaWAN, enlaces de satélite).
- Modelos avançados de IA e gêmeos digitais 3D.
- Sistemas de gestão completos (ERP, gestão de safra, tributos).
- Aplicativo móvel nativo (fase futura, segundo o documento).
- Sensores físicos em campo: o MVP usa dispositivos simulados e deixa a especificação do nó documentada.

## 3. Atores, papéis e inquilinos

Os atores do documento viram cinco papéis humanos mais a credencial de máquina, e o isolamento por inquilino vale para toda consulta, inclusive a da API pública.

| Ator | Papel de acesso | O que faz na plataforma | Exemplo |
| --- | --- | --- | --- |
| Administrador da plataforma | administrador (segundo fator obrigatório) | Cria inquilinos, opera nós de borda, usuários e observabilidade | Equipe do grupo |
| Gestor do inquilino | gestor | Gerencia catálogo, locais, regras, painéis e usuários do seu inquilino | Defesa Civil municipal, cooperativa |
| Integrador | integrador | Cadastra dispositivos, usa o sandbox, emite chaves de API | Quem conecta o sensor |
| Operador | operador | Acompanha painéis e reconhece alarmes, sem alterar regras nem dispositivos | Plantão da Defesa Civil, produtor |
| Leitor | leitor | Consulta somente leitura | Agrônomo, gestor externo |
| Dispositivo, sistema ou nó de borda | Credencial própria (X.509 ou token) | Publica dados e recebe comandos | Sensor, gateway, nó de borda |
| Cidadão ou pesquisador | Sem login | Consome dados abertos anonimizados | Universidade, população |

**Inquilinos de demonstração**

- defesa-civil: cenário urbano, com o domínio alagamento.
- coop-cerrado: cenário rural, com o site fazenda-boa-vista, áreas de talhão e um nó de borda.

## 4. Escopo e fases

O documento tem 69 requisitos funcionais (33 Essenciais, 30 Importantes e 6 Desejáveis) e 18 não funcionais; o MVP do grupo entrega os 33 Essenciais e mais 8 requisitos da fase 2 que os cenários de referência exigem, totalizando 41.

| Fase | Entregas | Requisitos | Qtde |
| --- | --- | --- | --- |
| 1 · MVP | Catálogo, perfis e locais; ingestão por MQTT, HTTP e lotes com validação, deduplicação e dados atrasados; nó de borda com fila e sincronização; cadastro e credenciais; séries e último estado; API; painel básico; papéis e inquilinos; métricas e logs | Todos os Essenciais, mais RF-CEN-04, RF-EDG-03, RF-EDG-05, RF-EDG-06, RF-APP-02, RF-APP-05, RF-INT-06 e RF-INT-07 | 41 |
| 2 · Integração | Adaptadores plugáveis e conectores, LoRaWAN, NGSI-LD, gêmeo e comandos, agregações, webhooks, painéis configuráveis, SMS, chaves de API, rastreamento distribuído | Demais Importantes | 22 |
| 3 · Evolução | Modelos de cenário prontos, painel local da borda, CoAP, OTA com grupo canário, funções externas, mapeamento sem código | Desejáveis | 6 |

**Por que oito requisitos sobem da fase 2 para o MVP (proposta do grupo)**

- RF-CEN-04 (consultas espaciais): necessário para "sensores dentro do talhão" e para o raio de influência no alagamento.
- RF-EDG-03 (regras locais na borda): a irrigação do talhão com o link desligado faz parte do cenário rural.
- RF-EDG-05 e RF-EDG-06 (prioridade de alarmes e saúde da borda): o envio prioriza alarmes, e o painel mostra há quanto tempo cada nó está sem sincronizar, o que sustenta a evidência do teste de 72 h.
- RF-APP-02 (tempo real): o mapa e a lista de alarmes precisam atualizar sem recarregar.
- RF-APP-05 (notificações): o alerta de alagamento perde o sentido sem aviso ao operador. No MVP, e-mail e mensageria; SMS fica na fase 2.
- RF-INT-06 e RF-INT-07 (sandbox e kit do integrador): sustentam o critério de integração em três linguagens.

As fases 2 e 3 só entram se o prazo permitir, e o ROADMAP define a ordem de construção dentro de cada fase.

## 5. Cenários de referência

Quatro cenários demonstram a plataforma de ponta a ponta e sustentam os critérios de aceite; cada passo cita os requisitos do documento que ele exercita.

### CR-1. Alerta de alagamento (urbano, inquilino defesa-civil)

1. O gestor cria o domínio "alagamento" e o perfil "sensor de nível de água", com as grandezas nivel\_agua (cm), distancia\_agua (cm) e bateria (mV) e intervalo esperado de 60 s (RF-CEN-01, RF-CEN-02).
2. Cadastra um site de bairro e áreas por córrego ou rua, com sensores posicionados em cada uma (RF-CEN-03).
3. Sensores simulados publicam telemetria canônica por MQTT, com um cenário de chuva forte (RF-ING-01).
4. As regras do pacote de alagamento geram alarmes Atenção, Alerta e Crítico, com histerese e tendência (RF-PRO-02, RF-PRO-05).
5. O painel mostra mapa com pontos, mapa de calor por área e lista de alarmes ao vivo, e o operador reconhece cada alarme (RF-APP-02, RF-PRO-05).
6. O gestor recebe e-mail e mensagem no celular, e um webhook pode acionar sistemas externos (RF-APP-05, RF-PRO-03).
7. A população consulta a situação por uma página pública com dados anonimizados (RF-DAD-05; a exportação de dados abertos, RF-DAD-04, é da fase 2).

### CR-2. Fazenda com nó de borda (rural, inquilino coop-cerrado)

1. A cooperativa cadastra o site fazenda-boa-vista e desenha os talhões como áreas (RF-CEN-03, RF-CEN-04).
2. Um nó de borda na sede recebe, por um broker local, os sensores de solo e de silo, que são simulados (RF-EDG-01).
3. O link com a central cai por até 72 h. O nó guarda as leituras e a regra local liga a irrigação do talhão 07 quando a umidade cai (RF-EDG-03).
4. No silo, a regra "temperatura acima de 30 °C por 30 min" gera alarme crítico e notificação (RF-PRO-02, RF-PRO-05).
5. Ao reconectar, o nó envia lotes que priorizam alarmes. A central ordena pelo horário da medição e descarta duplicatas (RF-EDG-02, RF-EDG-05, RF-ING-03, RF-ING-04, RF-ING-08).
6. O painel de saúde mostra há quanto tempo cada nó ficou sem sincronizar (RF-EDG-06).

### CR-3. Domínio novo só por configuração (reservatórios)

1. O gestor cria o domínio "recursos\_hidricos" e o perfil "nível de reservatório": grandeza nível em metros, faixa de 0 a 10 m e envio a cada 30 min (RF-CEN-01, RF-CEN-02).
2. O integrador conecta os sensores no nível 1 de integração.
3. O domínio ganha histórico, regras, painel e API sem nenhuma alteração de código (RNF-08).

### CR-4. Integração em três linguagens

1. Três dispositivos de exemplo, em TypeScript, Python e C++, publicam mensagens canônicas usando só bibliotecas genéricas de MQTT e HTTP (RF-INT-02).
2. Um quarto dispositivo, com formato próprio, entra por um adaptador de nível 2 executado em contêiner (RF-INT-03).
3. O validador de mensagens e o sandbox confirmam cada formato sem tocar nos dados de produção (RF-INT-06).
4. Se houver tempo, o projeto de postes inteligentes entra como adaptador de nível 2, no caso UC-05 do documento (dimerização por gêmeo do dispositivo).

## 6. Arquitetura em camadas

A plataforma tem seis camadas e três funções transversais, e cada camada conversa apenas com a vizinha ou com o barramento interno, por meio de contratos. Assim, a implementação de uma camada (por exemplo, o banco de séries temporais) pode ser trocada sem alterar as outras.

&#91;embedded content: arquitetura de referência · 6 camadas e 3 funções transversais\]

As camadas 2 a 6 formam a instância central, e a camada 1 reúne os dispositivos, os nós de borda e os sistemas existentes. Nenhuma camada conhece o cenário: domínios, perfis e locais são configuração.

| Camada | Serviço no projeto | Responsabilidade | O que não faz |
| --- | --- | --- | --- |
| 1 · Dispositivos e borda | Simuladores e nó de borda | Medir, atuar e enviar dados; na borda, guardar, decidir e sincronizar | Sem restrição específica |
| 2 · Conectividade e ingestão | ingestion e adaptadores | Receber, autenticar, validar e converter ao formato canônico | Regras de negócio |
| 3 · Gestão de dispositivos | catalog | Cadastro, perfis, credenciais, grupos, gêmeo e comandos | Armazenar telemetria |
| 4 · Processamento e regras | rules e alarms | Normalizar, agregar, avaliar regras e gerar alarmes e ações | Falar protocolo de dispositivo |
| 5 · Dados | PostgreSQL, TimescaleDB, PostGIS e Redis | Séries temporais, último estado, locais, áreas e contexto | Decidir ações |
| 6 · Aplicação e serviços | api, realtime e painel web | APIs, tempo real, webhooks, painéis e notificações | Acessar o banco sem passar pelos serviços |
| Transversais | Keycloak, Traefik, Prometheus e afins | Segurança, observabilidade e administração | Sem restrição específica |

## 7. Contratos de integração

A plataforma integra por contrato, e nenhuma biblioteca própria é obrigatória: qualquer linguagem que fale MQTT ou HTTP e monte um JSON consegue se conectar. Todos os contratos ficam versionados no repositório e publicados por URL pública, com histórico de versões (RF-INT-01).

| Contrato | Formato | O que descreve | Fase |
| --- | --- | --- | --- |
| Mensagem canônica | JSON Schema versionado | Telemetria, eventos, estado, comandos e lotes | 1 |
| Interface assíncrona | AsyncAPI 3 | Tópicos MQTT, direção e esquema de cada mensagem | 1 |
| Interface síncrona | OpenAPI 3 | Endpoints REST, parâmetros, respostas e erros | 1 |
| Locais e geometrias | GeoJSON (RFC 7946) | Pontos, áreas e trajetórias, na ordem longitude e latitude | 1 |
| Contexto | NGSI-LD com Smart Data Models | Entidades padronizadas dos domínios Smart Cities e AgriFood | 2 |

**Mensagem canônica v1.0** (exemplo do cenário de alagamento)

```json
{
  "versao": "1.0",
  "id_mensagem": "0b7f1c9e-3a52-4d0b-8f4e-5c1d2e7a9b10",
  "dispositivo": "nivel-corrego-01",
  "tipo": "telemetria",
  "timestamp": "2026-10-20T21:10:00Z",
  "local": {
    "site": "bairro-centro", "area": "corrego-exemplo",
    "geo": { "type": "Point", "coordinates": [-48.9528, -16.3281] }
  },
  "medidas": [
    { "grandeza": "distancia_agua", "valor": 132.4, "unidade": "cm" },
    { "grandeza": "bateria", "valor": 3980, "unidade": "mV" }
  ]
}
```

| Campo | Regra |
| --- | --- |
| versao | Versão do contrato, para evoluir sem quebrar quem usa a anterior |
| id\_mensagem | UUID gerado na origem, usado para descartar duplicatas, inclusive na sincronização da borda |
| timestamp | Momento da medição em UTC (ISO 8601); a ordenação usa esse horário e ignora a hora de chegada |
| via | Opcional: nó de borda ou gateway por onde a mensagem passou |
| local | Site, área e geometria; se omitido, vale o local cadastrado do dispositivo |
| medidas | Grandezas do catálogo, com unidades no código UCUM (cm, mV, Cel, %) |

O nível da água é uma grandeza derivada, calculada pela plataforma a partir de distancia\_agua e do atributo de altura de instalação do dispositivo (seção 12).

**Tópicos MQTT**

```
{inquilino}/{site}/{dominio}/{dispositivo}/telemetria   dispositivo -> plataforma
{inquilino}/{site}/{dominio}/{dispositivo}/evento       dispositivo -> plataforma
{inquilino}/{site}/{dominio}/{dispositivo}/estado       dispositivo -> plataforma (gêmeo relatado)
{inquilino}/{site}/{dominio}/{dispositivo}/comando      plataforma -> dispositivo

defesa-civil/bairro-centro/alagamento/nivel-corrego-01/telemetria
coop-cerrado/fazenda-boa-vista/agricultura/solo-talhao07-02/telemetria
```

A publicação usa QoS 1, e cada dispositivo só publica e assina nos próprios tópicos (RF-SEG-04). O domínio vem do catálogo do inquilino, sem lista fixa.

**Níveis de integração**

| Nível | Quando usar | Uso neste projeto |
| --- | --- | --- |
| 1 · Nativo | Firmware ou projeto novo que publica no formato canônico | Sensores de alagamento, solo e silo (simulados) e os três dispositivos de exemplo |
| 2 · Adaptador | Dispositivo com formato próprio, traduzido por um adaptador em contêiner | Quarto dispositivo da demonstração e, opcionalmente, o projeto de postes |
| 3 · Sistema a sistema | Sistema com API própria, integrado por conector (camada anticorrupção) | Fase 2 (RF-INT-04) |

**Hierarquia de locais**

| Nível | Cenário urbano | Cenário rural |
| --- | --- | --- |
| Inquilino | defesa-civil | coop-cerrado |
| Site | bairro-centro | fazenda-boa-vista |
| Área | corrego-exemplo | talhao-07 |
| Dispositivo | nivel-corrego-01 | solo-talhao07-02 |

**API REST (prefixo /api/v1)**

Todas as listagens aceitam os mesmos parâmetros: pagina, limite, ordenar e filtros por campo (RF-APP-07).

| Método e caminho | Papel mínimo | Finalidade |
| --- | --- | --- |
| POST /dispositivos | integrador | Cadastrar dispositivo e obter credenciais |
| POST /ingestao | dispositivo ou chave de API | Enviar uma mensagem por HTTP (202 se válida, 400 com a lista de erros) |
| POST /ingestao/lote | dispositivo, borda ou chave de API | Enviar lote, com resultado por mensagem |
| GET /dispositivos/{id}/telemetria | leitor | Histórico por grandeza e intervalo |
| GET /dispositivos/{id}/ultimo-estado | leitor | Último valor de cada grandeza |
| PUT /dispositivos/{id}/gemeo/desejado | gestor | Definir estado desejado (comando assíncrono, fase 2) |
| GET /sites/{id}/areas | leitor | Listar áreas com geometria |
| POST /catalogo/dominios | gestor | Criar domínio no catálogo do inquilino |
| POST /perfis | gestor | Criar perfil de dispositivo |
| POST /regras | gestor | Criar regra de processamento, central ou de borda |
| GET /alarmes | leitor | Listar alarmes por estado, severidade e área |
| PATCH /alarmes/{id}/reconhecer | operador | Reconhecer um alarme |
| POST /validador | integrador | Validar uma mensagem no sandbox, sem gravar |
| GET /dados-abertos/{conjunto} | público | Conjuntos anonimizados |
| GET /ngsi-ld/v1/entities | leitor | Contexto NGSI-LD (fase 2) |

## 8. Requisitos funcionais e rastreabilidade

Os 69 requisitos do documento mantêm seus identificadores originais. Cada linha mostra a prioridade do professor, a fase em que o grupo entrega e como o requisito será atendido; "1 (puxado)" marca os oito requisitos Importantes antecipados para o MVP (seção 4).

### Cenários e catálogo (CEN)

| ID | Requisito | Prior. | Fase | Como atendemos |
| --- | --- | --- | --- | --- |
| RF-CEN-01 | Catálogo de domínios por inquilino | Essencial | 1 | Entidade Domain com CRUD por API e painel, sem deploy |
| RF-CEN-02 | Perfis de dispositivo (grandezas, unidades, faixa, intervalo) | Essencial | 1 | Perfil versionado e reutilizável; medida fora da faixa vira suspeita |
| RF-CEN-03 | Hierarquia inquilino, local, área e dispositivo | Essencial | 1 | Entidades Tenant, Site, Area e Device, com chaves compostas por inquilino |
| RF-CEN-04 | Geometrias GeoJSON e consultas espaciais | Importante | 1 (puxado) | PostGIS, consultas ST\_Within e ST\_DWithin por SQL cru |
| RF-CEN-05 | Modelos de cenário urbano e rural | Desejável | 3 | Pacotes de configuração em JSON; o pacote de alagamento nasce no MVP como primeiro modelo |
| RF-CEN-06 | Mapeamento para Smart Data Models | Importante | 2 | Tabela de correspondência por domínio |

### Conectividade e ingestão (ING)

| ID | Requisito | Prior. | Fase | Como atendemos |
| --- | --- | --- | --- | --- |
| RF-ING-01 | MQTT 3.1.1 e 5.0 sobre TLS | Essencial | 1 | Mosquitto com TLS e autenticação por dispositivo; o serviço de ingestão assina com curingas |
| RF-ING-02 | HTTPS em POST /ingestao | Essencial | 1 | Endpoint que responde 202 ou 400 com a lista de erros |
| RF-ING-03 | Lotes com resultado por mensagem | Essencial | 1 | POST /ingestao/lote; teste com 5.000 mensagens e 3 inválidas |
| RF-ING-04 | Dados atrasados pelo horário da medição | Essencial | 1 | Ordenação pelo timestamp na série; regras ignoram dado fora da janela de atualidade |
| RF-ING-05 | Servidores LoRaWAN (ChirpStack, TTN) | Importante | 2 | Adaptador de nível 2 que consome o MQTT do servidor de rede |
| RF-ING-06 | Validação contra o JSON Schema da versão | Essencial | 1 | Validador por versão; rejeitadas vão para a DLQ com o motivo |
| RF-ING-07 | JSON e CBOR, lotes compactados | Importante | 2 | Decodificadores CBOR e gzip no pipeline |
| RF-ING-08 | Descartar duplicatas por id\_mensagem | Essencial | 1 | Receptor idempotente com chave única |
| RF-ING-09 | CoAP sobre DTLS | Desejável | 3 | Adaptador CoAP |
| RF-ING-10 | Limite de taxa por dispositivo e inquilino | Importante | 2 | Rate limit com contadores no Redis |

### Borda e conectividade limitada (EDG)

| ID | Requisito | Prior. | Fase | Como atendemos |
| --- | --- | --- | --- | --- |
| RF-EDG-01 | Nó de borda com ingestão local e fila persistente | Essencial | 1 | Mosquitto local, ingestão MQTT e HTTP e fila SQLite em modo WAL |
| RF-EDG-02 | Sincronização sem perdas nem duplicatas | Essencial | 1 | Lotes idempotentes por id\_mensagem, com confirmação por lote e retomada |
| RF-EDG-03 | Regras locais na borda | Importante | 1 (puxado) | Mesmo motor de regras do núcleo, com as regras baixadas da central |
| RF-EDG-04 | Receber configurações, perfis e regras da central | Importante | 2 | Consulta periódica de configuração ao conectar |
| RF-EDG-05 | Priorizar alarmes quando a banda é limitada | Importante | 1 (puxado) | Duas filas no nó, alarmes antes da telemetria rotineira |
| RF-EDG-06 | Gerenciar nós remotamente: estado, versão, fila e espaço | Importante | 1 (puxado) | Heartbeat do nó com métricas, exibido no painel de nós |
| RF-EDG-07 | Painel local mínimo, sem internet | Desejável | 3 | Página estática servida pelo nó |

### Gestão de dispositivos (DIS)

| ID | Requisito | Prior. | Fase | Como atendemos |
| --- | --- | --- | --- | --- |
| RF-DIS-01 | Cadastro com perfil, domínio, local, área, fabricante, firmware e inquilino | Essencial | 1 | Entidade Device, por API e painel |
| RF-DIS-02 | Credencial única por dispositivo, revogável | Essencial | 1 | Token gerado no cadastro e guardado com hash; o broker consulta o cadastro, e a revogação chega aos nós de borda na sincronização (X.509 na fase 2) |
| RF-DIS-03 | Provisionamento em lote | Importante | 2 | Importação de CSV e API com relatório de sucessos e falhas |
| RF-DIS-04 | Gêmeo do dispositivo | Importante | 2 | Estado desejado, relatado e diferença, entregue na reconexão |
| RF-DIS-05 | Comandos com resposta registrada | Importante | 2 | Tópico de comando, resposta associada pelo id do comando |
| RF-DIS-06 | Online e offline pelo intervalo esperado do perfil | Essencial | 1 | Regra de ausência de dados com tolerância em múltiplos do intervalo do perfil |
| RF-DIS-07 | Grupos e etiquetas | Importante | 2 | Tabela de tags e filtro na API |
| RF-DIS-08 | OTA em ondas com grupo canário | Desejável | 3 | Especificação documentada, sem implementação |

### Integração de projetos existentes (INT)

| ID | Requisito | Prior. | Fase | Como atendemos |
| --- | --- | --- | --- | --- |
| RF-INT-01 | Publicar o contrato canônico versionado | Essencial | 1 | Repositório de contratos publicado por URL, com histórico de versões |
| RF-INT-02 | Integrar usando só protocolos padrão | Essencial | 1 | Exemplos em TypeScript, Python e C++ com bibliotecas genéricas de MQTT e HTTP |
| RF-INT-03 | Adaptadores plugáveis em contêiner | Essencial | 1 | Contrato de adaptador (assina um tópico de entrada e publica no canônico), implantado por Compose sem recompilar o núcleo |
| RF-INT-04 | Conectores por API REST e webhooks | Importante | 2 | Conector com coleta agendada e receptor de webhooks |
| RF-INT-05 | Contexto NGSI-LD | Importante | 2 | Camada de tradução ou Orion-LD, decidido na fase 2 |
| RF-INT-06 | Sandbox e validador de mensagens | Importante | 1 (puxado) | Endpoint /validador e inquilino sandbox sem gravação em produção |
| RF-INT-07 | Kit do integrador | Importante | 1 (puxado) | Guia, exemplos nas três linguagens e coleção de requisições |
| RF-INT-08 | De-para configurável sem código | Desejável | 3 | Mapeamento declarativo no painel |

### Processamento e regras (PRO)

| ID | Requisito | Prior. | Fase | Como atendemos |
| --- | --- | --- | --- | --- |
| RF-PRO-01 | Normalizar unidades e enriquecer mensagens | Essencial | 1 | Etapa do pipeline, com grandezas derivadas por expressão no perfil |
| RF-PRO-02 | Regras de condição e ação (limite, ausência, janela, área) | Essencial | 1 | Motor de regras com duração, taxa de variação e histerese como parâmetros (seção 12) |
| RF-PRO-03 | Ações: alarme, notificação, comando, webhook, tópico | Essencial | 1 | Uma estratégia por tipo de ação, cada uma com teste automatizado |
| RF-PRO-04 | Agregações em janelas | Importante | 2 | Agregados contínuos do TimescaleDB por hora e por dia |
| RF-PRO-05 | Ciclo de vida dos alarmes com severidade | Essencial | 1 | Estados ativo, reconhecido e resolvido; alarme vindo da borda mantém o horário de origem |
| RF-PRO-06 | Funções externas por webhook | Desejável | 3 | Etapa opcional do pipeline que chama a função |

### Dados (DAD)

| ID | Requisito | Prior. | Fase | Como atendemos |
| --- | --- | --- | --- | --- |
| RF-DAD-01 | Séries temporais por dispositivo, grandeza, área e intervalo | Essencial | 1 | Hipertabela do TimescaleDB; 24 h de um dispositivo em até 1 s |
| RF-DAD-02 | Último valor de cada grandeza | Essencial | 1 | Redis, com espelho em tabela de último estado |
| RF-DAD-03 | Retenção e redução de resolução | Importante | 2 | Políticas de retenção e agregados contínuos |
| RF-DAD-04 | Exportação CSV e JSON, dados abertos | Importante | 2 | Exportação que respeita o filtro e o papel do usuário |
| RF-DAD-05 | Anonimizar ou pseudonimizar dados pessoais | Essencial | 1 | Nenhum dado pessoal nas mensagens; a API pública expõe só campos de uma lista revisada |
| RF-DAD-06 | Trilha de auditoria | Importante | 2 | Tabela AuditLog com autor, data e valor anterior |

### Aplicação e serviços (APP)

| ID | Requisito | Prior. | Fase | Como atendemos |
| --- | --- | --- | --- | --- |
| RF-APP-01 | API REST versionada em OpenAPI 3 | Essencial | 1 | Contrato escrito antes do código, documentação interativa e validação no CI |
| RF-APP-02 | Tempo real por WebSocket ou MQTT | Importante | 1 (puxado) | WebSocket para o painel e MQTT para assinantes externos |
| RF-APP-03 | Webhooks de saída com novas tentativas | Importante | 2 | Fila com retry, espera crescente e circuit breaker |
| RF-APP-04 | Painéis configuráveis com mapa, gráficos e alarmes | Importante | 2 | Grafana provisionado por inquilino; no MVP, painel básico próprio |
| RF-APP-05 | Notificações por e-mail, mensageria e SMS | Importante | 1 (puxado) | E-mail e Telegram no MVP; SMS na fase 2 |
| RF-APP-06 | Interface web responsiva, painel em 5 s a 1 Mbit/s | Importante | 2 | Layout responsivo desde o MVP; o orçamento de 5 s é medido na fase 2 |
| RF-APP-07 | Paginação, filtros e ordenação padronizados | Essencial | 1 | DTO e interceptor comuns a todas as listagens |

### Segurança e acesso (SEG)

| ID | Requisito | Prior. | Fase | Como atendemos |
| --- | --- | --- | --- | --- |
| RF-SEG-01 | OpenID Connect com segundo fator para administradores | Essencial | 1 | Keycloak |
| RF-SEG-02 | Cinco papéis de acesso | Essencial | 1 | Papéis no Keycloak mapeados para guardas do NestJS |
| RF-SEG-03 | Isolamento de dados por inquilino | Essencial | 1 | tenant\_id em todas as tabelas e no token, row level security no PostgreSQL e teste automatizado de vazamento entre inquilinos |
| RF-SEG-04 | Dispositivo restrito aos próprios tópicos | Essencial | 1 | ACL do Mosquitto gerada a partir do cadastro, na central e na borda |
| RF-SEG-05 | Credencial própria dos nós e fila local cifrada | Essencial | 1 | Token por nó e fila SQLite cifrada (SQLCipher) |
| RF-SEG-06 | Chaves de API com escopo e validade | Importante | 2 | Chaves guardadas com hash, escopo e expiração; 401 ou 403 quando inválidas |

### Observabilidade e administração (OBS)

| ID | Requisito | Prior. | Fase | Como atendemos |
| --- | --- | --- | --- | --- |
| RF-OBS-01 | Métricas da plataforma em formato Prometheus | Essencial | 1 | Endpoint /metrics em cada serviço |
| RF-OBS-02 | Logs JSON com identificador de correlação | Essencial | 1 | Logs estruturados em que o id\_mensagem acompanha a mensagem da borda à central |
| RF-OBS-03 | Rastreamento com OpenTelemetry | Importante | 2 | Traces da ingestão até a persistência |
| RF-OBS-04 | Painel de saúde por integração e nó de borda | Importante | 2 | Painel Grafana alimentado pelas métricas |
| RF-OBS-05 | Alertas operacionais da plataforma | Importante | 2 | Regras do Alertmanager para fila crescendo e nó sem sincronizar |

## 9. Requisitos não funcionais

Os 18 requisitos do documento viram metas com forma de validação definida, e todas entram no pipeline de CI ou nos testes de homologação.

| ID | Atributo | Meta do documento | Como validamos |
| --- | --- | --- | --- |
| RNF-01 | Desempenho | 1.000 mensagens por segundo no MVP, 10.000 com réplicas | k6 e gerador de carga MQTT, com relatório |
| RNF-02 | Latência | p95 da ingestão à persistência até 2 s e até o disparo de regra até 3 s; regras de borda até 3 s | Histogramas de latência durante o teste de carga |
| RNF-03 | Disponibilidade | 99,5% ao mês para ingestão e API | Healthchecks, reinício automático e monitor de uptime em homologação |
| RNF-04 | Tolerância a desconexão | Borda opera 72 h sem link e sem perda | Teste real de 72 h e teste automatizado com relógio simulado |
| RNF-05 | Banda limitada | Sincronização a partir de 64 kbit/s | Link emulado com tc e netem a 64 kbit/s; lotes compactados com gzip no MVP (CBOR na fase 2) |
| RNF-06 | Hardware de borda | 4 núcleos ARM e 4 GB de RAM | Contêiner com esses limites de CPU e memória; teste em Raspberry Pi se houver a placa |
| RNF-07 | Falta de energia | Queda não corrompe fila nem configuração | SQLite em modo WAL, escrita transacional e teste que encerra o processo à força durante a gravação |
| RNF-08 | Neutralidade de cenário | Domínio, perfil ou modelo novo só por configuração | Cenário CR-3 e verificação automática de termos de cenário no código do núcleo |
| RNF-09 | Escalabilidade | Serviços centrais sem estado | Réplicas no Compose sob carga |
| RNF-10 | Durabilidade | Nenhuma mensagem confirmada (ACK) é perdida | ACK só após persistir; teste derrubando o serviço no meio do fluxo |
| RNF-11 | Segurança | TLS 1.2 ou superior e criptografia em repouso | Verificação de TLS por varredura, volumes cifrados e segredos fora do código |
| RNF-12 | Privacidade | Conformidade com a LGPD | Lista de campos públicos revisada e registro das operações de tratamento |
| RNF-13 | Independência de linguagem | 100% das interfaces em contratos abertos | CI valida OpenAPI, AsyncAPI e JSON Schema |
| RNF-14 | Portabilidade | Contêineres OCI com Compose | Subir toda a plataforma com um comando em máquina limpa |
| RNF-15 | Manutenibilidade | Cobertura de 70% ou mais no núcleo e análise estática sem falha crítica | Relatório de cobertura e análise estática (ESLint e CodeQL) no CI |
| RNF-16 | Usabilidade e acessibilidade | Português, responsivo e WCAG 2.1 AA | Lighthouse e axe no CI |
| RNF-17 | Compatibilidade | APIs versionadas; versão descontinuada funciona por 12 meses | Política de versionamento e cabeçalho Deprecation nas rotas antigas |
| RNF-18 | Recuperação | Backup diário, RPO até 24 h e RTO até 4 h | Backup agendado com pg\_dump e teste de restauração cronometrado |

## 10. Decisões de stack e de arquitetura

A plataforma reaproveita componentes abertos e consolidados e constrói só o que forma o núcleo: os serviços NestJS, o painel e o nó de borda. A stack do grupo (NestJS, PostgreSQL com Prisma, Mosquitto e Docker) continua, e o restante vem da lista de referência do documento.

| Camada | Tecnologia | Reaproveitar ou construir |
| --- | --- | --- |
| Broker MQTT | Eclipse Mosquitto, com autenticação e ACL consultando o cadastro | Reaproveitar |
| Barramento interno | Redis (Streams e pub/sub) no MVP, com porta para trocar por NATS (ADR-004 revisado) | Reaproveitar |
| Serviços do núcleo | NestJS em monorepo: api, ingestion, catalog, rules, alarms e realtime, rodando como monólito modular em um processo no MVP | Construir |
| Dados relacionais | PostgreSQL com Prisma para o catálogo; SQL cru onde o Prisma não alcança | Construir o modelo |
| Séries temporais | TimescaleDB, extensão do mesmo PostgreSQL | Reaproveitar |
| Geometrias | PostGIS, no mesmo PostgreSQL | Reaproveitar |
| Último estado | Redis | Reaproveitar |
| Identidade | Keycloak (OpenID Connect, papéis, segundo fator) | Reaproveitar |
| API Gateway | Traefik (TLS, roteamento, limite de taxa) | Reaproveitar |
| Painel operacional | Next.js responsivo, MapLibre GL sobre tiles do OpenStreetMap | Construir |
| Painéis configuráveis | Grafana (fase 2) | Reaproveitar |
| Observabilidade | Prometheus, Grafana, Loki e OpenTelemetry Collector | Reaproveitar |
| Nó de borda | Mosquitto local, serviço NestJS reduzido (ingestão, fila SQLite, regras) e agente de sincronização, em Compose | Construir, com o mesmo domínio da central |
| Simuladores e exemplos | TypeScript, Python e C++ (ESP32) | Construir |
| Implantação e CI | Docker Compose (central e borda), GitHub Actions | Reaproveitar |

**Arquitetura hexagonal em cada serviço.** O domínio não conhece protocolo, banco nem cenário. Cada serviço separa domain (regras e casos de uso), ports (interfaces) e adapters (MQTT, REST, lotes, PostgreSQL, SQLite). Um pacote de domínio compartilhado (ingestão, motor de regras e ciclo de alarmes) roda na central e na borda, com adaptadores de armazenamento diferentes: PostgreSQL na central e SQLite no nó.

**Prisma e extensões do PostgreSQL.** O Prisma não gerencia hipertabelas do TimescaleDB nem geometrias do PostGIS. O Prisma cuida do catálogo (inquilinos, locais, áreas, dispositivos, perfis, regras e alarmes), e as migrações de hipertabela, agregados contínuos e índices espaciais ficam em arquivos SQL versionados ao lado, acessados por consultas cruas.

**Padrões adotados**

| Padrão | Onde |
| --- | --- |
| Pipes and Filters | Pipeline de ingestão |
| Idempotent Receiver | Ingestão e sincronização da borda, por id\_mensagem |
| Dead Letter Channel | Mensagens inválidas |
| Store-and-forward | Fila do nó de borda |
| Publicação e assinatura | Barramento interno |
| Type Object | Domínios e perfis de dispositivo |
| Repository | Acesso a dados, com PostgreSQL na central e SQLite na borda |
| Strategy | Ações do motor de regras |
| Observer | Alarmes e notificações |
| Adapter e camada anticorrupção | Adaptadores de nível 2 e conectores de nível 3 |
| CQRS | Escrita da ingestão separada das consultas |
| Circuit Breaker e Retry com espera crescente | Webhooks, notificações e sincronização |
| Device Shadow | Gêmeo do dispositivo (fase 2) |

**Registros de decisão (ADR) iniciais**

- ADR-001: Prisma para o catálogo e SQL cru para TimescaleDB e PostGIS.
- ADR-002: Mosquitto como broker, na central e na borda.
- ADR-003: Keycloak como provedor de identidade.
- ADR-004: Redis (Streams e pub/sub) como barramento interno no MVP, com porta para trocar por NATS.
- ADR-005: SQLite em modo WAL, cifrado, como fila da borda.
- ADR-006: Painel Next.js próprio no MVP e Grafana para painéis configuráveis na fase 2.
- ADR-007: Monorepo NestJS com pacote de domínio compartilhado entre central e borda.

## 11. Modelo de dados e pipeline de ingestão

O catálogo fica em tabelas relacionais gerenciadas pelo Prisma, as medições ficam em uma hipertabela do TimescaleDB, e toda mensagem passa por um pipeline de etapas independentes, igual na central e na borda.

&#91;embedded content: pipeline de ingestão e sincronização da borda · 7 etapas\]

O nó de borda grava em duas filas e, ao reconectar, reenvia os alarmes antes da telemetria rotineira. A central recebe esses lotes pelo mesmo pipeline que recebe as mensagens diretas.

**Entidades do catálogo (Prisma)**

| Entidade | Campos principais | Observação |
| --- | --- | --- |
| Tenant | id, slug, nome | Raiz do isolamento; todas as outras tabelas levam tenantId, com row level security |
| Site | tenantId, slug, nome, geometria | Único por inquilino e slug |
| Area | tenantId, siteId, slug, nome, geometria | Praça, talhão, córrego |
| Domain | tenantId, slug, nome | Catálogo configurável por inquilino |
| DeviceProfile | tenantId, domainId, nome, versão, grandezas (JSON), intervaloEsperadoS | Grandezas com unidade UCUM, faixa válida e expressão de derivação opcional |
| Device | tenantId, slug, siteId, areaId, profileId, fabricante, firmware, atributos (JSON), tags, geometria, estado, ultimoContato | A credencial é guardada só como hash |
| EdgeNode | tenantId, siteId, slug, versão, ultimaSync, tamanhoFila, espacoLivre | Alimentado pelo heartbeat do nó |
| Rule | tenantId, escopo (central ou borda), definição (JSON), ações (JSON), versão, ativa | Mesmo formato nas duas pontas |
| Alarm e AlarmEvent | tenantId, deviceId, ruleId, severidade, estado, ocorridoEm, reconhecidoPor | ocorridoEm guarda o horário da medição |
| AuditLog e ApiKey | autor, data e valor anterior; hash, escopo e validade | Fase 2 |

**Medições (SQL versionado, fora do Prisma)**

```sql
CREATE TABLE measurements (
  tenant_id   uuid        NOT NULL,
  device_id   uuid        NOT NULL,
  quantity    text        NOT NULL,
  ts          timestamptz NOT NULL,
  value       double precision NOT NULL,
  unit        text        NOT NULL,
  suspect     boolean     NOT NULL DEFAULT false,
  message_id  uuid        NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, quantity, ts)
);
SELECT create_hypertable('measurements', 'ts');
```

A chave primária torna a gravação idempotente. O Redis guarda os últimos id\_mensagem vistos, para descartar duplicatas sem consultar o banco, e o último valor de cada grandeza.

**Pipeline de ingestão (Pipes and Filters)**

1. Receber: MQTT, HTTP ou lote chegam em adaptadores de entrada.
2. Autenticar: a credencial do dispositivo ou do nó é conferida e o tópico é checado contra a ACL.
3. Validar: JSON Schema da versão declarada; falhas vão para a DLQ com o motivo.
4. Deduplicar: id\_mensagem já visto é descartado sem erro.
5. Ordenar: a medição entra na série pelo seu timestamp. Se for mais antiga que 3 intervalos esperados do perfil, é marcada como atrasada e não dispara regras de estado atual.
6. Enriquecer: aplica unidades, faixa válida, grandezas derivadas e dados de inquilino, domínio, local e área.
7. Publicar: grava na série, atualiza o último estado e publica no barramento para regras e tempo real.

**Sincronização da borda**

1. Sem link, o nó aceita mensagens, aplica o mesmo pipeline e guarda em duas filas: alarmes e telemetria rotineira.
2. Ao reconectar, envia lotes ordenados com os alarmes primeiro, cada lote com um cursor.
3. A central responde por mensagem: aceita, duplicada ou recusada.
4. O nó remove da fila só o que foi confirmado e retoma do cursor se o link cair no meio.
5. Alarmes gerados na borda chegam com o horário em que ocorreram.

## 12. Motor de regras e o domínio de alagamento

O motor de regras é genérico, e o alagamento é um pacote de configuração que usa apenas os recursos do motor, o que mantém o núcleo neutro quanto ao cenário (RNF-08).

**Modelo de regra**

- Condição: comparação de uma grandeza com um limite, com parâmetros opcionais de duração mínima ("por 3 min"), taxa de variação em uma janela ("subindo mais de 1,5 por minuto em 10 min"), ausência de dados (sem medida por N intervalos do perfil), área geográfica (dispositivos dentro de uma geometria) e histerese (limiar de saída).
- Escopo: central ou borda, com o mesmo formato nas duas pontas.
- Ações: gerar alarme com severidade, notificar, enviar comando, chamar webhook e publicar em tópico, cada uma como uma estratégia testada à parte.
- Notificação com janela de supressão configurável, para evitar o excesso de avisos do mesmo dispositivo.
- Ciclo do alarme: ativo, reconhecido e resolvido. A resolução é automática quando a condição de saída é atendida, ou manual com motivo.
- Dados atrasados ficam no histórico e não avaliam condições de estado atual.

**Grandezas derivadas no perfil.** Cada grandeza pode ter uma expressão sobre outras grandezas e sobre atributos do dispositivo, avaliada na etapa Enriquecer. Exemplo: nivel\_agua = atributos.altura\_instalacao\_cm menos distancia\_agua. As expressões aceitam só aritmética e funções básicas, sem execução de código arbitrário.

**Pacote de configuração "alagamento"** (primeiro modelo de cenário, antecipando o RF-CEN-05)

| Item | Configuração |
| --- | --- |
| Domínio | alagamento |
| Perfil "sensor de nível de água" | Grandezas distancia\_agua (cm, faixa de 0 a 400), nivel\_agua (derivada, cm) e bateria (mV); intervalo esperado de 60 s; atributos altura\_instalacao\_cm, limiar\_atencao\_cm, limiar\_alerta\_cm e limiar\_critico\_cm (valor inicial sugerido: 40%, 70% e 90% da altura útil) |
| Regra Atenção | nivel\_agua a partir do limiar de Atenção por 2 leituras; saída com nível 2 cm abaixo do limiar por 10 min; severidade baixa |
| Regra Alerta | nivel\_agua a partir do limiar de Alerta por 2 leituras; severidade alta; notifica o operador por e-mail e Telegram |
| Regra Crítico | nivel\_agua a partir do limiar Crítico por 2 leituras; severidade crítica; notifica e chama webhook |
| Regra de tendência | Taxa de nivel\_agua de 1,5 cm/min ou mais por 3 min, com nível já no limiar de Atenção; gera alarme de severidade alta |
| Regra Sem sinal | Sem medidas por 3 intervalos do perfil; muda o estado do dispositivo para Sem sinal (RF-DIS-06) e notifica o gestor, sem abrir alarme na fila do operador |
| Painel | Mapa com pontos por severidade, mapa de calor por área, lista de alarmes ao vivo e gráfico do nível com as faixas de limiar |
| Página pública | Situação por área com dados anonimizados e o selo "Defesa Civil ciente" quando o alarme é reconhecido |

**Mapa de calor como recurso genérico do painel.** Cada dispositivo contribui com um peso igual à grandeza dividida por um valor de referência definido no perfil (no alagamento, o limiar Crítico), limitado a 1, com raio de influência configurável (300 m por padrão) e decaimento gaussiano. A tela rotula o resultado como estimativa, porque só existem medições nos pontos dos sensores.

**Correspondência com os estados do PRD v1**

| Estado no Cota (v1) | Severidade na plataforma |
| --- | --- |
| Normal | Sem alarme |
| Atenção | Baixa |
| Alerta | Alta |
| Crítico | Crítica |
| Sem sinal | Sem severidade (estado do dispositivo) |

## 13. Interface web responsiva e telas

O painel é uma aplicação web responsiva (Next.js) que o operador usa no centro de operações e o produtor usa no celular, com o mapa como tela inicial. O documento deixa o app nativo para uma fase futura, então o app Flutter e o fluxo de lugares seguidos com push do PRD v1 ficam reservados para essa fase, e os desenhos do v1 seguem como referência visual.

**Princípios**

1. Celular primeiro: uma coluna e bottom sheet no celular, painel lateral no desktop.
2. Resumo no topo: um chip informa "Tudo normal" ou "3 alarmes ativos", com a contagem por severidade.
3. Cor sempre acompanhada de forma, ícone e palavra: cada severidade tem um marcador próprio, para funcionar com daltonismo e sob sol forte.
4. Todo dado mostra a sua idade ("atualizado há 40 s"), e dispositivo sem sinal aparece em cinza tracejado.
5. O mapa de calor aparece rotulado como estimativa, e os marcadores seguem como a fonte principal da informação.
6. Sem internet, o painel mostra o último estado em cache com a hora e avisa em uma faixa fixa.
7. Português, WCAG 2.1 AA, alvos de toque de 48 px no celular e 40 px no desktop, e modo escuro automático.

**Inventário de telas**

| ID | Tela | Papel mínimo | Fase | Conteúdo principal |
| --- | --- | --- | --- | --- |
| W1 | Login | todos | 1 | Redirecionamento OpenID Connect, segundo fator para administradores e escolha do inquilino |
| W2 | Mapa operacional | leitor | 1 | Sites, áreas e dispositivos por severidade, mapa de calor, chip de resumo, filtros por domínio e severidade e lista de alarmes ao vivo |
| W3 | Detalhe do dispositivo | leitor | 1 | Valor atual por grandeza, gráfico com faixas de limiar e seletor de 6 h, 24 h, 7 d e 30 d, alarmes do dispositivo, último contato e bateria |
| W4 | Alarmes | operador | 1 | Lista de ativos, reconhecidos e resolvidos, com filtros, ação Reconhecer, notas e linha do tempo |
| W5 | Catálogo de domínios e perfis | gestor | 1 | Domínios e editor de perfil com grandezas, unidades UCUM, faixa, intervalo esperado e expressões derivadas |
| W6 | Locais e áreas | gestor | 1 | Árvore de inquilino, site e área, desenho de polígonos no mapa e importação de GeoJSON |
| W7 | Dispositivos | integrador | 1 | Lista com filtros por estado, perfil e etiqueta; cadastro em 3 passos (local, perfil e atributos, credenciais mostradas uma única vez); revogação |
| W8 | Regras | gestor | 1 | Lista e editor de regras (condição, duração, taxa, ausência, área e ações), com teste sobre uma amostra e escolha de escopo central ou borda |
| W9 | Nós de borda | gestor | 1 | Estado, versão, última sincronização, tamanho da fila e espaço livre, com destaque para nó sem sincronizar |
| W10 | Sandbox e validador | integrador | 1 | Cola uma mensagem, valida contra o esquema, mostra os erros por campo e liga ao kit do integrador |
| W11 | Canais de notificação | gestor | 1 | Destinatários, e-mail e Telegram, e janela de supressão |
| W12 | Página pública | público | 1 | Situação por área com dados anonimizados, mapa simplificado e aviso de informação complementar |
| W13 | Usuários e papéis | administrador | 1 | Convites, papéis e inquilinos, apoiados no Keycloak |
| W14 | Saúde da plataforma | administrador | 2 | Métricas de ingestão, latência e filas (Grafana embutido) |
| W15 | Painéis configuráveis | gestor | 2 | Painéis montados sem programar (Grafana embutido) |
| W16 | Auditoria e chaves de API | gestor | 2 | Trilha de auditoria, emissão e revogação de chaves |

O Claude Design recebe este inventário junto com os princípios e as telas C2 a C4 e G3 a G4 do PRD v1, que viram W2, W3 e W4.

**Estado do design (22/10).** O Lote 1 (W2, W3, W4 e W12) foi desenhado e revisado, com seis correções pendentes no Claude Design. Entram na lista oficial de componentes: MapControls, ClusterMarker, Tabs, PublicHeader e AreaStatusRow. Os lotes 2 e 3 (W1, W5 a W11 e W13) seguem em paralelo ao backend.

**Painel no MVP (ROADMAP, 22/10).** Para o prazo de 30/11, o MVP implementa W1, W2, W3, W4, W7 e W12. As telas W5, W6, W8, W9, W10, W11 e W13 viram API, seeds por script ou console do Keycloak e passam à fase 2; por isso RF-EDG-06 e RF-INT-06 são atendidos por API e métricas, sem tela.

## 14. Estratégia de testes (TDD), qualidade e entrega

O desenvolvimento com o Claude Code segue o ciclo vermelho, verde e refatoração, e os contratos (JSON Schema, OpenAPI e AsyncAPI) são escritos antes do código que os implementa.

| Camada | Tipo de teste | Ferramenta sugerida | Foco |
| --- | --- | --- | --- |
| Domínio compartilhado (pipeline, regras, alarmes) | Unitário puro | Jest | Duração, taxa, histerese, dados atrasados, expressões derivadas, ciclo do alarme; 100% dos ramos do motor |
| Contratos | Contrato | Ajv e validadores de OpenAPI e AsyncAPI | Exemplos válidos e inválidos de cada versão do esquema |
| Serviços NestJS | Unitário com mocks | Jest e @nestjs/testing | Casos de uso e estratégias de ação |
| Persistência | Integração | Jest com Testcontainers (PostgreSQL com TimescaleDB e PostGIS) | Idempotência, consultas espaciais e isolamento entre inquilinos |
| Broker | Integração | Testcontainers com Mosquitto | TLS, ACL por dispositivo e credencial revogada |
| API REST | E2E | Supertest | Papéis, paginação padronizada e erros |
| Tempo real | E2E | Cliente WebSocket | Evento em até 2 s após a ingestão |
| Borda | Integração e caos | Compose com tc, netem e encerramento forçado | Link cortado, queda de energia e sincronização sem duplicatas |
| Carga | Carga | k6 e gerador MQTT | RNF-01 e RNF-02 |
| Painel web | Componente, E2E e acessibilidade | Testing Library, Playwright, axe e Lighthouse | Telas W2 a W4 e os fluxos principais |
| Integração em três linguagens | E2E | Compose com os três clientes | Cada cliente publica e a medição aparece na API |

**Definição de pronto**

- Teste escrito antes do código e visto falhando.
- Cobertura mínima de 70% no núcleo (RNF-15), com meta interna de 80% e 100% dos ramos do motor de regras.
- Lint e análise estática sem falha crítica, e CI verde.
- Contratos validados no pipeline e migrações versionadas.
- Decisão de arquitetura nova registrada em ADR.
- Mudanças aditivas: o que já funciona só é alterado quando o prompt de handoff pedir, sempre com referência explícita ao componente.

**Entrega em trilhas**

| Trilha | Conteúdo | Depende de |
| --- | --- | --- |
| T0 · Fundação | Monorepo, Compose, CI, esquemas e contratos | Nenhuma |
| T1 · Núcleo central | Ingestão, catálogo, dados, motor de regras, alarmes e API | T0 |
| T2 · Borda | Nó, fila, sincronização e regras locais | Pipeline de T1 |
| T3 · Segurança e observabilidade | Keycloak, ACL, isolamento, métricas e logs | T0, em paralelo com T1 |
| T4 · Painel web | Design no Claude Design e implementação das telas W1 a W13 | Contrato da API de T1 (mocks por OpenAPI até lá) |
| T5 · Integrações e demonstrações | Pacote de alagamento, fazenda simulada, três linguagens, sandbox e kit | T1 e T2 |
| T6 · Homologação | Carga, teste de 72 h e evidências dos critérios de aceite | Todas |

O detalhamento de fases, entregas e critérios de aceite por trilha fica para o ROADMAP.

## 15. Riscos e mitigações

O maior risco é o tamanho do escopo diante do prazo, e a maioria das mitigações trata disso com entregas em fatias e reaproveitamento de componentes prontos.

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Escopo grande (41 requisitos funcionais no MVP e 18 não funcionais) | MVP incompleto na entrega | Fatias verticais com demonstração a cada fase, reaproveitamento de Keycloak, Traefik e Grafana, e corte combinado no ROADMAP |
| Prisma e extensões do PostgreSQL | Retrabalho de migrações | ADR-001, SQL versionado à parte e testes de integração com Testcontainers |
| Teste de 72 h descoberto só no fim | Falha tardia na borda | Versões curtas do teste (1 h e 6 h) desde cedo e execução real antes da apresentação |
| Carga de 1.000 mensagens por segundo | Gargalo no pipeline ou no banco | Gravação em lote na hipertabela, Redis para deduplicação e teste de carga desde a primeira versão do pipeline |
| Complexidade do Keycloak e do isolamento por inquilino | Atraso em segurança | Realm versionado como código, começar com dois inquilinos e testar o isolamento rota a rota |
| Vazamento de dados entre inquilinos | Falha crítica | Row level security, tenantId no token e teste automatizado de isolamento |
| Três linguagens, incluindo C++ | Tempo gasto em firmware | Cliente C++ em Linux com biblioteca MQTT genérica; firmware ESP32 só se sobrar tempo |
| Ausência de hardware real | Dúvida sobre a validade das demonstrações | Simuladores com cenários realistas, especificação do nó documentada e contrato estável |
| Custos recorrentes (SMS, nuvem) | Gasto inesperado | MVP com e-mail e Telegram e tudo em Docker local; SMS só na fase 2, depois de avaliar o custo |
| Dados pessoais (LGPD) | Exposição indevida | Nenhum dado pessoal nas mensagens, lista de campos públicos revisada e dados abertos anonimizados |
| Falso negativo ou falso positivo no alagamento | Perda de confiança no alerta | Histerese, validação de faixa, estado Sem sinal visível e aviso de informação complementar |
| Curva de aprendizado de NATS, TimescaleDB e Keycloak | Atraso no início | Prova de conceito curta de cada um no começo da trilha T0 |

## 16. Questões em aberto

Dez decisões precisam de resposta antes de fechar o ROADMAP; cada uma traz a proposta padrão, que vale se nada for dito.

- [ ] O professor definiu o que cada grupo implementa (plataforma inteira ou módulos por grupo) e o formato e a data da entrega final? Proposta: o grupo implementa o MVP da seção 4 por completo.
- [ ] Prazo e equipe (respondido em 22/10): entrega até 30/11, com uma pessoa; o corte do MVP está no ROADMAP.
- [ ] Os oito requisitos puxados da fase 2 para o MVP (seção 4) estão aceitos?
- [ ] Barramento interno: Redis no MVP, como no ROADMAP (revisado em 22/10 para reduzir componentes), ou NATS com JetStream?
- [ ] Painel: Next.js próprio no MVP e Grafana na fase 2 (proposta), ou Grafana desde o início para os painéis?
- [ ] Cenário rural: fazenda simulada com solo, clima e silo (proposta), ou existe um projeto rural real da turma para integrar?
- [ ] Notificações no MVP: e-mail e Telegram, sem custo recorrente (proposta), com SMS só na fase 2?
- [ ] Onde roda a homologação e a apresentação: máquina local ou servidor da universidade, e há um Raspberry Pi para o nó de borda?
- [ ] Nome do produto: a plataforma ainda não tem nome, e "Cota" poderia nomear o pacote de alagamento.
- [ ] Cidade piloto e pontos para o cenário de alagamento.
