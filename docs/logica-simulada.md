# Lógica simulada: premissas e limitações

Este documento descreve o aplicativo **DigitalRelay** do Eclipse. O simulador **não executa o firmware** do SEL-751. Ele reproduz o comportamento funcional descrito pelos arquivos de
ajuste, com modelos simplificados. Esta página lista o que é fiel, o que é aproximado e o que não existe.

## O que é lido dos ajustes

| Classe | Uso |
|---|---|
| `1…4` (grupos) | TC/TP, pickups/atrasos/curvas dos elementos 50/51/27/59/81, `TR`, `ULTRIP`, `TDURD`, `52A`, `CL`, `ULCL`, `CFD`, religamento `E79`/`79*`. |
| `L1…L4` (lógica) | Latches `SETnn/RSTnn`, variáveis `SVnn` (+`PU`/`DO`), contadores `SCnn`, variáveis matemáticas `MVnn`, saídas `OUTxxx`. |
| `G` (global) | `SS1…SS4`/`TGR` (troca de grupo), `FAULT`, filtros das entradas (`INxxxD`), limites CC (`DCLOP`/`DCHIP`), `FNOM`. |
| `F` (frontal) | LEDs `Tnn_LED`, LEDs dos botões `PBnA/B_LED`, pontos de display `DPnn`. |
| `R` (relatório) | `ER`, listas `SER1…SER4`, `ALIAS` (textos de estado). |
| `D1…D3` | Mapa DNP3 (BO/BI/AI/CO). |

**Fora do escopo** (lidos mas ignorados): Modbus (`M`), Mirrored Bits (`TMBxx`), EtherNet/IP (`E1–E3`), IEC 103 (`I`),
portas (`P1–P4`, `PF`) e tela touchscreen (`SET_HMI.TXT`).

## Equações SELogic

- Operadores: `NOT`, `AND`, `OR`, `XOR`, `R_TRIG`, `F_TRIG`, `< > <= >= = <>`, `+ - * /`, `ABS()`, `SQRT()`.
- Precedência: `OR` < `XOR` < `AND` < comparação < `+ -` < `* /` < `NOT`/`R_TRIG`/`F_TRIG`.
- `NA`, `OFF` e vazio = equação desabilitada (valor 0). Identificadores desconhecidos valem 0 e são listados em
  **Variáveis internas → alerta "bits que o simulador não conhece"**.
- Cada equação é avaliada uma vez por ciclo; sem curto-circuito.

### Premissas de ordem de avaliação (⚠ verificar no relé real)

- **SV → SC → MV → LT → OUT** dentro do ciclo. Isso reproduz o comando em dois toques do padrão (a variável `SV03`
  enxerga o latch `LT04` do ciclo anterior).
- **Latch com SET e RESET simultâneos: o RESET prevalece.** O padrão "Alimentador v1.24" não depende disso.
- Os bits do Relay Word usados por equações que ainda não foram calculadas no ciclo valem o resultado do ciclo anterior.

## Proteção

Base: manual do SEL-751, seção "Overcurrent Elements" / "Time-Overcurrent Elements" (figuras 4.2 a 4.12, tabelas 4.9 a 4.22).

### Instantâneo / tempo definido (50)

- Elementos `50P1–4` (corrente máxima de fase), `50N1–4` (`IN`), `50G1–4` (`IG`) e `50Q1–4` (`3I2`). Habilitados só com pickup diferente de `OFF`.
- Bit de **partida** `50xnP`: sobe quando a grandeza ≥ pickup e o controle de torque `50xnTC` é verdadeiro; cai abaixo de 95 % do pickup.
  Bit de **atuação** `50xnT`: `50xnP` mantido por `50xnD` segundos. **`50xnD = OFF` desabilita o elemento** (nenhum dos dois bits sobe).
- `50P1` e `50P2` também têm os bits por fase `50A1P/50B1P/50C1P` e `50A2P/50B2P/50C2P` (cada fase contra o mesmo pickup).
- `ORED50T` = qualquer `50xnT` ativo.
- *Aproximações*: partida e queda ocorrem dentro do ciclo de varredura de 4 ms (o relé real leva 0,25 a 1,5 ciclo, figuras 4.4 e 4.5);
  não há detector de pico para TC saturado; `EDIR`/elementos direcionais 67 não existem (os bits `67xx` ficam sempre em 0).

### Temporizado (51)

