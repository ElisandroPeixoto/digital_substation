# DigitalRelay

Aplicativo do Eclipse que **simula o relé SEL-751** a partir de um arquivo **`.rdb`** do AcSELerator QuickSet. Rota:
`#/digitalrelay`. É um **MVP**: reproduz o comportamento funcional descrito pelos ajustes, **não executa o firmware** do relé.

Este documento descreve o funcionamento do aplicativo de ponta a ponta. Documentos complementares:

- [`funcoes-50-51.md`](funcoes-50-51.md) e [`funcao-direcional-67.md`](funcao-direcional-67.md) – guias didáticos das funções de proteção;
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

- **Disjuntor (campo)** (SEL-751 e SEL-311C): a chave **Simular disjuntor** (`breaker_auto`, padrão ligada) decide se há disjuntor simulado.
  - **Ligada:** estado (aberto/fechado/abrindo/fechando), contador de operações, botões **Abrir (campo)** e **Fechar (campo)**, os
    **tempos de abertura e de fechamento** (ms; padrão 60 e 100) e as **variáveis do disjuntor**:
    **Variáveis de abertura** (`bk_trip`) e **Variáveis de fechamento** (`bk_close`) — bits do Relay Word separados por vírgula ou espaço
    (ex.: `OUT101, TRIP`) — e **Estado do disjuntor (entrada)** (`bk_status`, uma `INxxx`). Campo vazio = automático: as bobinas deduzidas das
    `OUTxxx` e a entrada da equação `52A` (mostradas no campo e na linha "Em uso"). Nome desconhecido é recusado. A entrada de estado acompanha a
    posição (alternar a entrada move o disjuntor).
  - **Desligada:** não há disjuntor: as saídas não movem nada e a entrada de estado fica livre em *Entradas digitais* (permite testar 52A
    divergente). No SystemLab, a posição do disjuntor monitorado deixa de ser sincronizada com o relé.
  Aberturas ≥ 100/120/140 ms acionam os alarmes de tempo de abertura (níveis 1–3) do ajuste v1.24. No SEL-787 (sem este cartão) a chave
  continua em *Entradas digitais*.
- **Medição (valores injetados):** tabela de correntes, tensões, frequência e P/Q/S/FP, em módulo/ângulo, primário e secundário. Contém:
  - a chave **Injeção analógica: LIGADA/DESLIGADA** (a simulação **inicia desligada**: o relé enxerga corrente, tensão e potência zero);
  - o botão **Abrir janela de injeção ↗**;
  - a opção **Desligar a injeção analógica quando uma saída digital atuar**, com a **seleção das saídas** (nenhuma marcada = qualquer saída).
    Se a saída que atuou é a bobina de abertura e o disjuntor ainda está fechado, o corte espera o disjuntor abrir (a corrente persiste durante o
    tempo de abertura). O usuário religa a injeção pela chave.
- **Entradas digitais:** cada entrada é um botão que alterna o estado (a entrada de estado do disjuntor aparece com "· 52A"). O estado inicial
  de cada entrada é deduzido de ALIAS/DP ("normal"). Entradas com filtro de *debounce* (`INxxxD`) mostram "aguardando o filtro".
- **Saídas digitais:** ATUADA/REPOUSO de cada `OUTxxx`, indicando a função de bobina (abertura/fechamento) deduzida.
- **Auxiliares do relé:** falha de hardware (`HALARM`), links Ethernet A/B, SNTP principal/backup e **tensão CC**.

### Variáveis internas

Estado interno completo, com filtro por nome, comentário ou equação, e a opção **Só ativos (=1)**. Seções: Disparo e fechamento;
Elementos de proteção (com pickup, ajuste em valor primário — A × CTR, ou CTRN no neutro e o TC do enrolamento no 787; V × PTR, ou PTRS no VS; Ω × PTR/CTR — e reset dos 51); Religamento automático (79); Entradas digitais; Saídas
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

### Forçar variáveis lógicas

