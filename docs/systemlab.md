# SystemLab

Aplicativo do Eclipse para **montar um sistema elÃ©trico em diagrama unifilar** e simular tensÃµes, correntes e potÃªncias.
O usuÃ¡rio arrasta elementos de uma barra lateral, liga seus terminais, ajusta parÃ¢metros e vÃª os resultados em tempo real.
Rota: `#/systemlab`.

Ã‰ um aplicativo **somente de frontend** (nÃ£o usa o backend): o editor e o solver rodam no navegador.

| Arquivo | ConteÃºdo |
|---|---|
| `frontend/src/systemlab/model.ts` | Tipos (`El`, `Wire`, `Diagram`), catÃ¡logo de elementos (rÃ³tulos, parÃ¢metros padrÃ£o, campos do painel), geometria dos terminais e Ã¡reas de captura. |
| `frontend/src/systemlab/solver.ts` | Solver de regime permanente (anÃ¡lise nodal em por unidade). |
| `frontend/src/systemlab/symbols.tsx` | SÃ­mbolos unifilares em SVG. |
| `frontend/src/systemlab/SystemLabApp.tsx` | Editor (toolbox, canvas, ligaÃ§Ãµes), painel de propriedades/resultados e resumo do sistema. |

## Elementos

| Elemento | Terminais | SÃ­mbolo | Prefixo do nome |
|---|---|---|---|
| Fonte | 1 | cÃ­rculo com senoide | `G` |
| Barramento | `cells + 1` (um a cada 20 px) | barra grossa | `BA` |
| Disjuntor | 2 | quadrado (**cheio** = fechado, **vazio** = aberto) | `DJ` |
| Chave seccionadora | 2 | lÃ¢mina entre dois contatos (reta = fechada, inclinada = aberta) | `SC` |
| Transformador | 2 | dois cÃ­rculos sobrepostos | `TR` |
| Carga | 1 | triÃ¢ngulo | `CG` |
| TP | 1 | duas semicircunferÃªncias em "U" sobre duas em "âˆ©", com eixo vertical | `TP` |
| TC | 2 | linha com bobina (trÃªs arcos) | `TC` |

Os nomes sÃ£o gerados automaticamente (`DJ1`, `DJ2`, â€¦) e podem ser editados no painel.

### ParÃ¢metros (painel Ã  direita)

| Elemento | ParÃ¢metro | PadrÃ£o |
|---|---|---|
| Fonte | TensÃ£o nominal fase-fase (kV) | 69 |
| | Ã‚ngulo da tensÃ£o (Â°) | 0 |
| | PotÃªncia de curto-circuito (MVA) | 500 |
| | RelaÃ§Ã£o X/R | 10 |
| Disjuntor / Seccionadora | Fechado | sim |
| Transformador | PotÃªncia nominal (MVA) | 20 |
| | TensÃ£o nominal do terminal 1 / terminal 2 (kV) | 69 / 13,8 |
| | ImpedÃ¢ncia (%) | 8 |
| | RelaÃ§Ã£o X/R | 10 |
| Barramento | Comprimento (cÃ©lulas de 20 px; arredondado para par, 2 a 40) | 8 |
| Carga | PotÃªncia ativa (MW) | 10 |
| | Fator de potÃªncia | 0,92 |
| | Capacitiva (adiantada) | nÃ£o (indutiva) |
| TP | PrimÃ¡rio fase-fase (kV) / SecundÃ¡rio fase-fase (V) | 13,8 / 115 |
| TC | PrimÃ¡rio (A) / SecundÃ¡rio (A) | 600 / 5 |

Campos numÃ©ricos aceitam vÃ­rgula ou ponto; o valor Ã© aplicado enquanto se digita, respeitando o mÃ­nimo de cada campo.

## Editor

### Inserir elementos

- **Arrastar** um item da barra lateral atÃ© a Ã¡rea central. A imagem que acompanha o mouse Ã© **sÃ³ o sÃ­mbolo** (sem borda nem
  nome), na escala atual do zoom. O elemento Ã© colocado alinhado Ã  grade de 20 px.
