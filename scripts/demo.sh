#!/usr/bin/env bash
# Demonstração em sala (docs/APRESENTACAO.md). Mostra um menu com todos os passos do roteiro,
# na ordem, e roda o escolhido mostrando o comando antes.
#
# Uso:
#   ./scripts/demo.sh            menu interativo
#   ./scripts/demo.sh 4.3        roda um passo direto
#   ./scripts/demo.sh api        core-api em primeiro plano (Terminal 1)
#   ./scripts/demo.sh painel     painel Next.js em primeiro plano (Terminal 2)
#   ./scripts/demo.sh mqtt       assinante do tópico de alertas (Terminal 4)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

API=http://localhost:3001/api/v1
TENANT=defesa-civil

if [ -t 1 ]; then
  B=$'\e[1m'; DIM=$'\e[2m'; CY=$'\e[36m'; GR=$'\e[32m'; YE=$'\e[33m'; RE=$'\e[31m'; R=$'\e[0m'
else
  B=''; DIM=''; CY=''; GR=''; YE=''; RE=''; R=''
fi

# Lê uma variável do .env sem executar o arquivo.
env_value() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }

title() { printf '\n%s== %s ==%s\n' "$B$CY" "$1" "$R"; }
note() { printf '%s%s%s\n' "$DIM" "$1" "$R"; }
warn() { printf '%s%s%s\n' "$YE" "$1" "$R"; }
show() { printf '%s$ %s%s\n' "$GR" "$1" "$R"; }

# Mostra o comando e roda.
run() {
  show "$1"
  eval "$1"
}

confirm() {
  local answer
  read -r -p "${YE}$1 [s/N] ${R}" answer
  [[ "$answer" =~ ^[sS]$ ]]
}

# Atalhos do roteiro (os mesmos da seção 2.2 do guia).
api() { curl -s -H "X-Tenant: $TENANT" -H 'Content-Type: application/json' "$@"; }
pub() {
  pnpm --silent --filter @iot/simulators basic-publisher --modo mqtt -i 1 --espera-ms 300 "$@" 2>&1 |
    grep publicadas
}
metr() {
  curl -s localhost:3001/metrics |
    grep -E "^(ingestao_mensagens_total|alarmes_|regras_latencia_abertura_alarme_segundos_(count|sum))"
}
device_id() { api "$API/dispositivos" | jq -r '.itens[0].id'; }
# Alarme ainda aberto: primeiro o reconhecido (para resolver), depois o ativo.
open_alarm() {
  local id
  id=$(api "$API/alarmes?estado=reconhecido" | jq -r '.itens[0].id // empty')
  [ -n "$id" ] || id=$(api "$API/alarmes?estado=ativo" | jq -r '.itens[0].id // empty')
  printf '%s' "$id"
}
api_up() { curl -s -m 2 localhost:3001/health >/dev/null; }
require_api() {
  if ! api_up; then
    warn "O core-api não responde em localhost:3001. Suba com: ./scripts/demo.sh api (em outro terminal)."
    return 1
  fi
}

# ---------------------------------------------------------------- preparação

step_p1() {
  title "Subir do zero (compose limpo, migração)"
  warn "Isto apaga os volumes do compose (regras, alarmes e medições de ensaios anteriores)."
  confirm "Continuar?" || return 0
  [ -f .env ] || run "cp .env.example .env"
  run "docker compose down -v"
  run "docker compose up -d --wait"
  run "pnpm --filter @iot/core-api db:migrate"
  note "Agora suba o core-api em outro terminal (./scripts/demo.sh api) e rode o passo p2."
}

step_p2() {
  title "Cadastro de desenvolvimento (seed)"
  require_api || return 0
  run "pnpm seed:dev"
}

step_p3() {
  title "Ensaio rápido (sem criar regra)"
  require_api || return 0
  run "api \"\$API/regras\" | jq '.total'"
  run "pub --n 3 --valor-inicial 200 --passo=-1"
  run "metr"
  note "Depois do ensaio, reinicie o core-api (Ctrl+C e ./scripts/demo.sh api) para zerar as métricas."
}