- Elementos `51AT/51BT/51CT` (cada fase), `51P1T/51P2T` (máxima de fase), `51QT` (3I2), `51N1T/51N2T` (`IN`) e `51G1T/51G2T` (`IG`).
  Bits `51xP` (partida), `51xT` (fim da curva) e `51xR` (rearmado: sem partida e disco em zero).
- Curvas **U1–U5, C1–C5, E1–E3** com as equações das tabelas 4.20 a 4.22: `tp = TD·(A/(M^p − 1) + B)`, `M = I/pickup > 1`.
  Com `51SAT = Y` (global, padrão) o múltiplo é limitado a 30; `51SAT = N` usa o múltiplo real.
- `51xCT` soma um tempo constante; `51xMR` é o piso do tempo da curva: `t = max(tp, MR) + CT`. *(Ordem exata no firmware não está no manual: premissa.)*
- O avanço é integrado a cada ciclo (`progress += dt / t(M)`), então variações de corrente durante a contagem são tratadas.
- **Reset**: `51xRS = N` rearma 1 ciclo após a queda da partida; `51xRS = Y` (eletromecânico) recua o disco com `tr = TD·R/(1 − M²)`
  (`1 − M` na C4), usando o múltiplo atual — a contagem parcial é mantida se a corrente voltar antes do rearme.
- `ORED51T` = qualquer `51xT` ativo. `51xTC` abre o "interruptor de torque": falso = elemento desabilitado e reiniciado.

### Grandezas

- `IMAX` (maior corrente de fase), `IA/IB/IC`, `IN` = soma fasorial ÷ `CTRN` (TC de neutro em conexão residual), `IG` = soma fasorial ÷ `CTR`,
  `3I2` = |IA + a²·IB + a·IC| ÷ `CTR`. Pickups em A **secundários** (primário ÷ CTR). Disjuntor aberto ou injeção analógica desligada: corrente zero.
- Tensões (27/59) e frequência (81D): tempo definido, mesmo modelo de partida/atuação.
- **Não implementados**: elementos direcionais (67), 49 (térmico), 46 (desbalanço), HIF, 50INC (falha incipiente de cabo, figuras 4.6/4.7),
  partida a frio, falha de disjuntor interna (`52ABF`), sincronismo (25), 78, 55, bloqueio por harmônicas, `E27I/E59I`, demanda.

## TRIP, CLOSE e religamento

- `TRIP` liga quando `TR` (ou `REMTRIP`) sobe, fica ao menos `TDURD` e só desliga quando `ULTRIP` está verdadeiro e `TR` falso.
- `CLOSE` liga na subida de `CL` (ou por religamento) se o disjuntor está aberto e `ULCL` falso; desliga ao fechar (`52A`),
  por `ULCL`, ou após `CFD` (gera `CF`).
- **Religamento 79** (`E79` tentativas): `RS` → (`79RI` sobe e `79RIS`) → `CY`. O tempo morto `79OIn` conta com o disjuntor
  aberto e sem `79STL`. Após o religamento, o tempo de reset `79RSD` conta com o disjuntor fechado e sem `79BRS`. Novo disparo
  inicia a próxima tentativa; acima de `E79`, ou com `79DTL`, vai a bloqueio (`LO`). Em `LO`, o fechamento por `79RSLD` volta a `RS`.
  Bits: `79RS`, `79CY`, `79LO`, `SH0…SH4`. *Não simulados*: `79SKP`, `79SEQ`, `79DLS`, `79CLSD`.

## Disjuntor e campo

- Bobinas de **abertura** e de **fechamento** são deduzidas das saídas: expressão contendo `TRIP` / comentário com
  "ABERTURA"/"TRIP" → abertura; contendo `CLOSE` / "FECHAMENTO" → fechamento. A posição alimenta a entrada do `52A`
  (deduzida da equação `52A`, normalmente `IN101`). A lista usada aparece em *Variáveis internas → Disparo e fechamento*.
- Tempos mecânicos configuráveis (padrão: abrir 60 ms, fechar 100 ms).
- **Injeção**: o usuário define fasores (módulo e ângulo) de corrente e tensão por fase, e a frequência. O valor é guardado
  em grandezas **primárias**; no modo secundário a interface converte com TC (`CTR`) e TP (`PTR`). A corrente de neutro
  (`IN`/`IG`) é a soma fasorial das três fases. As componentes de sequência da janela de injeção são calculadas na interface
  a partir dos valores inseridos.