- **Duplo clique** em um item da barra o insere no centro da Ã¡rea visÃ­vel (alternativa ao arraste).
- **TC sobre uma ligaÃ§Ã£o:** ao soltar um TC a atÃ© 14 px de uma ligaÃ§Ã£o, ele **entra em sÃ©rie**: a ligaÃ§Ã£o Ã© removida e
  substituÃ­da por duas, uma de cada ponta atÃ© os terminais do TC. O TC Ã© alinhado ao trecho (horizontal ou vertical) e o
  terminal mais prÃ³ximo da ponta original recebe aquela ponta. Soltado longe de qualquer ligaÃ§Ã£o, vira um TC solto.
- **Carregar exemplo** (botÃ£o da barra superior) cria um sistema pronto: fonte â†’ disjuntor â†’ barra â†’ transformador â†’ barra â†’
  disjuntor â†’ TC â†’ carga, com um TP na barra de saÃ­da.

### SeleÃ§Ã£o mÃºltipla

- **RetÃ¢ngulo de seleÃ§Ã£o:** arraste com o botÃ£o esquerdo no fundo do diagrama; todo elemento tocado pelo retÃ¢ngulo Ã© selecionado enquanto vocÃª arrasta.
- **Shift/Ctrl+clique** em um elemento o inclui ou retira da seleÃ§Ã£o (com Shift/Ctrl pressionado, o retÃ¢ngulo soma Ã  seleÃ§Ã£o atual). **Ctrl+A** seleciona todos.
- **Mover em grupo:** arraste qualquer elemento selecionado e o grupo inteiro se move junto (mantendo a grade de 20 px); as ligaÃ§Ãµes acompanham.
- **Excluir / girar em grupo:** **Delete** (ou o botÃ£o "Excluir N") remove todos os selecionados e as ligaÃ§Ãµes deles; **R** gira cada um no prÃ³prio lugar.
- Com mais de um elemento selecionado, o painel da direita lista os nomes e oferece Girar/Excluir.

### Mover, girar, excluir

- **Mover:** arrastar o elemento (fica na grade; se ele estiver numa seleÃ§Ã£o mÃºltipla, move o grupo). Enquanto arrasta, sÃ³ o **sÃ­mbolo** Ã© desenhado (somem borda de seleÃ§Ã£o, nome,
  valores e terminais). As ligaÃ§Ãµes acompanham.
- **Girar:** botÃ£o "â†» Girar" ou tecla **R** (passos de 90Â° no sentido horÃ¡rio). Os nomes e valores ficam sempre na horizontal.
- **Excluir:** botÃ£o "Excluir" ou **Delete/Backspace**. Excluir elementos remove tambÃ©m as ligaÃ§Ãµes deles.
- **Esc** cancela a ligaÃ§Ã£o em andamento e limpa a seleÃ§Ã£o.

### Ligar terminais

Cada terminal Ã© um ponto (â—). Duas formas:

1. **Clique e clique:** clique em um terminal e depois em outro.
2. **Arrastar:** arraste de um terminal atÃ© outro.

Uma linha tracejada acompanha o mouse durante a ligaÃ§Ã£o; soltar em Ã¡rea vazia cancela. NÃ£o se liga um elemento a ele mesmo e
ligaÃ§Ãµes duplicadas sÃ£o ignoradas. Um terminal aceita vÃ¡rias ligaÃ§Ãµes. A ligaÃ§Ã£o Ã© desenhada com trajeto ortogonal (em
"degrau") e fica na cor de **energizada** (azul) ou **desenergizada** (cinza); clicar nela a seleciona (contorno mais grosso)
e o painel permite excluÃ­-la.

No barramento, os terminais sÃ³ aparecem quando hÃ¡ uma ligaÃ§Ã£o em andamento, com o barramento selecionado ou com o mouse sobre ele.