Na aba **Variáveis internas**, o cartão "Forçar variável lógica" e os botões das tabelas (saídas, latches, SV e SVT, contadores SCnn/SCnnQ, matemáticas) fixam o valor da variável, ignorando a lógica, até ser liberada (clique em "FORÇADO = n ✕"). A lógica a jusante enxerga o valor forçado (`engine.force`/`engine.forced`, aplicado a cada elemento no ciclo). Não é persistente: reiniciar o relé libera tudo.

### Carga de arquivos

A tela inicial segue o padrão do app IEC61850: botão **Adicionar arquivo(s)** (um ou vários `.rdb`, ou arrastar para a tela) e um cartão por arquivo com seus ajustes. "＋ Relé" na barra de relés volta a essa tela para instanciar outro relé.

### Textos

Aba ao lado de "Eventos (SER)" para dar **textos personalizados** a entradas, saídas, bits virtuais (**VB**), remotos (**RB**) e, no SEL-2440, de controle (**CB**). Para cada ponto a tabela mostra
a descrição vinda dos ajustes (comentário/ALIAS) e um campo para o seu texto; ele **substitui a descrição no Painel frontal** (chips de entradas, saídas e bits, e balões dos LEDs do SEL-2440).
Vale para o SEL-751 e para o SEL-2440. Os textos ficam só no navegador, **por relé** (`localStorage`, chave `sel751.texts.<relay_id>`) e não alteram a lógica nem o ajuste. Há filtro, "limpar" por linha,
"Limpar todos" e **Adicionar bit** (inclui um VB/RB/CB que não aparece nos ajustes, ex.: `VB040`, para dar um texto e simulá-lo).

### Eventos (SER)

Registro sequencial de eventos (Sequential Events Recorder): mudanças dos bits das listas `SER1`–`SER4` do relatório (`set_R`), com texto
de estado (ALIAS), filtro e botão **Limpar**. Colunas redimensionáveis (igual ao DNP3).


## SEL-2440 (DPAC)

Além do SEL-751, o DigitalRelay simula o **SEL-2440** (*Discrete Programmable Automation Controller*): um controlador de entradas/saídas digitais com lógica SELogic, **sem proteções**
e sem entradas analógicas. O modelo é identificado pelo `RELAYTYPE=SEL-2440` do ajuste (`engine.model == "2440"`); a lógica usa as mesmas variáveis do 751 (SV com PU/DO, latches LT,
contadores SC, variáveis matemáticas MV, saídas OUT, SER, mapas DNP3).

**Diferenças em relação ao 751**

| | SEL-751 | SEL-2440 |
|---|---|---|
| Lógica | classes `L1…L4` (uma por grupo) | classe única **`L`** (32 latches, até 64 SV, 32 SC, 32 MV) |
| Grupos de ajuste, proteção 50/51/67, religamento, disjuntor, medição | sim | **não** (os ajustes da classe `1` só têm DID/TID) |
| Entradas | `IN101`, `IN102`, `IN3xx…` | **48 entradas** em 3 cartões de 16: `IN101–IN116`, `IN201–IN216`, `IN301–IN316` (debounce `INxxxD` em ms, na classe `G`) |
| Saídas | `OUT101…` | `OUT101–OUT116`, `OUT201–OUT216`, `OUT301–OUT316` |
| Bits de usuário | `RB01–RB32` (pulsos via DNP3), `PBn` | **`VB001–VB256`** (virtuais, recebidos por GOOSE/outros), **`CB001–CB064`** (controle) e **`RB01–RB32`** (remotos) |
| Frontal | LCD, LEDs de alvo, botões | LEDs `ENABLED/ALARM/MODE`, portas (`LNK/TX/RX`), **3 linhas de 16 LEDs** de E/S (100, 200, 300) e **LAMP TEST** |

**Ciclo (`_step_2440`)**: eventos (pulsos RB, target reset) → entradas com debounce → bits mantidos pelo usuário (VB/CB/RB) → lógica **SV → SC → MV → LT → OUT** → DNP3 → SER.
Cada equação continua sendo avaliada uma vez por ciclo (sem curto-circuito).

**Tela (aba "Painel frontal")**