step_p4() {
  title "Situação dos serviços"
  run "docker compose ps --format 'table {{.Service}}\t{{.Status}}'"
  if api_up; then printf '%score-api: no ar%s\n' "$GR" "$R"; else printf '%score-api: fora%s\n' "$RE" "$R"; fi
  if curl -s -m 2 localhost:3000 >/dev/null; then printf '%spainel: no ar%s\n' "$GR" "$R"; else printf '%spainel: fora%s\n' "$DIM" "$R"; fi
}

# ---------------------------------------------------------------- bloco 3

step_3_1() {
  title "Bloco 3 · O sensor cadastrado"
  require_api || return 0
  run "api \"\$API/dispositivos\" | jq '.itens[0] | {slug, estado, perfil_id, area_id}'"
}

step_3_2() {
  title "Bloco 3 · Publicar 3 leituras por MQTT e ver o último estado"
  require_api || return 0
  run "pub --n 3 --valor-inicial 200 --passo=-1"
  sleep 1
  run "D=\$(device_id)"
  run "api \"\$API/dispositivos/\$D/ultimo-estado\" | jq '.grandezas[] | {grandeza, valor, derivada, atrasada}'"
}

# ---------------------------------------------------------------- bloco 4

RULE='{
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
}'

step_4_1() {
  title "Bloco 4 · Criar a regra (limite 150, 3 leituras, saída abaixo de 140)"
  require_api || return 0
  local existing
  existing=$(api "$API/regras?ativa=true" | jq '[.itens[] | select(.nome == "Nível do córrego em alerta")] | length')
  if [ "${existing:-0}" -gt 0 ]; then
    warn "A regra já existe (criá-la de novo faria cada cruzamento abrir dois alarmes)."
    run "api \"\$API/regras?ativa=true\" | jq '.itens[] | {id, versao, nome}'"
    return 0
  fi
  printf '%s%s%s\n' "$DIM" "$RULE" "$R"
  run "api -X POST \"\$API/regras\" -d \"\$RULE\" | jq '{id, versao, nome}'"
}

step_4_2() {
  title "Bloco 4 · Regra fora do contrato é recusada"
  require_api || return 0
  run "api -X POST \"\$API/regras\" -d '{\"nome\":\"sem ações\",\"escopo\":\"central\",\"ativa\":true,\"condicao\":{\"grandeza\":\"nivel_agua\",\"operador\":\">\",\"limite\":1}}' | jq '.detalhes'"
}

step_4_3() {
  title "Bloco 4 · A água sobe (nível de 140 a 165) e o alarme abre"
  require_api || return 0
  run "pub --n 6 --valor-inicial 160 --passo=-5"
  sleep 2
  run "api \"\$API/alarmes?estado=ativo\" | jq '.itens[] | {regra_nome, dispositivo_slug, severidade, estado, ocorrido_em, aberto_em}'"
}

step_4_4() {
  title "Bloco 4 · Métricas (alarmes abertos e latência)"
  require_api || return 0
  run "metr"
}

step_4_5() {
  title "Bloco 4 · Pedido de notificação no barramento (Redis Streams)"
  run "docker compose exec -T redis redis-cli -a \"\$(env_value REDIS_PASSWORD)\" --no-auth-warning XREVRANGE notification.requested + - COUNT 1"
}

step_4_6() {
  title "Bloco 4 · Operador reconhece o alarme"
  require_api || return 0
  run "A=\$(api \"\$API/alarmes?estado=ativo\" | jq -r '.itens[0].id // empty')"
  if [ -z "$A" ]; then warn "Nenhum alarme ativo. Rode o passo 4.3."; return 0; fi
  run "api -X PATCH -H 'X-Ator: operador-ana' \"\$API/alarmes/\$A/reconhecer\" -d '{\"nota\":\"equipe a caminho\"}' | jq '{estado, reconhecido_por, nota_reconhecimento}'"
  note "Reconhecer de novo responde 409 (conflito):"
  run "api -X PATCH -H 'X-Ator: operador-ana' \"\$API/alarmes/\$A/reconhecer\" -d '{}' | jq '{codigo, mensagem}'"
}

step_4_7() {
  title "Bloco 4 · Resolver sem motivo é recusado"
  require_api || return 0
  run "A=\$(open_alarm)"
  if [ -z "$A" ]; then warn "Nenhum alarme aberto. Rode o passo 4.3."; return 0; fi
  run "api -X PATCH -H 'X-Ator: gestor-bruno' \"\$API/alarmes/\$A/resolver\" -d '{}' | jq '.detalhes'"
}

