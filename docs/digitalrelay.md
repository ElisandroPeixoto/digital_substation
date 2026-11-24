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