- Réplica do frontal (imagem de referência). Cada LED da matriz mostra o estado do ponto: nos cartões de **entrada** é a entrada (clique no LED para alternar), nos de **saída** é a saída;
  num cartão com entradas e saídas usadas ao mesmo tempo o LED acende se qualquer uma estiver ativa (o balão ao passar o mouse detalha). O tipo do cartão é deduzido de quais pontos aparecem na lógica.
  **LAMP TEST** (manter pressionado) acende todos os LEDs.
- **Entradas digitais:** chips com o ALIAS/comentário, clique alterna (com o debounce `INxxxD`); "mostrar não usadas" exibe as 48.
- **Saídas digitais:** estado (ATUADA/REPOUSO) com o comentário da equação.
- **Bits virtuais (VB):** simulam os bits que chegariam por GOOSE; clique liga/desliga e o valor fica mantido.
- **Bits remotos (RB) e de controle (CB):** RB com **Pulso** (1 ciclo), **Set** e **Clear**; CB alterna. Um campo livre aciona qualquer VB/RB/CB (ex.: `VB040`). **Target reset** pulsa `TRGTR`.
- As demais abas (Variáveis internas, DNP3, Ajustes, Eventos/SER) funcionam como no 751; seções que não se aplicam (disparo, proteção, religamento, direcional, analógicos) ficam ocultas.

**Bits virtuais no SEL-751:** o SEL-751 também ganhou os cartões **Bits virtuais (VB)** e **Bits remotos (RB)** na tela inicial (os usados nos ajustes e os acionados por você): VB liga/desliga e fica mantido; RB tem Pulso/Set/Clear. Os VB entram na lógica como qualquer bit do Relay Word.

**Limitações:** comandos pela rede/serial (`CON`, `SET`…), IEC 61850/GOOSE real, Mirrored Bits (`TMBxx`), Modbus e as portas são lidos mas **não simulados**; os cartões de E/S são deduzidos
(a configuração real depende do código de pedido do equipamento).

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
- **Direcional (67):** `EDIR = Y/AUTO/AUTO2`, `DIR1…DIR4`, `ORDER` (Q, V, S, P, U; o canal IN por corrente `I` não), PHI, fase por sequência positiva com memória e `ELOAD`; veja a seção "Controle direcional (67)" de [`logica-simulada.md`](logica-simulada.md). Seção própria em **Variáveis internas** e chave **Perda de potencial (LOP)** nos auxiliares.
- **Não implementados:** 49, 46, 50INC, HIF, 52ABF interno, 78, 55, demanda, `79SKP/79SEQ/79DLS/79CLSD`.

### TRIP, CLOSE e religamento

`TRIP` mantém `TDURD` e só cai com `ULTRIP` e `TR` falso. `CLOSE` cai ao fechar (`52A`), por `ULCL` ou após `CFD` (gera `CF`). O **79** percorre `RS → CY → LO`:
tempo morto `79OIn` com o disjuntor aberto e sem `79STL`; reset `79RSD`; `79DTL` leva a bloqueio; `SH0..SH4` indicam o número de religamentos; abertura por
comando (`SV03T`) leva o 79 a `LO`.

### Disjuntor e campo

As bobinas de abertura e de fechamento são as **Variáveis de abertura/fechamento** do cartão Disjuntor (campo) ou, vazias, **deduzidas** das
expressões/comentários das saídas (`TRIP`/"ABERTURA" × `CLOSE`/"FECHAMENTO"); a posição alimenta a entrada de estado (a escolhida ou a da equação `52A`). A falta (`POST/DELETE /fault`, tipos AG BG CG AB BC CA ABC, permanente ou transitória) existe na API e
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


## SEL-787 (proteção de transformador)

Suportado a partir de `RELAYTYPE=SEL-787-*` (`backend/app/engine787.py`, `protection_787.py`; testes `test_sel787.py`). O motor herda o do SEL-751
(lógica SELogic, entradas/saídas, SER, DNP, frontal) e acrescenta:

- **Correntes por enrolamento** W1 a W4 (injeção: W1 em `ia_*`/`ib_*`/`ic_*`, W2 a W4 em `wNia_*`…) e canal **IN1** (`in1_mag/ang`). Ao abrir o
  relé, a injeção inicial é uma carga passante (100 % do TAP) que o diferencial enxerga como zero. A janela de injeção mostra um cartão por enrolamento,
  o neutro IN1 e o conteúdo harmônico da corrente diferencial (`h2_pct`, `h4_pct`, `h5_pct`).
- **87** (figuras 4.1 a 4.6): TAPn (de MVA/VWDGn/CTRn ou do ajuste), compensação `WnCTC` (matrizes da tabela 4.5), IOP = |soma fasorial|, IRT = soma dos módulos,
  característica de dupla inclinação (SLP1/SLP2/IRS1/O87P), alta segurança por INRn (SLP2 no lugar de SLP1 por 10 ciclos após energizar), restrição por
  2ª e 4ª harmônicas (HRSTR), bloqueio por 2ª/4ª cruzado e 5ª individual (HBLK), não restrito 87U, alarmes 87AP/87AT e TH5P/TH5T.
  Bits: 87R1..3, 87R, 87U1..3, 87U, 87HR, 87HB, 87BLn, INRn, 2_4HBn, 5HBn.
- **REF1** (figuras 4.9 a 4.13): IN1 × residual dos enrolamentos de REF1POL, REF1F/REF1R/REF1P (U4, TD 0,5) e bypass com o disjuntor aberto. Aproximação:
  o limiar do torque (THRES1P/N) não consta no trecho do manual e vale ±0,08·50REF1P². REF3A/REF3B não foram implementados.
- **50/51 por enrolamento**: 50Pnx, 50Gnx, 50Qnx, 50N1x (instantâneo/tempo definido), 51Pn, 51PnA/B/C, 51Gn, 51Qn, 51N1 (curvas U1–U5/C1–C5). Não implementados:
  elementos combinados (50P121P, 51PC12P…), 50P3xA/B/C (TCs separados); 27/59/25/32/81 vêm do motor do 751.
- **Disparo/fechamento por enrolamento**: TRn → TRIPn e TRXFMR → TRIPXFMR (TDURD, ULTRIPn/ULTRXFMR), CLn → CLOSEn (CFDn, ULCLn) e um disjuntor simulado por
  enrolamento; as bobinas são deduzidas das saídas OUTxxx que citam TRIPn/TRIPXFMR/CLOSEn. Sem religamento (79). `52An` só segue o disjuntor se for uma entrada (INxxx).

## SEL-311C (proteção de linha de transmissão)

Suportado a partir de `RELAYTYPE=SEL-311C-*` (`backend/app/engine311c.py`, `protection_311c.py`, `panel311c.py`; frontal
`frontend/src/components/Relay311CFront.tsx`; testes `test_sel311c.py`, que usam um ajuste sintético e, se existir na raiz, o
`Padrões SEL-311C.rdb`). Referência visual do frontal: `assets/relay-front-311c-reference.webp`. Fontes: *SEL-311C-1 Instruction Manual*
(trechos fornecidos: seção 3 – distância e sobrecorrente; seção 4 – LOP, carga e direcionais), Date Code 20261020.

**Como os ajustes são lidos** (diferente do 751):

- Grupos `1`–`6` têm só ajustes numéricos e enables; **toda a SELogic fica na classe de lógica do grupo** (`L1`–`L6`): `TR`, `TRCOMM`,
  `TRSOTF`, `DTT`, `ULTR`, `52A`, `CL`, `ULCL`, `79RI`/`79RIS`/`79DTL`/`79STL`/`79BRS`/`79CLS`, torques `67xnTC`/`51xTC`, `SVn`, `SETn`/`RSTn`,
  `LVn`, `OUTxxx`/`ALRMOUT`, `LEDn`, `DPn`, `SS1`–`SS6`, `ER`, `FAULT`, `TMBnX`. Textos do display (`DPn_1`/`DPn_0`) e dos bits locais
  (`NLBn`/`CLBn`/`SLBn`/`PLBn`) vêm da classe `T`; textos e retenção dos LEDs de alvo (`LEDnnA`/`LEDnnL`) da `G`.
