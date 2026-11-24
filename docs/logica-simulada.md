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
  não há detector de pico para TC saturado; o controle direcional (`EDIR`, 67) está descrito em [Controle direcional](#controle-direcional-67).

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
- **Não implementados**: 49 (térmico), 46 (desbalanço), HIF, 50INC (falha incipiente de cabo, figuras 4.6/4.7),
  partida a frio, falha de disjuntor interna (`52ABF`), 78, 55, bloqueio por harmônicas, demanda.

## Tensão avançada, sincronismo (25) e potência (32)

Implementados em `backend/app/protection_v.py` (e `protection.py` para os níveis 1–4 de 27/59), conforme o manual do SEL-751 (seção 4, Group Settings). Tensões em V secundários; os bits do Relay Word existem mesmo com o elemento desabilitado.

- **27/59 de tempo definido:** `27Pn`, `27PPn`, `27Sn`, `59Pn`, `59PPn`, `59Sn`, `59Gn`, `59Qn` (n = 1–4; `S` = canal VS), bits `27Pn`/`27PnT` etc. **3P27/3P59** (sem atraso): as três tensões abaixo/acima do pickup do nível 1 (Wye: `27P1P`/`59P1P`; Delta: `27PP1P`/`59PP1P`).
- **27I / 59I (tempo inverso):** habilitados por `E27In = Y` (n = 1–2) e `E59In = Y` (n = 1–4). Grandeza de operação `nOQ` (VAB, VBC, VCA, VA, VB, VC, V1, VS, MINLL, MINLN; no 59I também VG, 3V2, 3V0, MAXLL, MAXLN), pickup, curva (`CURVEA/B/(C)/COEF`, coeficientes A, B, C), dial `TD`, reset `TTR` e controle de torque `nTC` (SELogic). 27I: `TTT = TD·(B + A/(1 − OQ/P)^C)`, só integra abaixo de 0,975·P; 59I: `TTT = TD·(B + A/((OQ/P)^C − 1))`, só integra acima de 1,025·P (equações 4.20 e 4.21). Bits `27In`, `27InT`, `27InRS` (e `59I…`).
- **25 (sincronismo):** `E25 = Y` e `VSCONN = VS`. VS vem da injeção (módulo primário, ângulo e **frequência** na janela de injeção; `PTRS` converte). VP = `25RCF` · fase escolhida em `SYNCPH` (VA/VB/VC, VAB/VBC/VCA ou ângulo 0–330°, que referencia VA/VAB). Bits `59VP`, `59VS`, `59VDIF` (`25VDIF`, OFF = sempre 1, pickup de 2 ciclos), `SF` (escorregamento < `25SF`, frequência em FNOM ± 5 Hz, `BSYNCH` desligada), `25A1`/`25A2` e `DLDB`/`DLLB`/`LLDB` (`27LP/59LP/27BP/59BP`). Diferença angular `|(∠VP − ∠VS) + (fP − fS)·TCLOSD/1000·360|`; com `TCLOSD = OFF` ou escorregamento ≤ 0,005 Hz vale o ângulo fixo (`25ANGn`); com escorregamento e `TCLOSD`, 25An sobe no pulso de passagem por 0° (ângulo decrescente) ou enquanto o ângulo compensado cresce e é menor que `25ANGn`. Se `vs_freq` ≠ frequência do sistema, VS gira em relação a VP. Não implementada a verificação de última checagem `79CLS` (tratada como 0).
- **32 (potência):** `EPWR = 3P1/3P2`; `3PWRnP` (VA secundários), `PWRnT` (+WATTS, −WATTS, +VARS, −VARS, convenção de carga), `PWRnD`. P ou Q trifásico com média de 2 ciclos, supervisão |VAB| e |VBC| > 20 V (VBC = VAB com `SINGLEV = Y`). Bits `3PWRnP` e `3PWRnT`.
- **593SRMS:** `E593SRMS = Y` e `593SRMSP`: RMS de 0,2 s e RMS de 10 min (a cada 3 s) por tensão fase-fase; bits `593SRMS1/2/3` (AB, BC, CA).
- **Não implementados:** 55 (fator de potência) e os canais CC `27Nn/59Nn` (VBAT).

Testes: `backend/tests/test_voltage_sync_power.py`.

## Controle direcional (67)

Implementado em `backend/app/directional.py` a partir da seção "Directional Control" do manual (figuras 4.26 a 4.61, tabelas 4.23 a 4.36).
A cada varredura, depois das medidas e antes dos elementos 50/51, o módulo calcula os bits direcionais do Relay Word e os bits de controle por nível
(`P1DIR…P4DIR`, `N1DIR…N4DIR`, `G1DIR…G4DIR`, `Q1DIR…Q4DIR`). Cada elemento 50/51 do nível correspondente só funciona se o seu bit `xnDIR` for 1.

### Ajustes lidos (grupo ativo)

| Ajuste | Uso |
|---|---|
| `EDIR` | `N` (padrão): tudo não direcional, os bits `xnDIR` valem 1. `Y`: usa os ajustes do usuário. `AUTO` / `AUTO2`: calcula `50QFP/50QRP/Z2F/Z2R/a2/k2/50GFP/50GRP/Z0F/Z0R/a0/Z0MTA` (tabelas 4.31 e 4.32, com `INOM`, `Z1MAG`, `Z0MAG`, `Z0ANG`; `INOM` lido do grupo ou do global, padrão 5 A). |
| `DIR1…DIR4` | `F` frente, `R` reverso, `N` não direcional, por nível. Todos os 51 seguem o nível 1; os 50 seguem o nível `n` (tabela 4.34). |
| `ORDER` | Prioridade dos elementos de terra (`Q V I S P U`, `OFF`). Escolhe-se o primeiro cuja habilitação interna está ativa (tabela 4.24). `ORDER = OFF` (ou `P` sozinho) deixa o residual não direcional; `OFF` deixa o neutro não direcional. |
| `EFWDLOP` | Com perda de potencial (`LOP`), os elementos ajustados para frente passam a atuar sem direção (forçam `DIRxF`). |
| `VNOM = OFF` | Fase e sequência negativa ficam não direcionais. |
| Limiares | `50QFP/50QRP`, `a2`, `k2`, `Z2F/Z2R`, `50GFP/50GRP`, `a0`, `Z0F/Z0R`, `Z0MTA`, `50NFP/50NRP`, `a0N`, `59RES`, `DIRWFP/DIRWRP/DIRWD`, `50PDIRP`, `EDIRIV` (SELogic), `Z1ANG`, `ELOAD` e `ZLF/PLAF/NLAF/ZLR/PLAR/NLAR`, `EPHI1/2` e demais ajustes PHI. Faltando um ajuste, vale o padrão de fábrica da tabela 4.28 (5 A; ×1/5 em corrente e ×5 em impedância para TC de 1 A). |

### Elementos

- **Q (seq. negativa, 4.29/4.32/4.57):** `50QF/50QR` (|3I2| ≥ 50QFP/50QRP), `DIRQE` (`|I2| > a2·|I1|`, sem `LOP`, `VNOM ≠ OFF`), `DIRQGE` (`|I2| > k2·|I0|`). `Z2 = Re[V2·(I2∠Z1ANG)*]/|I2|²`; à frente se `Z2 <` limiar direto (`0,75·Z2F − 0,25·|V2/I2|`, ou `1,25·Z2F − …` se `Z2F > 0`), reverso se `Z2 >` limiar reverso (`0,75·Z2R + 0,25·|V2/I2|` ou `1,25·Z2R + …` se `Z2R < 0`). Gera `FDIRQ/RDIRQ` (fase/seq. neg.) e `FDIRQG/RDIRQG` (terra).
- **V (seq. zero por tensão, 4.30/4.33):** `50GF/50GR` (|IG| ≥ 50GFP/50GRP), `DIRVE` (`|I0| > a0·|I1|`, `EDIRIV`, sem `LOP` salvo `VSCONN = 3V0`); `Z0 = Re[3V0·(IG∠Z0MTA)*]/|IG|²` com os mesmos limiares (`Z0F/Z0R`). `3V0` = VA + VB + VC calculado.
- **S (baixa impedância, 4.31/4.35) e U (isolado/alta impedância, 4.37):** usam `3V0` e o canal IN (`IN` = soma fasorial das correntes de fase ÷ `CTRN`). `S`: `Z0F/Z0R` ajustados à base do IN (× `CTRN/CTR`). `U`: `Z0F = −0,10 Ω`, `Z0R = +0,10 Ω` e ângulo fixo de −90°. Habilitação `DIRNE`: `|IN| > a0N·|I1|`, sem `DIRQGE`/`DIRVE`, `EDIRIV`. Bits `LZFWD/LZREV` e `UGFWD/UGREV`.
- **P (wattmétrico, Petersen, 4.36):** `P0 = Re(3V0·IN*)`; à frente se `P0 < −(0,9375·DIRWFP + 0,0625·|3V0·IN|)`, reverso se `P0 > 0,9375·DIRWRP + 0,0625·|3V0·IN|`, com `|3V0| > 59RES`, `|IN| > 0,005 A`, atraso `DIRWD` e bloqueio de 30 ciclos após qualquer mudança do 52A. Bits `FDIRWI/RDIRWI` (instantâneos) e `FDIRW/RDIRW`.
- **PHI (4.43 a 4.49):** dois níveis (`EPHI1/2`), ângulo `φ = ∠IN − ∠3V0` (0° a 360°), setores `FWD1ANG…FWD2ANG` e `REV1ANG…REV2ANG`, linhas de torque máximo `FWDMTA/REVMTA`, magnitude `|IN|·|cos(φ − MTA)| ≥ PHIFWDP/PHIREVP` (`OFF` desabilita), atraso `PHIDLY`, controle de torque `PHITCn`. Bits `PHIFWDn/PHIREVn`, `EPHIn`; com `PHIROUT = Y` (e `ORDER` contendo `P` ou `U`) substituem `FDIRN/RDIRN`, escolhidos por `PHI2SEL`.
- **Fase (4.58/4.59):** `50PDIR` (todas as correntes de linha ≥ `√3·50PDIRP`; fixo em 0,1·INOM com `ELOAD = Y`). Positiva: `FDIRP` quando `Re[V1·(I1∠Z1ANG)*] > 0` (e `RDIRP` quando < 0), com a sequência negativa tendo prioridade. Polarização `V1` com memória de 0,1 s. `DIRPF = FDIRQ OU FDIRP OU (EFWDLOP E LOP)`, `DIRPR = RDIRQ OU RDIRP`; nunca os dois ao mesmo tempo.
- **Load-encroachment (`ELOAD`):** `ZLOAD = ZLOUT OU ZLIN`; `Z1 = V1/I1`, carga à frente quando `|Z1| ≥ ZLF` e o ângulo está entre `NLAF` e `PLAF` (reversa: `|Z1| ≥ ZLR`, entre `PLAR` e `NLAR`). Desabilita o elemento de sequência positiva.
- **Falta estável (`DIRSTAB`, 4.50):** `|3V0| > 5 V` e variação < 1 V entre varreduras, por 1 ciclo.
- **Roteamento e níveis (4.39 a 4.42, 4.60, 4.61):** `DIRGF/DIRGR` (residual) e `DIRNF/DIRNR` (neutro) combinam os elementos de terra; cada nível `n` libera quando (`DIRn = F` e frente) ou (`DIRn = N`) ou (`DIRn = R` e reverso).

### Efeito nos elementos 50/51

Quando o nível está bloqueado (`xnDIR = 0`) o elemento é desabilitado como no controle de torque (partida e atuação caem, o disco do 51 rearma). Os bits `67xnP/67xnT` espelham `50xnP/50xnT` (o relé nomeia as versões controladas por sentido como 67); a coluna **Sentido** da tabela de proteção mostra `LIBERA/BLOQUEIA`.
A perda de potencial é acionada pelo usuário (chave **Perda de potencial (LOP)** nos auxiliares), pois a lógica de detecção (figura 4.110) não consta do material.

### Limitações

- **Canal IN polarizado por corrente (`I`)** não existe: a simulação não tem um TC de polarização independente (o IN é a soma das fases); `DIRIE`, `FDIRI/RDIRI` ficam em 0.
- Sem condutância incremental (`FDIRC/RDIRC`) e sem a falta intermitente direcional (IGF, usa amostras brutas de `3V0` e `IN`).
- `3V0` é sempre o calculado (VA + VB + VC); não há canal `VS`. Com `DELTA_Y = DELTA` e `VSCONN = VS` os elementos de sequência zero ficam indisponíveis; `GNDSW` (troca IN↔IG) não é simulada.
- A região de carga (figura 4.74) e a memória de polarização usam a convenção padrão da SEL, não as figuras originais.

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
