# Lógica simulada: premissas e limitações

O simulador **não executa o firmware** do SEL-751. Ele reproduz o comportamento funcional descrito pelos arquivos de
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

- Elementos habilitados somente com pickup diferente de `OFF`.
- **50**: partida quando `|I| ≥ pickup` (rearme em 95 %), disparo após `D` segundos.
- **51**: integração da curva (U1–U5 / C1–C5) com `M = I/pickup` limitado a 20, mais `CT`. Reset instantâneo (`RS = N`) ou
  linear aproximado (`RS = Y`). *`MR` (resposta mínima) não é simulada.*
- Grandezas: `IMAX` (fase), `IA/IB/IC`, `IN` e `IG` (ambas = soma fasorial das fases, TC de neutro em conexão residual),
  `3I2`. Tensões: `VA…VC`, `VAB…VCA`, `3V0`, `3V2`, frequência.
- **Não implementados**: elementos direcionais (67), 49 (térmico), 46 (desbalanço), HIF, partida a frio, falha de disjuntor
  interna (`52ABF`), sincronismo (25), 78, 55, bloqueio por harmônicas, `E27I/E59I` (inversas de tensão), demanda.

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
- **Injeção analógica ligada/desligada** (`analog_on`, chave na tela inicial): desligada, o relé enxerga correntes e tensões
  zero (e P/Q/S zero); o disjuntor e as entradas digitais não mudam. A frequência informada é mantida.
- Falta (só pela API `/fault`; a interface não tem mais o atalho): tipos AG, BG, CG, AB, BC, CA, ABC, com corrente configurável, **permanente** ou **transitória** (some ao abrir).
  Ela **sobrepõe** as correntes inseridas nas fases envolvidas (ângulo -75°, -45°…) e afunda as tensões; sem impedância de
  fonte. Com o disjuntor aberto a corrente vista pelo relé é zero.
- **Entrada do 52A (IN101)**: com *simular o estado do disjuntor automaticamente* ligado, ela acompanha o modelo do disjuntor
  (e alternar a entrada move o disjuntor). Desligado, a entrada é livre (útil para testar 52A divergente do estado físico),
  e o disjuntor continua a abrir/fechar pelas bobinas e pelos botões *Abrir/Fechar (campo)*.
- A resolução de tempo é de **10 ms** por varredura (a 1×). Em velocidades maiores, o passo cresce proporcionalmente
  (ex.: 10× → 100 ms); use 1× para medir tempos de atuação.

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