- **Tempos em ciclos** (TDURD, CFD, 79OIn, 79RSD, 79RSLD, SVnPU/DO, ZnPD/ZnGD/ZnD, 67xnD, 3POD, SOTFD, TGR, debounce `INxxxD`), convertidos por NFREQ.
- **SELogic clássica**: `+` (OU), `*` (E), `!` (NÃO), `/X` (borda de subida), `\X` (borda de descida) – suportada em `selogic.py`.
- Nomes sem zeros à esquerda: `SV1`–`SV16`/`SVnT`, `LT1`–`LT16`, `LV1`–`LV32` (variáveis sem temporizador, avaliadas antes das SV),
  `PB1`–`PB10` e `PBnPUL`, `LB1`–`LB16` (bits locais), `RB1`–`RB32`. Entradas IN101–IN106 e IN201–IN216; saídas OUT101–OUT107, OUT201–OUT212 e ALRMOUT.
- VNOM do 311C é fase-neutro (secundário): a injeção inicial usa VNOM × PTR e 1 A sec. de carga; `info.vnom` guarda o valor fase-fase.
- Grandezas com os nomes do 311C para o mapa DNP (`IA`, `IB`, `IC`, `IN` em A prim.; `VA`…`VCA` em kV; `MW3`, `MVAR3`, `PF3`, `MWH3O`…, `FI`, `FLOC`).

**Proteção simulada** (`protection_311c.py`):

- **Distância de fase** (E21P = 1–4): mho por memória de V1 em pares AB/BC/CA (MABn, MBCn, MCAn → MnP; Tabela 3.1, Figuras 3.4–3.6) com
  |Ipp| > 50PPn, direção 32QF/F32P (Z1, Z2; Z3/Z4 por DIR3/DIR4), VPOLV, !ILOP e bloqueio por FIDS. E21P = 1C–4C: **compensador** (MPPn e MABCn,
  Tabela 3.1; polarização do trifásico = −j·VAB − 0,25·VCmem, leitura do texto da tabela).
- **Distância de terra**: mho (E21MG; MAGn…) e quadrilateral (E21XG; XAGn…, reatância polarizada por I2 ou IG com TANG e resistência RGn),
  compensação k0 (k0M1/k0A1 na Z1, k0M/k0A nas demais), supervisão 50Ln/50GZn, 32GF/32GR, FSA/FSB/FSC, VPOLV, !ILOP e !3PO (Z1). ZnG = OU.
- **Temporizadores de zona** (Figura 3.23): MnPT (ZnPD), ZnGT (ZnGD) e comum ZnT (ZnD, com suspensão de 1 ciclo). **Atraso `OFF` = saída sempre 0**
  (p. 3.29). No padrão "Entrada de Linha 21" Z1GD = OFF, então só a Z2 (20 ciclos) dispara por distância.
- **Sobrecorrente**: 50/67 de fase níveis 1–4 (50An/50Bn/50Cn, 50Pn, 67Pn, 67PnT) **não direcional** (p. 3.38, só torque 67PnTC); terra residual
  (50Gn/67Gn) e seq. negativa (50Qn/67Qn) **direcionais**: níveis 1–2 à frente (32GF/32QF), 3–4 por DIR3/DIR4. 51P (máx. fase), 51G (3I0) e 51Q
  (3I2): curvas U1–U5/C1–C5, bits 51x/51xT/51xR, torque 51xTC, reset 51xRS (Y = eletromecânico, N = 1 ciclo).
- **Direcionais**: 32Q (Figura 4.20: z2 = Re[V2·(I2∠Z1ANG)*]/|I2|² com os limiares de Z2F/Z2R, 50QFP/50QRP, a2, k2); 32G pela ORDER (Q e V;
  o I – canal IN polarizado por corrente – não é simulado); 32P (Figura 4.21). Com LOP e ELOP = Y, 32QF e 32GF vão a 1 (p. 4.26).