### Desenho das ligaÃ§Ãµes

Por padrÃ£o a ligaÃ§Ã£o segue um trajeto automÃ¡tico em "degrau". Para reorganizar o desenho:

- **Arraste um trecho** da ligaÃ§Ã£o (a ligaÃ§Ã£o selecionada mostra um quadradinho no meio de cada trecho): o trecho se desloca na perpendicular, na grade de 20 px. Nos trechos presos a um terminal, o arraste cria um cotovelo, de modo que o terminal nÃ£o sai do lugar.
- O trajeto manual Ã© guardado na ligaÃ§Ã£o (`via`, no diagrama salvo) e acompanha os elementos: se os dois extremos se movem juntos (seleÃ§Ã£o mÃºltipla), os pontos vÃ£o com eles; se sÃ³ um extremo se move, os cotovelos sÃ£o ajustados automaticamente.
- **Duplo clique** na ligaÃ§Ã£o (ou o botÃ£o "Trajeto automÃ¡tico" do painel) volta ao trajeto automÃ¡tico.

### Ocultar nome e dados

Cada elemento tem a caixa **Ocultar nome e dados no diagrama** no painel de propriedades (Ãºtil para deixar o desenho limpo). Com vÃ¡rios elementos selecionados, o painel tem os botÃµes "Ocultar/Mostrar nomes e dados". Os resultados continuam disponÃ­veis no painel ao selecionar o elemento.

### Estado de chaves

**Duplo clique** em disjuntor ou seccionadora abre/fecha, ou use a caixa "Fechado/Fechada" do painel. O resultado Ã© recalculado
imediatamente.

### Vista

- **Zoom:** roda do mouse (30 % a 250 %, centrado no cursor).
- **Mover a vista:** arrastar o fundo com o **botÃ£o do meio ou direito**, ou **EspaÃ§o + arrastar** (o botÃ£o esquerdo no fundo desenha o retÃ¢ngulo de seleÃ§Ã£o; clicar no fundo limpa a seleÃ§Ã£o).
- **Centralizar vista:** volta a 100 % e Ã  posiÃ§Ã£o inicial.
- **Mostrar valores:** liga/desliga os resultados escritos sobre o diagrama.
- **Limpar tudo:** apaga o diagrama (pede confirmaÃ§Ã£o se houver elementos).
- A barra mostra o zoom, o nÃºmero de elementos e de ligaÃ§Ãµes.

O diagrama Ã© salvo automaticamente no navegador (`localStorage`, chave `systemlab.diagram`) e restaurado ao reabrir.

## Resultados na tela

Abaixo do nome de cada elemento (com "Mostrar valores" ligado):

| Elemento | Mostra |
|---|---|
| Barramento | tensÃ£o fase-fase (kV âˆ Â°) ou "desenergizado" |
| Fonte | P e Q fornecidos |
| Carga | P e Q consumidos e a tensÃ£o (kV) |
| Disjuntor / Seccionadora | corrente (A), "aberto" ou "desenergizado" |
| TC | corrente primÃ¡ria â†’ corrente secundÃ¡ria |
| Transformador | P no terminal 1 e carregamento (% da potÃªncia nominal) |
| TP | tensÃ£o secundÃ¡ria (V) |

Elementos energizados sÃ£o desenhados em azul; desenergizados, em cinza.

### Painel de propriedades

- **Elemento selecionado:** nome, parÃ¢metros, botÃµes Girar/Excluir e a tabela **Resultados**, com tensÃ£o (kV âˆ Â°),
  corrente (A âˆ Â°), P (MW) e Q (Mvar) por terminal, mais: relaÃ§Ã£o e tensÃ£o secundÃ¡ria (TP), relaÃ§Ã£o e corrente secundÃ¡ria (TC),
  carregamento e perdas (transformador). ConvenÃ§Ã£o: nos elementos de dois terminais, as grandezas sÃ£o positivas **entrando no
  elemento**; a P do terminal 1 Ã© o fluxo do terminal 1 para o 2. A **chave seccionadora nÃ£o mostra a tabela de resultados**.
