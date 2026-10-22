# Pacotes de cenário

Cada cenário (por exemplo, o urbano de referência e o rural com nó de borda) entra aqui como configuração: domínio, perfis de dispositivo, regras e painéis, em JSON. O núcleo (`packages/domain` e `apps/core-api/src`) não conhece nenhum cenário; os pacotes são aplicados por seed e pela API (RF-CEN-01, RF-CEN-05, RNF-08).

A pasta fica vazia até a trilha T5. A lista de termos que o núcleo não pode conter está em `config/neutrality/scenario-terms.json`.