- **Supervisões**: LOP (chave "Perda de potencial" da bancada), ILOP (ELOP = Y/Y1), 3PO (OPO = 52 ou 27, 50LP, queda 3POD), SOTFE (ESOTF),
  load-encroachment ZLOAD/ZLIN/ZLOUT (ELOAD), FIDS (ângulo I2A × I0, p. 3.22), 27/59 (EVOLT) e 81D1–81D6 com 27B81 (E81).
- **Disparo**: `TR + TRSOTF·SOTFE + DTT` → TRIP (mínimo TDURD; cai com ULTR ou TARGET RESET); TPA = TPB = TPC = 3PT = TRIP (tripolar).
  `TRCOMM` é avaliada, mas sem esquema de teleproteção não dispara. Fechamento `CL` (CFD → CF), religamento 79 como no 751 com tempos em ciclos.
- **Localizador** (EFLOC = Y): no disparo, reatância do laço de menor impedância ÷ reatância de Z1MAG∠Z1ANG × LL → `FLOC`.

**Memória de tensão e falta trifásica próxima.** O material fornecido diz que o mho de fase é polarizado por V1mem (p. 3.4, Figura 3.1,
Equação 3.1), que **VPOLV** supervisiona mho e quadrilaterais e assere quando a memória de V1 é maior que 1 V (p. 3.21) e que o direcional F32P/R32P
exige VPOLV, !ZLOAD, !ILOP e |IAB|, |IBC|, |ICA| > 0,1·INOM (Figura 4.21, p. 4.28). **Não informa a constante de tempo da memória nem uma
retenção da direção** depois que ela se esgota. O simulador usa um filtro de 1ª ordem que acompanha V1 com constante **adotada** de 16 ciclos
(`MEM_TAU_CYC`): numa falta trifásica franca próxima (V = 0) a direção e os mho de fase se mantêm por ≈ 4,2 × 16 ciclos ≈ 1,1 s (até |V1mem| < 1 V);
depois VPOLV cai e o que depende deles (ex.: `51PTC = (M1P+M2P)*!LOP`) volta ao repouso. Na prática a Z1 dispara bem antes.

**Frontal** (aba Painel frontal): display 2×16, TARGET RESET/LAMP TEST (segurar acende todos os LEDs), teclas de **dupla função** (no display
rotativo valem METER, EVENTS, STATUS, OTHER, SET, CNTRL e GROUP; dentro de um menu, CANCEL, SELECT, setas e EXIT), LEDs ENABLED, TRIP, TIME,
COMM, SOTF, RS, LO, 51, FAULT TYPE A/B/C/G e ZONE/LEVEL 1–4, e 10 botões PB1–PB10 com LED (LED1–LED10; coluna esquerda PB1–PB5, direita
PB6–PB10). A seção de disjuntor do lado direito (OPEN/CLOSED, TRIP/CLOSE) não foi reproduzida. Os alvos são gravados no disparo
(`LTRIP`, `LTIME`, `LCOMM`, `LSOTF`, `L51`, `LZONE1`–`LZONE4`, citados por `LED12`–`LED26`) e apagam com TARGET RESET, `RSTTRGT` ou, com
RSTLED = Y/Y1, ao fechar o disjuntor. FAULT TYPE: fases com corrente ≥ 60 % da maior e G com 3I0 ≥ 10 % (simplificação). O menu **CNTRL**
opera os bits locais (também na bancada, cartão "Bits locais"). O display rotativo mostra IA/IB/IC/IN e os pontos DP com texto. Os textos dos
botões ficam no navegador (`sel751.pbtitles.<relay_id>`, 10 posições; "/" quebra a linha). Na aba Variáveis internas, a seção
"Direcionais e supervisões da linha" mostra VPOLV, |V1mem|, FIDS, 32Q/32G/32P, z2/z0 e o elemento de terra em uso.

**Demais módulos**: SystemLab (modelo SEL-311C no IED, com TC/TP/disjuntor como o 751), SCADA (mapa DNP do ajuste), IEC61850 (GOOSE por VBnnn;
E61850/EGSE lidos da porta 5, classe `P5`) e MBitConfig (portas 2 e 3, `PROTO` em `P2`/`P3`; TMBnX avaliados na lógica `Ln`).