- **Sem seleÃ§Ã£o:** **Resumo do sistema** com geraÃ§Ã£o, carga e perdas dos transformadores, lista de barramentos (clicÃ¡vel) e
  mediÃ§Ãµes (TC e TP).

## Modelo de cÃ¡lculo (`solver.ts`)

Regime permanente **trifÃ¡sico equilibrado**, em **por unidade**, com **Sbase = 100 MVA**, resolvido por **anÃ¡lise nodal**
(sistema linear complexo `YÂ·V = I`, eliminaÃ§Ã£o de Gauss com pivoteamento).

1. **NÃ³s elÃ©tricos:** terminais ligados por fios formam um nÃ³; todos os terminais de um barramento sÃ£o o mesmo nÃ³.
2. **Bases de tensÃ£o:** a partir de cada fonte, a base do nÃ³ Ã© a tensÃ£o nominal da fonte; ao atravessar um transformador, a base Ã©
   multiplicada por `V2/V1` (ou o inverso). Disjuntores, chaves e TCs mantÃªm a base (mesmo abertos, para que as bases sejam
   consistentes).
3. **Ramos e injeÃ§Ãµes:**
   - **Fonte:** tensÃ£o atrÃ¡s de impedÃ¢ncia (Norton). `Z_s = (SBASE/Scc)Â·(V/Vbase)Â²`, com mÃ³dulo dividido entre R e X conforme X/R.
     `E = (V/Vbase)âˆ Î¸`.
   - **Transformador:** impedÃ¢ncia sÃ©rie `Z = (z%/100)Â·(SBASE/Sn)Â·(V1/Vbaseâ‚)Â²`, X/R informado. Sem derivaÃ§Ã£o (tap): a relaÃ§Ã£o Ã© a
     nominal. Para o transformador, os terminais 1 e 2 correspondem a V1 e V2.
   - **Disjuntor/Seccionadora fechados e TC:** admitÃ¢ncia muito alta (`1e4` pu, Z = 10â»â´ pu); **abertos**: ramo inexistente.
   - **Carga:** **impedÃ¢ncia constante** calculada na **tensÃ£o nominal da zona**: `y = conj((P + jQ)/SBASE)`, com
     `Q = PÂ·tan(acos(FP))` (negativo se capacitiva). Por isso a potÃªncia real cai com o quadrado da tensÃ£o.
   - **TP:** nÃ£o influencia o sistema (apenas mede).
4. **EnergizaÃ§Ã£o:** sÃ³ sÃ£o resolvidos os conjuntos de nÃ³s ligados (por ramos fechados) a pelo menos uma fonte; o resto fica com
   tensÃ£o zero e aparece como **desenergizado**. Com vÃ¡rias fontes, o Ã¢ngulo de cada uma Ã© respeitado (a primeira define a base de tensÃ£o
   da zona).
5. **Resultados** (por terminal): tensÃ£o `|V_pu|Â·Vbase` (kV fase-fase) e Ã¢ngulo; corrente de linha `|I_pu|Â·Sbase/(âˆš3Â·Vbase)` em A;
   potÃªncia `S = VÂ·conj(I)Â·Sbase` (MW/Mvar). No transformador, cada lado usa a sua base de corrente. Fonte: P/Q entregues, soma
   em "GeraÃ§Ã£o". TP: `V_sec = V_prim_medido/Vp_nominal Â· Vs_nominal`. TC: `I_sec = I/(Ip/Is)`. Carregamento do transformador:
   `|Sâ‚|/Sn`. Perdas: `Pâ‚ + Pâ‚‚`.

### Exemplo de verificaÃ§Ã£o