- **Desligar ao atuar saída** (`analog_off_on_output`, padrão desligado): na subida de qualquer `OUTxxx` a injeção analógica é desligada (vale no ciclo seguinte; o usuário religa pela chave). Se a saída é a **bobina de abertura** e o disjuntor ainda está fechado, o corte espera o disjuntor abrir, para que a corrente persista durante o tempo de abertura (alarmes `SV13..SV15`/`LT18..LT20`).
- **Injeção analógica ligada/desligada** (`analog_on`, **inicia desligada**; chave na tela inicial): desligada, o relé enxerga correntes e tensões
  zero (e P/Q/S zero); o disjuntor e as entradas digitais não mudam. A frequência informada é mantida.
- Falta (só pela API `/fault`; a interface não tem mais o atalho): tipos AG, BG, CG, AB, BC, CA, ABC, com corrente configurável, **permanente** ou **transitória** (some ao abrir).
  Ela **sobrepõe** as correntes inseridas nas fases envolvidas (ângulo -75°, -45°…) e afunda as tensões; sem impedância de
  fonte. Com o disjuntor aberto a corrente vista pelo relé é zero.
- **Entrada do 52A (IN101)**: com *simular o estado do disjuntor automaticamente* ligado, ela acompanha o modelo do disjuntor
  (e alternar a entrada move o disjuntor). Desligado, a entrada é livre (útil para testar 52A divergente do estado físico),
  e o disjuntor continua a abrir/fechar pelas bobinas e pelos botões *Abrir/Fechar (campo)*.
- A resolução de tempo é de **4 ms** por varredura (a 1×). Em velocidades maiores, o passo cresce proporcionalmente
  (ex.: 10× → 40 ms); use 1× para medir tempos de atuação.

## Painel frontal

- LEDs de alvo `Tnn`: retenção conforme `TnnLEDL`; **TARGET RESET** limpa os retidos (e o LED TRIP se não há `TRIP`).
  `RSTLED = Y` limpa os alvos antigos a cada novo disparo. Cores: `R` vermelho, `G` verde, `A` âmbar, `O` apagado; nos
  LEDs de botão, o par `AO` = (cor ligado, cor desligado).
- Os rótulos dos LEDs/botões vêm dos comentários (`#`) das equações. Disposição: PB1–PB4 na coluna direita e PB5–PB8 na
  esquerda. O texto grande no centro de cada botão (padrão AUX 1…4, AUX, LOCK, CLOSE, TRIP) é editável e fica salvo no
  navegador (`localStorage`, por ajuste); não afeta a lógica.
- Botões `PBn`: o bit sobe ao pressionar e desce ao soltar (use `R_TRIG`/`F_TRIG` como no relé).
- Display 2×16: mostra duas linhas de pontos `DPnn` por tela (pontos booleanos só aparecem quando há texto para o estado
  atual). Linhas maiores que 16 colunas rolam. **ENT** abre um menu simplificado (MEDIÇÃO / ALVOS / STATUS). O menu
  original do relé (ajustes, eventos, comandos) **não** é reproduzido.

## DNP3

- Não há pilha DNP3 em rede: a aba mostra o que um mestre leria e envia **CROB** diretamente à lógica.
- **BI**: valor do bit; mudança de estado gera evento. **AI**: `valor × escala`, inteiro de 16 bits (saturação sinalizada como
  `OVER_RANGE`); evento quando a variação excede a banda morta (em contagens). AI sem `:escala:banda` usa escala 1 e banda 0.
- **BO**: `Select → Operate` (validade 10 s simulados) e `Direct Operate`. `Pulse On` e `Latch On` acionam o bit por **um ciclo**
  (bits RB/OC/CC são pulsos). `Latch Off` retorna `NOT_SUPPORTED`. Pontos `NA` retornam `NOT_SUPPORTED`; índice
  inexistente, `FORMAT_ERROR`.
- Não há relatórios não solicitados (*unsolicited*), classes de evento configuráveis nem sincronização de tempo.

## Medição

Valores primários: correntes em A, tensões em V, `P`/`Q` em kW/kVAr, energias em MWh/MVArh. A energia acumula conforme o tempo simulado.
`FIA…FIN` guardam as correntes no momento do último disparo; `FLOC` (localização da falta) vale 0.