**Fora do escopo** (lido e ignorado): teleproteção (ECOMM: POTT/DCB/DCUB; TRCOMM não dispara), extensão de zona 1, CCVT (CVTBL = 0),
out-of-step (OSBn = 0), sequenciais Z2SEQT/M2PSEQT/Z2GSEQT, 50BF, 25, 79SKP/79SEQ/79DLS/79CLSD, TULO/TOPD, demanda, monitor de disjuntor, PMU,
direcional 32I (canal IN), Modbus e portas.

## Exportar o IED em JSON

Botão **⬇ Exportar JSON** na barra do simulador (`GET /api/sessions/<sid>/export` + dados do navegador). O arquivo (`format: "eclipse-digitalrelay"`) contém:
`settings` (todas as classes do ajuste com os valores atuais, já com as edições da aba Ajustes), `modified` (pares classe/ajuste alterados no simulador),
`original_files` (arquivos do ajuste como vieram do .rdb), `simulation` (injeção `SimConfig`, grupo, disjuntor, entradas, variáveis forçadas, bits mantidos,
IED IEC 61850 associado, velocidade) e `front_panel` (textos personalizados `sel751.texts.<relay_id>` e títulos dos botões `sel751.pbtitles.<relay_id>`).

**Importar:** botão **⬆ Importar JSON** na tela de carga (`POST /api/sessions/import`). Cria um novo relé a partir de `original_files`, reaplica os ajustes de
`modified` com os valores de `settings`, restaura a injeção, o disjuntor, as entradas, os forçados, os bits mantidos, a velocidade e, se o IED existir no
projeto IEC 61850 atual, a associação. Os textos do frontal (`front_panel`) voltam para o localStorage do relé. O que não puder ser restaurado vem em `warnings`.

## Ajustes alterados e injeção vinda do SystemLab

- Aba Ajustes: clicar na etiqueta **alterado** volta o ajuste ao valor original do .rdb (`DELETE /api/sessions/<sid>/settings/<classe>/<ajuste>`; a dica mostra o valor original).
- Relé associado a um IED do SystemLab: o SystemLab envia as grandezas por `POST /api/sessions/<sid>/systemlab` e elas **prevalecem** sobre a injeção manual (a janela de injeção fica travada e `/sim` recusa grandezas analógicas com 409). No cartão Medição do Painel frontal, **Isolar do SystemLab** (`SimConfig.sl_isolated`) devolve a injeção manual que o usuário tinha e passa a ignorar o SystemLab; desligando, volta a valer o SystemLab. O relé é considerado associado enquanto o SystemLab o atualiza (até 15 s sem atualização; o SystemLab só envia com a sua tela aberta).

**25 desabilitado:** com `E25 = N` (ou VSCONN ≠ VS) no grupo ativo, os bits da função – 25A1, 25A2, SF, 59VP, 59VS, 59VDIF, DLDB, DLLB e LLDB – ficam em 0 (antes guardavam o último valor do grupo anterior ao trocar de grupo). Com `E25 = Y` o elemento volta a calculá-los pelos ajustes do grupo.

**Exportar todos:** botão na barra do simulador; gera um único JSON (`format: "eclipse-digitalrelay-bundle"`, `relays: [...]`, um item por relé em execução no mesmo formato da exportação individual). O **Importar JSON** aceita tanto um relé quanto esse pacote (recria todos).

**Limpar o SER** (aba Eventos ou SystemLab → Limpar SER dos relés): apaga os eventos e reinicia a numeração – o próximo evento volta a ser o nº 1. A resposta de `/ser` traz `epoch` (incrementado a cada limpeza), para a aba Eventos recomeçar a lista quando o SER for limpo por outro app.

**Renomear IED:** duplo clique na aba do relé (ou ✎ ao lado da aba ativa). O nome (`PATCH /api/sessions/<sid>` `{name}`) aparece no DigitalRelay, SCADA, SystemLab e IEC61850, sobrevive ao Reiniciar e vai na exportação JSON; nome vazio volta ao nome do ajuste no .rdb.