Fonte 69 kV (500 MVA) â†’ disjuntor â†’ barra â†’ transformador 69/13,8 kV, 20 MVA, 8 % â†’ barra â†’ disjuntor â†’ TC 600/5 â†’ carga de
10 MW, FP 0,92 indutivo: a tensÃ£o na carga fica em â‰ˆ 13,36 kV (queda de â‰ˆ 3,2 %), a corrente em â‰ˆ 440 A (secundÃ¡rio do TC â‰ˆ 3,67 A),
a carga efetiva em â‰ˆ 9,37 MW (10 MW Ã— 0,968Â²) e o carregamento do transformador em â‰ˆ 52 %. Abrindo o disjuntor da carga, a carga e o TC ficam
desenergizados; abrindo o da fonte, tudo a jusante fica desenergizado.

## LimitaÃ§Ãµes atuais

- Sem **faltas** (curto-circuito), sem **desequilÃ­brio** entre fases e sem **componentes de sequÃªncia**.
- Carga de **potÃªncia constante** nÃ£o existe (apenas impedÃ¢ncia constante); sem variaÃ§Ã£o de tensÃ£o por tap de transformador.
- Sem linhas/cabos, geradores com controle de tensÃ£o (barra PV), capacitores/reatores e motores.
- Elementos sem fonte conectada nÃ£o sÃ£o calculados (tensÃ£o zero); loops com bases inconsistentes nÃ£o sÃ£o tratados.
- Os resultados dos TC/TP sÃ£o sÃ³ de mediÃ§Ã£o; nÃ£o alimentam outro app (por enquanto).

## Barramento ajustÃ¡vel e painÃ©is recolhÃ­veis

- **Comprimento do barramento:** com o barramento selecionado (clique na linha do resumo ou no sÃ­mbolo), arraste os quadradinhos das pontas para alongar/encurtar (passos de 2 cÃ©lulas de 20 px, atÃ© 200). O campo "Comprimento" tambÃ©m funciona. As ligaÃ§Ãµes acompanham seus terminais; as dos terminais removidos ao encurtar sÃ£o apagadas.
- **PainÃ©is laterais:** os painÃ©is "Elementos" (esquerda) e "Propriedades/Resultados" (direita) tÃªm um botÃ£o â—€/â–¶ no topo para recolher e expandir; o estado fica em `localStorage` `systemlab.panels`.

## Header do Eclipse

O header mostra o **nome do app atual** ao lado do logo e o menu suspenso **Apps â–¾** para trocar de mÃ³dulo sem voltar Ã  Home (`frontend/src/eclipse/EclipseShell.tsx`, lista vinda de `apps.ts`).

## IED (comunicação GOOSE)

Dois elementos da barra esquerda nÃ£o tÃªm efeito elÃ©trico (o solver os ignora) e servem Ã  simulaÃ§Ã£o de GOOSE entre relÃ©s do DigitalRelay:

- **IED:** sÃ­mbolo de frontal de relÃ© (corpo azul, display e dois botÃµes, sem nome de modelo). Nas propriedades escolha o **relÃ© do DigitalRelay** (sessÃ£o ativa; um relÃ© sÃ³ pode estar em um IED do diagrama) e, se quiser, o **IED do projeto IEC61850** que ele simula. Depois de escolher o relÃ©, associe-o a elementos do diagrama:
  - **Disjuntor monitorado:** o estado segue nos dois sentidos. Abrir/fechar o disjuntor no diagrama move o disjuntor do relÃ© (a entrada 52A acompanha); se o relÃ© abrir (ex.: TRIP), o disjuntor do diagrama abre.
  - **TC (correntes):** a corrente do TC no sistema simulado (valor primÃ¡rio, trifÃ¡sico equilibrado, com o Ã¢ngulo do solver) Ã© injetada como IA/IB/IC do relÃ©. Sem energia, zero.
  - **TP (tensÃµes):** a tensÃ£o do TP (fase-fase Ã· âˆš3, valor primÃ¡rio) Ã© injetada como VA/VB/VC. A injeÃ§Ã£o analÃ³gica do relÃ© Ã© ligada.
  O envio Ã© feito ao mudar o diagrama e repetido a cada ~5 s; enquanto houver associaÃ§Ã£o, ele prevalece sobre valores digitados na janela de injeÃ§Ã£o.