step_4_8() {
  title "Bloco 4 · Gestor resolve com motivo (linha do tempo completa)"
  require_api || return 0
  run "A=\$(open_alarm)"
  if [ -z "$A" ]; then warn "Nenhum alarme aberto. Rode o passo 4.3."; return 0; fi
  run "api -X PATCH -H 'X-Ator: gestor-bruno' \"\$API/alarmes/\$A/resolver\" -d '{\"motivo\":\"água baixou, vistoria feita\"}' | jq '{estado, resolucao, motivo_resolucao, linha_do_tempo}'"
}

step_4_9() {
  title "Bloco 4 (extra) · A água sobe e depois baixa: resolução automática"
  require_api || return 0
  run "pub --n 6 --valor-inicial 160 --passo=-5"
  sleep 2
  note "Distância de 170 a 190 cm: nível de 130 a 110, abaixo da saída (140)."
  run "pub --n 3 --valor-inicial 170 --passo=10"
  sleep 2
  run "api \"\$API/alarmes?estado=resolvido&limite=1\" | jq '.itens[0] | {estado, resolucao, ocorrido_em, resolvido_em}'"
}

# ---------------------------------------------------------------- bloco 5

step_5_1() {
  title "Bloco 5 · A central caiu: o sensor continua publicando"
  if api_up; then
    warn "O core-api ainda está no ar. Dê Ctrl+C no terminal dele (Terminal 1) e rode este passo de novo."
    return 0
  fi
  run "curl -s -m 2 localhost:3001/health || echo 'API fora'"
  run "pub --n 10 --valor-inicial 200 --passo=-1"
  note "Agora suba o core-api de novo (./scripts/demo.sh api) e rode o passo 5.2."
}

step_5_2() {
  title "Bloco 5 · A central voltou: as 10 mensagens foram gravadas"
  require_api || return 0
  sleep 2
  run "metr"
}

step_5_3() {
  title "Bloco 5 · O banco caiu durante a publicação"
  require_api || return 0
  run "docker compose stop postgres"
  run "pub --n 10 --valor-inicial 190 --passo=-1"
  sleep 3
  run "metr"
  note "As tentativas aparecem como desfecho=\"pendente\". Rode o passo 5.4 para o banco voltar."
}

step_5_4() {
  title "Bloco 5 · O banco voltou: as pendentes viram gravadas"
  run "docker compose start postgres"
  note "Esperando o core-api gravar as pendentes (espera crescente de 500 ms a 30 s)..."
  # Até 60 s: termina quando as aceitas ficam 8 s sem mudar.
  local accepted last="" stable=0 waited=0
  while [ "$waited" -lt 60 ]; do
    accepted=$(curl -s localhost:3001/metrics | grep 'desfecho="aceita"' | awk '{print $2}')
    if [ -n "$accepted" ] && [ "$accepted" = "$last" ]; then stable=$((stable + 1)); else stable=0; fi
    last="$accepted"
    [ "$stable" -ge 4 ] && break
    printf '%s  aceitas até agora: %s%s\n' "$DIM" "${accepted:-0}" "$R"
    sleep 2
    waited=$((waited + 2))
  done
  run "metr"
}

# ---------------------------------------------------------------- plano B e encerramento

step_b1() {
  title "Plano B · Testes de regras e alarmes no core-api (contêineres próprios, cerca de 25 s)"
  run "pnpm --filter @iot/core-api test test/rules"
}

step_b2() {
  title "Plano B · Testes do motor de regras puro (domínio)"
  run "pnpm --filter @iot/domain test test/rules"
}

step_f1() {
  title "Encerrar mantendo os dados"
  run "docker compose down"
}

step_f2() {
  title "Encerrar e apagar tudo"
  confirm "Apagar os volumes do compose?" || return 0
  run "docker compose down -v"
}

# ---------------------------------------------------------------- processos em primeiro plano

fg_api() {
  title "core-api (Ctrl+C derruba a central, como no bloco 5)"
  run "pnpm --filter @iot/core-api start:dev"
}

