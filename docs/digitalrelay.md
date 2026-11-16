# DigitalRelay

Aplicativo do Eclipse que **simula o relé SEL-751** a partir de um arquivo **`.rdb`** do AcSELerator QuickSet. Rota:
`#/digitalrelay`. É um **MVP**: reproduz o comportamento funcional descrito pelos ajustes, **não executa o firmware** do relé.

Este documento descreve o funcionamento do aplicativo de ponta a ponta. Documentos complementares:

- [`logica-simulada.md`](logica-simulada.md) – premissas, aproximações e limitações da simulação (referência detalhada);
- [`api.md`](api.md) – endpoints REST do backend;
- [`arquitetura.md`](arquitetura.md) – módulos do backend e do frontend e o ciclo de varredura;
- [`roadmap-sel751-alimentador-v1.24.md`](roadmap-sel751-alimentador-v1.24.md) – descrição da lógica do ajuste "Alimentador v1.24", usado nos testes.

## Visão geral da arquitetura

```
 arquivo .rdb ──upload──▶  backend (FastAPI)                       frontend (React)
                           rdb.py → settings.py ─▶ RelayEngine ◀──polling/comandos──▶ telas
                                                   (varredura 4 ms)
```

- O **backend** (`backend/app`, Python/FastAPI) lê o `.rdb`, mantém **sessões** de simulação em memória e roda o laço de tempo real
  (varredura a cada 4 ms; ver [Tempo e velocidade](#tempo-e-velocidade)). Também serve o frontend compilado.
- O **frontend** (`frontend/src`, React) consulta o estado por **polling**: `/panel` a 10 Hz e `/state`, `/dnp`, `/ser` a 2–2,5 Hz,
  esses três somente enquanto a aba correspondente está aberta. Comandos (botões, entradas, parâmetros) vão por `POST`.
- Os `.rdb` e arquivos de ajuste são **dados não confiáveis**: são apenas lidos (parseados), nunca executados. O upload é limitado
  a 100 MB e há no máximo 8 sessões simultâneas.

## Fluxo de uso

1. **Carregar o `.rdb`:** na tela inicial arraste o arquivo (ou clique para escolher). O backend abre o contêiner OLE e lista os
   ajustes (relés) que ele contém. É possível filtrar a lista, expandir cada ajuste para ver os arquivos de texto
   (`set_*.txt`, `Misc/*.txt`), abrir um arquivo em uma janela de pré-visualização e **baixar um `.zip`** com os arquivos
   do ajuste.
2. **Carregar no simulador:** o botão do ajuste desejado cria a sessão de simulação. Se já havia uma sessão, ela é encerrada.
3. **Simular:** use as abas descritas abaixo. O botão **Trocar ajuste** volta à lista (há um link para retornar ao simulador
   em execução).
4. A sessão e o último upload são lembrados no navegador (`localStorage`, chave `sel751.sim`): ao recarregar a página o simulador reabre
   direto, enquanto o backend não for reiniciado. Se o backend foi reiniciado, a interface avisa que a sessão foi encerrada e
   pede para carregar o ajuste de novo.

## Barra superior

Mostra o relé e o arquivo carregados e, durante a simulação:

- chips de estado: **DJ FECHADO/ABERTO** (posição do disjuntor), **Grupo** de ajustes ativo, estado do **79** (religamento) e **TRIP**
  quando o disparo está ativo;
- o **relógio** da simulação (formato conforme as Configurações);
- **Pausar/Continuar**; **Velocidade** (0,5×, 1×, 2×, 5×, 10×); **Reiniciar** (reinicia o relé com os ajustes originais);
  **Trocar ajuste**;
- a engrenagem **⚙** abre as Configurações (também disponível fora da simulação).

## Abas

### Painel frontal

Réplica do frontal do relé (imagem de referência em `assets/relay-front-reference.png`), ao lado da **tela inicial da simulação**.

**Frontal:**

- **Display 2×16** com os pontos `DPnn` do ajuste: duas linhas por tela, rotação automática entre as telas; linhas com mais de
  16 colunas rolam. O texto preenche toda a área do display. Pontos booleanos só aparecem quando há texto para o estado atual.
  **ENT** abre um menu simplificado (**MEDIÇÃO / ALVOS / STATUS**) navegado por ▲ ▼ ◀ ▶ e **ESC**. O menu completo do
  relé (ajustes, eventos, comandos) não é reproduzido.
- **LEDs de alvo** (`Tnn_LED`): cor (`R` vermelho, `G` verde, `A` âmbar, `O` apagado) e retenção conforme o ajuste; o rótulo vem dos
  comentários (`#`) das equações. **TARGET RESET** limpa os LEDs retidos (e o LED TRIP se não há `TRIP`); `RSTLED = Y` limpa os alvos antigos
  a cada novo disparo.
- **Botões PB1–PB8** (PB1–PB4 na coluna direita, PB5–PB8 na esquerda), cada um com seus LEDs (`PBnA/B_LED`, cor do par `AO` = ligado,
  desligado). O bit `PBn` **sobe ao pressionar e desce ao soltar** (a lógica usa `R_TRIG`/`F_TRIG`). O texto grande no
  centro de cada botão é editável (botão **✎ Editar texto dos botões**, com **Restaurar padrão**); fica só no navegador, por ajuste
  (`sel751.pbtitles.<relay_id>`) e não afeta a lógica.

**Tela inicial da simulação (mesa de teste):**

- **Disjuntor (campo):** estado (aberto/fechado/abrindo/fechando), contador de operações, botões **Abrir (campo)** e **Fechar
  (campo)** (movem o disjuntor físico, qualquer que seja o modo da entrada 52A), e os **tempos de abertura e de fechamento** (ms; padrão 60 e 100).
  Aberturas ≥ 100/120/140 ms acionam os alarmes de tempo de abertura (níveis 1–3) do ajuste v1.24.
- **Medição (valores injetados):** tabela de correntes, tensões, frequência e P/Q/S/FP, em módulo/ângulo, primário e secundário. Contém:
  - a chave **Injeção analógica: LIGADA/DESLIGADA** (a simulação **inicia desligada**: o relé enxerga corrente, tensão e potência zero);
  - o botão **Abrir janela de injeção ↗**;
  - a opção **Desligar a injeção analógica quando uma saída digital atuar**, com a **seleção das saídas** (nenhuma marcada = qualquer saída).
    Se a saída que atuou é a bobina de abertura e o disjuntor ainda está fechado, o corte espera o disjuntor abrir (a corrente persiste durante o
    tempo de abertura). O usuário religa a injeção pela chave.
- **Entradas digitais:** cada entrada é um botão que alterna o estado. A opção **Simular o estado do disjuntor automaticamente** faz a
  entrada do 52A (normalmente `IN101`) acompanhar as bobinas (alternar a entrada move o disjuntor); desligada, a entrada é livre
  (permite testar 52A divergente do estado físico). O estado inicial de cada entrada é deduzido de ALIAS/DP ("normal"). Entradas com
  filtro de *debounce* (`INxxxD`) mostram "aguardando o filtro".
- **Saídas digitais:** ATUADA/REPOUSO de cada `OUTxxx`, indicando a função de bobina (abertura/fechamento) deduzida.
- **Auxiliares do relé:** falha de hardware (`HALARM`), links Ethernet A/B, SNTP principal/backup e **tensão CC**.

### Variáveis internas

Estado interno completo, com filtro por nome, comentário ou equação, e a opção **Só ativos (=1)**. Seções: Disparo e fechamento;
Elementos de proteção (com pickup, múltiplo, tempo previsto e reset dos 51); Religamento automático (79); Entradas digitais; Saídas
digitais; Latches (LT); Variáveis SELogic temporizadas (SV); Contadores e variáveis matemáticas; Grandezas analógicas; **Relay Word** (todos os
bits). Há um alerta quando o ajuste usa **bits que o simulador não conhece** (valem 0).

### DNP3

Mostra o que um mestre DNP3 veria e envia comandos. Não há pilha DNP3 em rede. Sub-abas: **Comandos (BO)**, **Entradas binárias (BI)**,
**Entradas analógicas (AI)** e **Eventos**; filtro, "Mostrar não mapeados" e seletor de **Mapa** (`D1`–`D3`).

- **BO:** `Select → Operate` (seleção válida por 10 s simulados) e `Direct Operate`; códigos `Pulse On`, `Latch On` e `Latch Off`. `Pulse On`/`Latch On` acionam o
  bit por **um ciclo** (RB/OC/CC são pulsos); `Latch Off` → `NOT_SUPPORTED`. A lógica do relé decide se o comando é aceito (ex.: modo Local/Remoto).
  O resultado de cada comando e um registro (log) são mostrados.
- **BI:** valor do bit e horário da última mudança; mudança de estado gera evento.
- **AI:** `valor × escala` (inteiro de 16 bits, saturação sinalizada como `OVER_RANGE`); evento quando a variação excede a banda morta.
- **Eventos:** lista (mais recentes primeiro) com horário, tipo, ponto, bit/grandeza e valor; botão **Limpar eventos** (limpa também a fila
  do backend; a numeração continua).
- As colunas das tabelas são **redimensionáveis** (arraste a borda do cabeçalho; clique duplo restaura; larguras salvas no navegador).

### Ajustes

Consulta e edição dos arquivos de ajuste da sessão, por classe (`G`, `1…4`, `L1…L4`, `F`, `R`, `D1…D3`), com filtro e a opção de ver o **texto original**.
Editar um valor e pressionar **Enter** recompila a lógica imediatamente (`OFF` desabilita um pickup). **As alterações valem só para a sessão**: o `.rdb`
original não é modificado. Os padrões de teste vêm com todos os pickups em `OFF`; para ver a proteção atuar, habilite-os aqui (ex.: `50P1P`, `51P1P`).

### Eventos (SER)

Registro sequencial de eventos (Sequential Events Recorder): mudanças dos bits das listas `SER1`–`SER4` do relatório (`set_R`), com texto
de estado (ALIAS), filtro e botão **Limpar**. Colunas redimensionáveis (igual ao DNP3).

## Janela de injeção

Pop-up da própria aplicação (`window.open` em `#/injecao/<sessão>`, sem o header do Eclipse). **Só edita valores** (não há controle de falta
na interface):

- **Correntes** e **tensões fase-neutro**: módulo e ângulo por fase, e **frequência**. Botões **Equilibrar a partir de A**.
- Modo **Primário/Secundário**: os valores são guardados no backend em grandezas **primárias**; no modo secundário a interface
  converte com `CTR` (corrente) e `PTR` (tensão). O modo escolhido fica no navegador (`sel751.inject.mode`).
- **Diagramas fasoriais** de corrente e tensão e **componentes de sequência** (calculadas na interface a partir dos valores inseridos).
- **Valores vistos pelo relé** (incluem a posição do disjuntor e o estado da injeção analógica). Com o disjuntor aberto o relé
  enxerga corrente zero; as tensões continuam aplicadas.

## Configurações (engrenagem ⚙)

- **Estampas de tempo:** mostrar o **tempo da simulação** (para quando pausa e segue a velocidade) ou o **horário real** do computador
  no instante do evento. Vale para SER, eventos e comandos DNP3 e "última mudança" dos pontos.
- **Formato do tempo da simulação:** segundos (`12,34 s`) ou `hh:mm:ss:mmm`.
- As preferências ficam no navegador (`sel751.prefs`).

## Modelo de simulação (resumo)

Detalhes e justificativas: [`logica-simulada.md`](logica-simulada.md).

**Ciclo de varredura (`RelayEngine.step(dt)`)**, nesta ordem: 1 evento da fila (botão, pulso de bit remoto/OC/CC, target reset)
→ entradas digitais (com *debounce*) e grandezas analógicas → elementos de proteção → `TR → TRIP` → religamento 79 → `CL → CLOSE` →
lógica do usuário **SV → SC → MV → LT → OUT** → disjuntor → seleção de grupo (`SS1..SS4`, `TGR`) → LEDs, SER e DNP3.
Cada equação SELogic é avaliada **uma vez por ciclo, sem curto-circuito** (as bordas `R_TRIG/F_TRIG` dependem disso).

### O que é lido do ajuste

Grupos `1…4` (TC/TP, pickups, `TR`, `ULTRIP`, `TDURD`, `52A`, `CL`, `ULCL`, `CFD`, religamento), lógica `L1…L4` (latches, SV com `PU/DO`, contadores,
variáveis matemáticas, saídas), globais `G` (troca de grupo, filtros das entradas, limites CC, `FNOM`), frontal `F` (LEDs, display), relatório `R`
(listas SER, ALIAS) e mapas `D1…D3` (DNP3). Lidos e **ignorados**: Modbus, Mirrored Bits, EtherNet/IP, IEC 103, portas e touchscreen.

### Proteção implementada

- **50** (instantâneo/tempo definido): `50P1–4`, `50N1–4`, `50G1–4`, `50Q1–4`; bits `50xnP` (partida, queda em 95 %) e `50xnT` (atuação após `50xnD`;
  `OFF` desabilita), bits por fase `50A/B/C1P` e `50A/B/C2P`, `ORED50T`.
- **51** (temporizado): fase individual, máxima de fase, `51Q`, neutro e terra; curvas **U1–U5, C1–C5, E1–E3** (equações do manual), `51SAT`, tempo
  constante `CT`, piso `MR`, reset em 1 ciclo ou eletromecânico, `ORED51T`.
- **27/59/81D** de tempo definido.
- Grandezas: `IMAX`, `IA/IB/IC`, `IN` (soma fasorial ÷ `CTRN`), `IG` (÷ `CTR`), `3I2`; pickups em A **secundários**.
- **Não implementados:** direcional (67), 49, 46, 50INC, HIF, 52ABF interno, 25, 78, 55, `E27I/E59I`, demanda, `79SKP/79SEQ/79DLS/79CLSD`.

### TRIP, CLOSE e religamento

`TRIP` mantém `TDURD` e só cai com `ULTRIP` e `TR` falso. `CLOSE` cai ao fechar (`52A`), por `ULCL` ou após `CFD` (gera `CF`). O **79** percorre `RS → CY → LO`:
tempo morto `79OIn` com o disjuntor aberto e sem `79STL`; reset `79RSD`; `79DTL` leva a bloqueio; `SH0..SH4` indicam o número de religamentos; abertura por
comando (`SV03T`) leva o 79 a `LO`.

### Disjuntor e campo

As bobinas de abertura e de fechamento são **deduzidas** das expressões/comentários das saídas (`TRIP`/"ABERTURA" × `CLOSE`/"FECHAMENTO"); a posição
alimenta a entrada do 52A (deduzida da equação `52A`). A falta (`POST/DELETE /fault`, tipos AG BG CG AB BC CA ABC, permanente ou transitória) existe na API e
nos testes, mas **não tem controle na interface** (decisão de projeto).

### Medição

Correntes em A, tensões em V, P/Q em kW/kvar, energias em MWh/Mvarh (acumulam no tempo simulado). `FIA…FIN` guardam as correntes do último disparo; `FLOC` vale 0.

### Tempo e velocidade

A varredura roda a cada **4 ms** de tempo real (`BASE_DT`), com `dt = 0,004 × velocidade`. A 1× a resolução é de 4 ms; a 10×, 40 ms. Os alarmes de tempo
de abertura (100/120/140 ms) são mais confiáveis em 1×.

## Persistência no navegador (`localStorage`)

| Chave | Conteúdo |
|---|---|
| `sel751.sim` | `{sid, uid}`: sessão e upload atuais |
| `sel751.prefs` | Preferências de estampa de tempo |
| `sel751.inject.mode` | Primário/secundário da janela de injeção |
| `sel751.pbtitles.<relay_id>` | Textos centrais dos botões PB1–PB8 |
| `sel751.colwidths` | Larguras de colunas (DNP3 e SER) |

## Testes (`backend/tests`)

`conftest.py`, `test_selogic.py`, `test_rdb_settings.py`, `test_engine_feeder.py` (cenários do ajuste Alimentador v1.24), `test_api.py` (com upload real) e
`test_overcurrent.py` (50/51 com ajuste sintético). Os testes que dependem de `Padrões SEL-751.rdb` (na raiz) são ignorados se o arquivo não existir.

```bash
cd backend
python -m pytest -q
```

## Como executar e verificar

`./run.ps1` (Windows) instala o que faltar, compila o frontend e sobe tudo em http://127.0.0.1:8000. Roteiro rápido de verificação:

1. Carregue o `.rdb` e o ajuste "Alimentador v1.24" e, na aba **Ajustes**, classe `1`, defina `50P1P = 10` (e, para os alarmes de tempo de abertura, `51P1P = 2`).
2. Ligue a **Injeção analógica**, abra a janela de injeção e informe correntes acima do pickup (a falta pode ser aplicada pela API `POST /api/sessions/<sid>/fault`).
3. Observe `TRIP`, a abertura do disjuntor em ~60 ms e o religamento em ~10 s (SER e Variáveis internas).

## Limitações e próximos passos

Não há pilha DNP3 em rede (GOOSE/seletividade lógica só sinalizados), menu completo do display, elementos 67/49/46 e falha de disjuntor interna. Ideias: comparar tempos
com relé real, WebSocket no lugar do polling, DNP3 real (ex.: `opendnp3`) para testar com um mestre externo, e suporte a outros relés do `.rdb` com bobinas/entradas atípicas.