**Regra:** não há elemento de rede. Dois IEDs do diagrama associados a relés do **mesmo projeto IEC61850** (app IEC61850, aba "Simulação") se comunicam por GOOSE automaticamente; o que decide é o vínculo relé ↔ IED do projeto, os ajustes (E61850/EGSE, assinaturas) e as condições de falha (latência, perda, cabo) do app IEC61850.

### Atalhos na tela (IED)

Com um relé associado ao IED, a seção **Atalhos na tela (mapa DNP3)** das propriedades monta um **painel flutuante** sobre o diagrama (arraste pelo cabeçalho; ▾/▸ recolhe) para facilitar a análise sem sair do SystemLab. Só podem ser associados **pontos do mapa DNP3 do relé** (os `NA` não aparecem):

- **Comando (BO):** botão que envia o comando `PULSE_ON` direto ao ponto (mesmo caminho da aba DNP3; a resposta, como `SUCCESS` ou `NOT_SUPPORTED`, aparece no painel).
- **Valor binário (BI):** lâmpada com 0/1 do ponto.
- **Medida (AI):** valor do ponto, com unidade sugerida.

Os valores são lidos do mapa a cada 0,7 s. Rótulos são editáveis (padrão = descrição do ponto) e a ordem pode ser alterada (▲▼). Se o mapa DNP3 do relé for trocado e o índice passar a apontar para outro bit, o atalho fica inativo (`–`). Os atalhos ficam salvos no diagrama (`systemlab.diagram`).

## Transformador de 3 enrolamentos

Elemento com **três terminais**: 1 = **P** (primário), à esquerda; 2 = **S** (secundário), à direita acima; e 3 = **T** (terciário), à direita abaixo (símbolo de três círculos). Parâmetros: potência e tensão nominais de cada enrolamento, impedâncias **P–S, P–T e S–T (%)** na base da potência de P, X/R e o **esquema de ligação** (YNyn0d1, YNyn0d11, YNyn0yn0, YNyn0y0, YNd1d1, YNd11d11, Dyn1yn1, Dyn11yn11, Dd0d0, Dy11y11).

Modelo: as impedâncias dos três enrolamentos vêm do equivalente em estrela (Zp = (Zps + Zpt − Zst)/2, e analogamente Zs e Zt; Zs ou Zt podem sair ≈ 0 ou negativos, como no transformador real) convertido para delta entre os terminais, com a defasagem de cada par dada pelos índices horários do esquema (S e T em relação a P). Vale no regime normal e na falta. Sequência zero: enrolamento **Y aterrado** liga o terminal ao ponto comum pela impedância do enrolamento; **Δ** aterra o ponto comum (fecha a malha); **Y isolado** não conduz. O resultado mostra tensão, corrente e potência dos três terminais, o carregamento de P e as perdas.
## Linha

Elemento de dois terminais com **comprimento (km)** e **impedância por km**: **R** e **Xl** de sequência positiva/negativa (Ω/km) e **R0/Xl0** de sequência zero (usados nas faltas à terra). A impedância total é comprimento × impedância por km (convertida para pu na tensão de base do trecho); não há capacitância shunt. Nas propriedades aparecem a impedância total, as perdas e as grandezas de cada terminal.

**Falta em um ponto da linha:** no elemento **Falta**, escolha **Aplicar em uma linha** e informe a **Posição na linha (0 a 100 %)** contada a partir do terminal 1 (ex.: 10 %, 50 %). A linha é dividida em dois trechos (p·Z e (1−p)·Z, nas sequências positiva, negativa e zero) e a falta é aplicada no nó entre eles, sem precisar ligar o terminal da falta. O painel "Em falta" mostra o ponto (ex.: "A-N a 10 % de LT1"), as impedâncias de Thévenin e as correntes/tensões nos terminais da linha. Com a opção em branco, a falta continua valendo no ponto ligado ao terminal.
## Faltas (curto-circuito)