fg_painel() {
  title "Painel Next.js (esqueleto) em http://localhost:3000"
  run "pnpm --filter @iot/panel dev"
}

fg_mqtt() {
  title "Assinante MQTT do tópico de alertas (ação publicar_topico)"
  run "mosquitto_sub -h localhost -u \"\$(env_value MQTT_DEV_USERNAME)\" -P \"\$(env_value MQTT_DEV_PASSWORD)\" -t 'defesa-civil/alertas' -v"
}

# ---------------------------------------------------------------- menu

MENU=(
  "#Preparação (antes da aula)"
  "p1|Subir do zero: compose limpo e migração|step_p1"
  "p2|Cadastro de desenvolvimento (seed:dev)|step_p2"
  "p3|Ensaio rápido|step_p3"
  "p4|Situação dos serviços|step_p4"
  "#Bloco 3 · Catálogo e ingestão (Pessoa A fala)"
  "3.1|Ver o sensor cadastrado|step_3_1"
  "3.2|Publicar 3 leituras e ver o último estado|step_3_2"
  "#Bloco 4 · Regras, alarmes e ações (Pessoa B fala)"
  "4.1|Criar a regra|step_4_1"
  "4.2|Regra fora do contrato é recusada|step_4_2"
  "4.3|A água sobe e o alarme abre|step_4_3"
  "4.4|Métricas|step_4_4"
  "4.5|Pedido de notificação no barramento|step_4_5"
  "4.6|Reconhecer o alarme|step_4_6"
  "4.7|Resolver sem motivo (recusado)|step_4_7"
  "4.8|Resolver com motivo|step_4_8"
  "4.9|Extra: resolução automática quando a água baixa|step_4_9"
  "#Bloco 5 · Reconexões e falhas (Pessoa A fala)"
  "5.1|Central caiu: publicar com o core-api fora|step_5_1"
  "5.2|Central voltou: conferir as mensagens|step_5_2"
  "5.3|Derrubar o banco e publicar|step_5_3"
  "5.4|Banco voltou: conferir as pendentes|step_5_4"
  "#Plano B e encerramento"
  "b1|Testes de regras e alarmes (core-api)|step_b1"
  "b2|Testes do motor puro (domínio)|step_b2"
  "f1|Encerrar mantendo os dados|step_f1"
  "f2|Encerrar e apagar tudo|step_f2"
)

print_menu() {
  printf '\n%sPlataforma IoT Integrada · demonstração%s\n' "$B" "$R"
  note "Em outros terminais: ./scripts/demo.sh api | painel | mqtt"
  local item key label
  for item in "${MENU[@]}"; do
    if [[ "$item" == \#* ]]; then
      printf '\n%s%s%s\n' "$B" "${item#\#}" "$R"
    else
      IFS='|' read -r key label _ <<<"$item"
      printf '  %s%-4s%s %s\n' "$CY" "$key" "$R" "$label"
    fi
  done
  printf '\n  %s%-4s%s %s\n' "$CY" "q" "$R" "Sair"
}

dispatch() {
  local choice="$1" item key fn
  case "$choice" in
    api) fg_api; return ;;
    painel) fg_painel; return ;;
    mqtt) fg_mqtt; return ;;
  esac
  for item in "${MENU[@]}"; do
    [[ "$item" == \#* ]] && continue
    IFS='|' read -r key _ fn <<<"$item"
    if [ "$key" = "$choice" ]; then
      "$fn"
      return
    fi
  done
  warn "Opção desconhecida: $choice"
}

check_tools() {
  local tool missing=()
  for tool in docker pnpm curl jq; do command -v "$tool" >/dev/null || missing+=("$tool"); done
  if [ ${#missing[@]} -gt 0 ]; then
    printf '%sFaltam ferramentas: %s%s\n' "$RE" "${missing[*]}" "$R"
    exit 1
  fi
}

check_tools
if [ $# -gt 0 ]; then
  dispatch "$1"
  exit 0
fi

while true; do
  print_menu
  read -r -p $'\nPasso: ' choice || exit 0
  [ "$choice" = "q" ] && exit 0
  [ -z "$choice" ] && continue
  dispatch "$choice"
  read -r -p $'\n'"${DIM}Enter para voltar ao menu${R}" _ || exit 0
done