O elemento **Falta** (barra de elementos) tem um terminal que se liga a **qualquer ponto** do diagrama (barramento ou terminal de qualquer elemento). **Derivação em um trecho:** arraste a partir de um terminal (ex.: o da falta) e solte sobre uma ligação existente, ou clique no terminal e depois no trecho. A ligação encosta no trecho com um ponto de junção (mesmo nó elétrico da ligação-alvo) e acompanha o trecho se ele mudar de lugar; apagar a ligação-alvo apaga as derivações.

Propriedades: **Falta aplicada** (liga/desliga), **Tipo de falta** e **Resistência de falta** (Ω).

Tipos: trifásica ABC; monofásica A-N, B-N, C-N; bifásica A-B, B-C, C-A; bifásica com neutro A-B-N, B-C-N, C-A-N. Fórmulas padrão por componentes simétricas (Rf na falta trifásica/bifásica entre fases; por fase à terra na monofásica; no caminho da terra na bifásica com neutro).

**Aterramento (modelo):**
- **Fonte (gerador):** *Neutro aterrado* e *Z0/Z1* (seq. zero). Fonte sem aterramento não fornece sequência zero.
- **Transformador:** o **esquema de ligação** (campo da propriedade; ex.: Dyn1, Dyn11, YNd1, YNyn0, Dd0…) define Δ/Y/Y aterrado de cada lado e a defasagem. Maiúsculas = terminal 1 (alta), minúsculas = terminal 2; N/
 = neutro aterrado; o número é o índice horário (a tensão do terminal 2 atrasa a do 1 em n × 30°). A defasagem vale no regime normal e na falta (sequência negativa com sinal oposto). Sequência zero: YNyn passa de um lado ao outro; YNd/Dyn só fecha o caminho do lado aterrado (impedância do trafo); demais ligações bloqueiam.
- Carga e inversor: passivos nas sequências negativa; zero aberta. Inversor seguidor mantém a corrente pré-falta; formador entra como fonte de tensão com 5 % de impedância.

**Ver antes de rodar:** com a Falta aplicada, selecione-a (ou qualquer elemento) para ver, **sem dar Play**, a tensão fase-neutro e a corrente de cada terminal por **fase (A, B, C)** e por **componente de sequência (+, −, 0)**, além das impedâncias de Thévenin no ponto. O estudo sempre considera as fontes ligadas.

**Rodando:** com Play ou Pause, o diagrama passa a mostrar os valores em falta (menor tensão fase-fase e maior corrente de fase) e os **IEDs associados a TC/TP recebem os fasores por fase** (correntes e tensões desequilibradas, relés podem atuar e abrir o disjuntor associado, o que retira a falta do caminho). Uma falta por vez (a primeira aplicada). Código: `solver.ts` (`faultStudy`), elementos em `model.ts`, painel `FaultPanel` em `SystemLabApp.tsx`.

## Bateria e Inversor (BESS)

- **Bateria** (1 terminal CC): tensão CC nominal (V), capacidade (kWh), SOC (%), SOC mínimo e máximo (%).
- **Inversor** (2 terminais: 0 = CC, ligado à bateria; 1 = CA, ligado à rede): habilitado, potência nominal (MVA), **P** (MW; + descarrega/injeta na rede, − carrega a bateria), **Q** (Mvar; + injeta) e rendimento (%).

Montagem típica de um BESS: fonte → … → barramento CA → **Inversor** (terminal CA) e **Inversor** (terminal CC) → **Bateria**. Várias baterias no mesmo nó CC dividem a potência pela capacidade.

Modelo (regime permanente, `solver.ts`): com fonte na ilha CA o inversor é um **seguidor de rede** com potência constante no lado CA, resolvido por iteração; é limitado pela potência nominal (P e Q reduzidos proporcionalmente) e pelo SOC (sem descarga em SOC ≤ mínimo, sem carga em SOC ≥ máximo); com tensão CA < 0,1 pu ele desliga. **Sem fonte na ilha CA, o primeiro inversor apto (SOC acima do mínimo) forma a rede** (operação ilhada): vira uma fonte de tensão de 1 pu na "Tensão CA nominal" do inversor, com 5 % de impedância interna; P e Q passam a ser o que a carga consome (o P/Q ajustados não se aplicam) e o painel mostra "formando rede (ilhado)", com aviso se passar da potência nominal. Ajuste a **Tensão CA nominal** igual à do lado do inversor no transformador elevador (ex.: 0,48 kV). Havendo outra fonte ou outro formador na ilha, os demais inversores seguem a rede. A potência CC é P/η na descarga e P·η na carga. A bateria mostra potência e corrente CC, energia armazenada e o **tempo até o limite de SOC** na potência atual. O SOC é um parâmetro: não evolui no tempo (não há relógio na simulação). O Resumo do sistema inclui a seção "Armazenamento (BESS)" e os totais de geração/carga consideram a potência do inversor.

O lado CC aceita disjuntores, chaves e TCs entre a bateria e o inversor: eles ficam energizados (mostram tensão e corrente CC) quando a ilha CC tem bateria e inversor ativo. Com o disjuntor CC aberto, o inversor fica sem bateria (desligado).

O **Disjuntor** e a **Chave seccionadora** têm o parâmetro **Circuito CC** (desmarcado = CA). Marcado, o símbolo mostra a marca "CC". O solver identifica o tipo do circuito pela ligação (ilha CC = bateria + inversor) e avisa quando a marcação não combina (marcado como CA em circuito CC, ou como CC em circuito CA).

## Play, Pause e relógio

A barra superior do SystemLab tem **▶ Play / ⏸ Pause**, **⏹ Parar**, a **velocidade** (0,5× a 10×) e o **relógio** da simulação (mesmo formato das preferências do DigitalRelay: segundos ou hh:mm:ss:mmm).

- **Parado** (estado inicial): as fontes e os inversores ficam desligados; o diagrama aparece desenergizado e o relógio em zero.
- **Play:** as fontes se ligam, o solver energiza o sistema e o relógio corre (tempo real × velocidade). Os **relés do DigitalRelay associados aos IEDs** passam a executar (mesma velocidade), então a lógica deles abre e fecha os disjuntores ligados ao IED, e o diagrama acompanha; as correntes/tensões do TC/TP seguem para o relé.
- **Pause:** congela o relógio e pausa os relés associados; o sistema continua energizado.
- **Parar:** desliga as fontes, zera o relógio e pausa os relés associados (a lógica deles não é reiniciada).

Os relés só são controlados depois que você usa Play/Pause/Parar pela primeira vez.

## Configurações (engrenagem)

O botão ⚙ da barra do SystemLab abre as configurações: **Potência de base (Sbase, MVA; padrão 100)** e **Exibir grandezas em pu**. A base é a referência do cálculo por unidade (impedâncias, corrente de base, potências); os resultados físicos em kV, A e MW não dependem dela. Com a opção em pu, as telas mostram tensão ÷ tensão de base do terminal (kV fase-fase; fase-neutro no estudo de falta), corrente ÷ corrente de base e potências ÷ Sbase. Ficam salvas no navegador (`localStorage` `systemlab.settings`).

**Exportar/importar (JSON):** na janela ⚙, a seção *Dados da simulação* tem **Exportar JSON** (baixa systemlab-AAAA-MM-DD.json com elementos, ligações, atalhos dos IEDs e as configurações Sbase/pu) e **Importar JSON** (valida o arquivo, pede confirmação se já houver diagrama e o substitui, aplicando também as configurações do arquivo). Formato: { format: 'eclipse-systemlab', version: 1, settings, diagram: { els, wires, nextId } }. As associações de IED a relés do DigitalRelay (sid) valem só enquanto a sessão existir; reassocie ao importar em outro ambiente.
