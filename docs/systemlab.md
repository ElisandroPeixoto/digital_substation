# SystemLab

Aplicativo do Eclipse para **montar um sistema elétrico em diagrama unifilar** e simular tensões, correntes e potências.
O usuário arrasta elementos de uma barra lateral, liga seus terminais, ajusta parâmetros e vê os resultados em tempo real.
Rota: `#/systemlab`.

É um aplicativo **somente de frontend** (não usa o backend): o editor e o solver rodam no navegador.

| Arquivo | Conteúdo |
|---|---|
| `frontend/src/systemlab/model.ts` | Tipos (`El`, `Wire`, `Diagram`), catálogo de elementos (rótulos, parâmetros padrão, campos do painel), geometria dos terminais e áreas de captura. |
| `frontend/src/systemlab/solver.ts` | Solver de regime permanente (análise nodal em por unidade). |
| `frontend/src/systemlab/symbols.tsx` | Símbolos unifilares em SVG. |
| `frontend/src/systemlab/SystemLabApp.tsx` | Editor (toolbox, canvas, ligações), painel de propriedades/resultados e resumo do sistema. |

## Elementos

| Elemento | Terminais | Símbolo | Prefixo do nome |
|---|---|---|---|
| Fonte | 1 | círculo com senoide | `G` |
| Barramento | `cells + 1` (um a cada 20 px) | barra grossa | `BA` |
| Disjuntor | 2 | quadrado (**cheio** = fechado, **vazio** = aberto) | `DJ` |
| Chave seccionadora | 2 | lâmina entre dois contatos (reta = fechada, inclinada = aberta) | `SC` |
| Transformador | 2 | dois círculos sobrepostos | `TR` |
| Carga | 1 | triângulo | `CG` |
| TP | 1 | duas semicircunferências em "U" sobre duas em "∩", com eixo vertical | `TP` |
| TC | 2 | linha com bobina (três arcos) | `TC` |

Os nomes são gerados automaticamente (`DJ1`, `DJ2`, …) e podem ser editados no painel.

### Parâmetros (painel à direita)

| Elemento | Parâmetro | Padrão |
|---|---|---|
| Fonte | Tensão nominal fase-fase (kV) | 69 |
| | Ângulo da tensão (°) | 0 |
| | Potência de curto-circuito (MVA) | 500 |
| | Relação X/R | 10 |
| Disjuntor / Seccionadora | Fechado | sim |
| Transformador | Potência nominal (MVA) | 20 |
| | Tensão nominal do terminal 1 / terminal 2 (kV) | 69 / 13,8 |
| | Impedância (%) | 8 |
| | Relação X/R | 10 |
| Barramento | Comprimento (células de 20 px; arredondado para par, 2 a 40) | 8 |
| Carga | Ajuste da potência: *P e Q nominais* (MW, Mvar; Q negativo = capacitiva) ou *S e fator de potência* (MVA, FP, capacitiva) | P e Q |
| | Potência ativa (MW) / Fator de potência | 10 / 0,92 indutivo (Q ≈ 4,26 Mvar) |
| TP | Primário fase-fase (kV) / Secundário fase-fase (V) | 13,8 / 115 |
| TC | Primário (A) / Secundário (A) | 600 / 5 |

Campos numéricos aceitam vírgula ou ponto; o valor é aplicado enquanto se digita, respeitando o mínimo de cada campo.

## Editor

### Inserir elementos

- **Arrastar** um item da barra lateral até a área central. A imagem que acompanha o mouse é **só o símbolo** (sem borda nem
  nome), na escala atual do zoom. O elemento é colocado alinhado à grade de 20 px.
- **Duplo clique** em um item da barra o insere no centro da área visível (alternativa ao arraste).
- **TC sobre uma ligação:** ao soltar um TC a até 14 px de uma ligação, ele **entra em série**: a ligação é removida e
  substituída por duas, uma de cada ponta até os terminais do TC. O TC é alinhado ao trecho (horizontal ou vertical) e o
  terminal mais próximo da ponta original recebe aquela ponta. Soltado longe de qualquer ligação, vira um TC solto.
- **Polaridade do TC:** a bolinha (●) junto à bobina marca o lado da polaridade. Padrão: terminal 1 — a corrente que entra pelo
  terminal 1 e sai pelo 2 chega ao relé no sentido positivo ("frente" do direcional = 1→2). O botão **Inverter polaridade**
  (Ações) passa a marca para o terminal 2 sem mexer no desenho nem nas ligações: as correntes enviadas ao relé (e às medições do IED)
  giram 180°. Fica em `p.pol` (0 = terminal 1, 1 = terminal 2).
- **Carregar exemplo** (botão da barra superior) cria um sistema pronto: fonte → disjuntor → barra → transformador → barra →
  disjuntor → TC → carga, com um TP na barra de saída.

### Seleção múltipla

- **Retângulo de seleção:** arraste com o botão esquerdo no fundo do diagrama; todo elemento tocado pelo retângulo é selecionado enquanto você arrasta.
- **Shift/Ctrl+clique** em um elemento o inclui ou retira da seleção (com Shift/Ctrl pressionado, o retângulo soma à seleção atual). **Ctrl+A** seleciona todos.
- **Mover em grupo:** arraste qualquer elemento selecionado e o grupo inteiro se move junto (mantendo a grade de 20 px); as ligações acompanham.
- **Excluir / girar em grupo:** **Delete** (ou o botão "Excluir N") remove todos os selecionados e as ligações deles; **R** gira cada um no próprio lugar.
- Com mais de um elemento selecionado, o painel da direita lista os nomes e oferece Girar/Excluir.

### Mover, girar, excluir

- **Mover:** arrastar o elemento (fica na grade; se ele estiver numa seleção múltipla, move o grupo). Enquanto arrasta, só o **símbolo** é desenhado (somem borda de seleção, nome,
  valores e terminais). As ligações acompanham.
- **Girar:** botão "↻ Girar" ou tecla **R** (passos de 90° no sentido horário). Os nomes e valores ficam sempre na horizontal.
- **Excluir:** botão "Excluir" ou **Delete/Backspace**. Excluir elementos remove também as ligações deles.
- **Esc** cancela a ligação em andamento e limpa a seleção.

### Ligar terminais

Cada terminal é um ponto (●). Duas formas:

1. **Clique e clique:** clique em um terminal e depois em outro.
2. **Arrastar:** arraste de um terminal até outro.

Uma linha tracejada acompanha o mouse durante a ligação; soltar em área vazia cancela. Não se liga um elemento a ele mesmo e
ligações duplicadas são ignoradas. Um terminal aceita várias ligações. A ligação é desenhada com trajeto ortogonal (em
"degrau") e fica na cor de **energizada** (azul) ou **desenergizada** (cinza); clicar nela a seleciona (contorno mais grosso)
e o painel permite excluí-la.

No barramento, os terminais só aparecem quando há uma ligação em andamento, com o barramento selecionado ou com o mouse sobre ele.

### Desenho das ligações

Por padrão a ligação segue um trajeto automático em "degrau". Para reorganizar o desenho:

- **Arraste um trecho** da ligação (a ligação selecionada mostra um quadradinho no meio de cada trecho): o trecho se desloca na perpendicular, na grade de 20 px. Nos trechos presos a um terminal, o arraste cria um cotovelo, de modo que o terminal não sai do lugar.
- O trajeto manual é guardado na ligação (`via`, no diagrama salvo) e acompanha os elementos: se os dois extremos se movem juntos (seleção múltipla), os pontos vão com eles; se só um extremo se move, os cotovelos são ajustados automaticamente.
- **Duplo clique** na ligação (ou o botão "Trajeto automático" do painel) volta ao trajeto automático.

### Ocultar nome e dados

Cada elemento tem a caixa **Ocultar nome e dados no diagrama** no painel de propriedades (útil para deixar o desenho limpo). Com vários elementos selecionados, o painel tem os botões "Ocultar/Mostrar nomes e dados". Os resultados continuam disponíveis no painel ao selecionar o elemento.

### Estado de chaves

**Duplo clique** em disjuntor ou seccionadora abre/fecha, ou use a caixa "Fechado/Fechada" do painel. O resultado é recalculado
imediatamente.

**Manobra local:** abrir/fechar o disjuntor no SystemLab (mesmo associado a um IED) só move a posição física (`POST /breaker` → `engine.local_breaker`): não passa pelo relé, não aciona TRIP/CLOSE nem saídas, não parte o 79 e interrompe um religamento em curso (79 → LO). O 52A apenas acompanha a posição.

### Vista

- **Zoom:** roda do mouse (30 % a 250 %, centrado no cursor).
- **Mover a vista:** arrastar o fundo com o **botão do meio ou direito**, ou **Espaço + arrastar** (o botão esquerdo no fundo desenha o retângulo de seleção; clicar no fundo limpa a seleção).
- **Centralizar vista:** volta a 100 % e à posição inicial.
- **Mostrar valores:** liga/desliga os resultados escritos sobre o diagrama.
- **Limpar tudo:** apaga o diagrama (pede confirmação se houver elementos).
- A barra mostra o zoom, o número de elementos e de ligações.

O diagrama é salvo automaticamente no navegador (`localStorage`, chave `systemlab.diagram`) e restaurado ao reabrir.

## Resultados na tela

Abaixo do nome de cada elemento (com "Mostrar valores" ligado):

| Elemento | Mostra |
|---|---|
| Barramento | tensão fase-fase (kV ∠°) ou "desenergizado" |
| Fonte | P e Q fornecidos |
| Carga | P e Q consumidos e a tensão (kV) |
| Disjuntor / Seccionadora | corrente (A), "aberto" ou "desenergizado" |
| TC | corrente primária → corrente secundária |
| Transformador | P no terminal 1 e carregamento (% da potência nominal) |
| TP | tensão secundária (V) |

Elementos energizados são desenhados em azul; desenergizados, em cinza.

### Painel de propriedades

- **Elemento selecionado:** nome, parâmetros, botões Girar/Excluir e a tabela **Resultados**, com tensão (kV ∠°),
  corrente (A ∠°), P (MW) e Q (Mvar) por terminal, mais: relação e tensão secundária (TP), relação e corrente secundária (TC),
  carregamento e perdas (transformador). Convenção: nos elementos de dois terminais, as grandezas são positivas **entrando no
  elemento**; a P do terminal 1 é o fluxo do terminal 1 para o 2. A **chave seccionadora não mostra a tabela de resultados**.
- **Sem seleção:** **Resumo do sistema** com geração, carga e perdas dos transformadores, lista de barramentos (clicável),
  medições (TC e TP) e **Ações** (Detalhes, Limpar SER dos relés).
- **Textos explicativos** da janela ficam **ocultos**; o botão **Detalhes** (nas Ações do elemento e do Resumo) mostra ou oculta
  (`localStorage` `systemlab.hints`). Avisos (⚠) aparecem sempre.
- **Largura:** a janela é esticável pela borda esquerda, de 300 a 560 px (duplo clique na borda = 330 px; `localStorage` `systemlab.sideW`).

## Modelo de cálculo (`solver.ts`)

Regime permanente **trifásico equilibrado**, em **por unidade**, com **Sbase = 100 MVA**, resolvido por **análise nodal**
(sistema linear complexo `Y·V = I`, eliminação de Gauss com pivoteamento).

1. **Nós elétricos:** terminais ligados por fios formam um nó; todos os terminais de um barramento são o mesmo nó.
2. **Bases de tensão:** a partir de cada fonte, a base do nó é a tensão nominal da fonte; ao atravessar um transformador, a base é
   multiplicada por `V2/V1` (ou o inverso). Disjuntores, chaves e TCs mantêm a base (mesmo abertos, para que as bases sejam
   consistentes).
3. **Ramos e injeções:**
   - **Fonte:** tensão atrás de impedância (Norton). `Z_s = (SBASE/Scc)·(V/Vbase)²`, com módulo dividido entre R e X conforme X/R.
     `E = (V/Vbase)∠θ`.
   - **Transformador:** impedância série `Z = (z%/100)·(SBASE/Sn)·(V1/Vbase₁)²`, X/R informado. Sem derivação (tap): a relação é a
     nominal. Para o transformador, os terminais 1 e 2 correspondem a V1 e V2.
   - **Disjuntor/Seccionadora fechados e TC:** admitância muito alta (`1e4` pu, Z = 10⁻⁴ pu); **abertos**: ramo inexistente.
   - **Carga:** **impedância constante** calculada na **tensão nominal da zona**: `y = conj((P + jQ)/SBASE)`, com P e Q
     guardados (`loadPQ`; diagramas antigos com só P, FP e capacitiva usam `Q = P·tan(acos(FP))`, negativo se capacitiva).
     Por isso a potência real cai com o quadrado da tensão.
   - **TP:** não influencia o sistema (apenas mede).
4. **Energização:** só são resolvidos os conjuntos de nós ligados (por ramos fechados) a pelo menos uma fonte; o resto fica com
   tensão zero e aparece como **desenergizado**. Com várias fontes, o ângulo de cada uma é respeitado (a primeira define a base de tensão
   da zona).
5. **Resultados** (por terminal): tensão `|V_pu|·Vbase` (kV fase-fase) e ângulo; corrente de linha `|I_pu|·Sbase/(√3·Vbase)` em A;
   potência `S = V·conj(I)·Sbase` (MW/Mvar). No transformador, cada lado usa a sua base de corrente. Fonte: P/Q entregues, soma
   em "Geração". TP: `V_sec = V_prim_medido/Vp_nominal · Vs_nominal`. TC: `I_sec = I/(Ip/Is)`. Carregamento do transformador:
   `|S₁|/Sn`. Perdas: `P₁ + P₂`.

### Exemplo de verificação

Fonte 69 kV (500 MVA) → disjuntor → barra → transformador 69/13,8 kV, 20 MVA, 8 % → barra → disjuntor → TC 600/5 → carga de
10 MW, FP 0,92 indutivo: a tensão na carga fica em ≈ 13,36 kV (queda de ≈ 3,2 %), a corrente em ≈ 440 A (secundário do TC ≈ 3,67 A),
a carga efetiva em ≈ 9,37 MW (10 MW × 0,968²) e o carregamento do transformador em ≈ 52 %. Abrindo o disjuntor da carga, a carga e o TC ficam
desenergizados; abrindo o da fonte, tudo a jusante fica desenergizado.

## Limitações atuais

- Sem **faltas** (curto-circuito), sem **desequilíbrio** entre fases e sem **componentes de sequência**.
- Carga de **potência constante** não existe (apenas impedância constante); sem variação de tensão por tap de transformador.
- Sem linhas/cabos, geradores com controle de tensão (barra PV), capacitores/reatores e motores.
- Elementos sem fonte conectada não são calculados (tensão zero); loops com bases inconsistentes não são tratados.
- Os resultados dos TC/TP são só de medição; não alimentam outro app (por enquanto).

## Barramento ajustável e painéis recolhíveis

- **Comprimento do barramento:** com o barramento selecionado (clique na linha do resumo ou no símbolo), arraste os quadradinhos das pontas para alongar/encurtar (passos de 2 células de 20 px, até 200). O campo "Comprimento" também funciona. As ligações acompanham seus terminais; as dos terminais removidos ao encurtar são apagadas.
- **Painéis laterais:** os painéis "Elementos" (esquerda) e "Propriedades/Resultados" (direita) têm um botão ◀/▶ no topo para recolher e expandir; o estado fica em `localStorage` `systemlab.panels`.

## Header do Eclipse

O header mostra o **nome do app atual** ao lado do logo e o menu suspenso **Apps ▾** para trocar de módulo sem voltar à Home (`frontend/src/eclipse/EclipseShell.tsx`, lista vinda de `apps.ts`).

## IED (comunicação GOOSE)

Dois elementos da barra esquerda não têm efeito elétrico (o solver os ignora) e servem à simulação de GOOSE entre relés do DigitalRelay:

- **IED:** símbolo de frontal de relé (corpo azul, display e dois botões, sem nome de modelo). Nas propriedades escolha o **relé do DigitalRelay** (sessão ativa; um relé só pode estar em um IED do diagrama) e, se quiser, o **IED do projeto IEC61850** que ele simula. Depois de escolher o relé, associe-o a elementos do diagrama:
  - **Disjuntor monitorado:** o estado segue nos dois sentidos. Abrir/fechar o disjuntor no diagrama move o disjuntor do relé (a entrada 52A acompanha); se o relé abrir (ex.: TRIP), o disjuntor do diagrama abre.
  - **TC (correntes):** a corrente do TC no sistema simulado (valor primário, trifásico equilibrado, com o ângulo do solver) é injetada como IA/IB/IC do relé. Sem energia, zero.
  - **TP (tensões):** a tensão do TP (fase-fase ÷ √3, valor primário) é injetada como VA/VB/VC. A injeção analógica do relé é ligada.
  O envio é feito ao mudar o diagrama e repetido a cada ~5 s; enquanto houver associação, ele prevalece sobre valores digitados na janela de injeção.

**Regra:** não há elemento de rede. Dois IEDs do diagrama associados a relés do **mesmo projeto IEC61850** (app IEC61850, aba "Simulação") se comunicam por GOOSE automaticamente; o que decide é o vínculo relé ↔ IED do projeto, os ajustes (E61850/EGSE, assinaturas) e as condições de falha (latência, perda, cabo) do app IEC61850.

### Atalhos na tela (IED)

Com um relé associado ao IED, a seção **Atalhos na tela (mapa DNP3)** das propriedades monta um **painel flutuante** sobre o diagrama (arraste pelo cabeçalho; ▾/▸ recolhe) para facilitar a análise sem sair do SystemLab. Só podem ser associados **pontos do mapa DNP3 do relé** (os `NA` não aparecem):

- **Comando (BO):** botão que envia o comando `PULSE_ON` direto ao ponto (mesmo caminho da aba DNP3; a resposta, como `SUCCESS` ou `NOT_SUPPORTED`, aparece no painel).
- **Valor binário (BI):** lâmpada com 0/1 do ponto.
- **Medida (AI):** valor do ponto, com unidade sugerida.

Os valores são lidos do mapa a cada 0,7 s. Rótulos são editáveis (padrão = descrição do ponto) e a ordem pode ser alterada (▲▼). Se o mapa DNP3 do relé for trocado e o índice passar a apontar para outro bit, o atalho fica inativo (`–`). Os atalhos ficam salvos no diagrama (`systemlab.diagram`). Nas **Ações** do IED, **Ocultar comandos DNP3** tira o painel flutuante da tela sem apagar os atalhos (`El.scHide`); **Mostrar comandos DNP3** traz de volta.

## Transformador de 3 enrolamentos

Elemento com **três terminais**: 1 = **P** (primário), à esquerda; 2 = **S** (secundário), à direita acima; e 3 = **T** (terciário), à direita abaixo (símbolo de três círculos). Parâmetros: potência e tensão nominais de cada enrolamento, impedâncias **P–S, P–T e S–T (%)** na base da potência de P, X/R e o **esquema de ligação** (YNyn0d1, YNyn0d11, YNyn0yn0, YNyn0y0, YNd1d1, YNd11d11, Dyn1yn1, Dyn11yn11, Dd0d0, Dy11y11).

Modelo: as impedâncias dos três enrolamentos vêm do equivalente em estrela (Zp = (Zps + Zpt − Zst)/2, e analogamente Zs e Zt; Zs ou Zt podem sair ≈ 0 ou negativos, como no transformador real) convertido para delta entre os terminais, com a defasagem de cada par dada pelos índices horários do esquema (S e T em relação a P). Vale no regime normal e na falta. Sequência zero: enrolamento **Y aterrado** liga o terminal ao ponto comum pela impedância do enrolamento; **Δ** aterra o ponto comum (fecha a malha); **Y isolado** não conduz. O resultado mostra tensão, corrente e potência dos três terminais, o carregamento de P e as perdas.
## Linha

Elemento de dois terminais com **comprimento (km)** e **impedância por km**: **R** e **Xl** de sequência positiva/negativa (Ω/km) e **R0/Xl0** de sequência zero (usados nas faltas à terra). O campo **Ajuste da impedância** troca para **Z1 e Z0 em módulo (Ω/km) e ângulo (0 a 90°)**; os dois modos mostram valores equivalentes (o diagrama guarda R/X). A impedância total é comprimento × impedância por km (convertida para pu na tensão de base do trecho); não há capacitância shunt. Nas propriedades aparecem a impedância total, as perdas e as grandezas de cada terminal.

**Falta em um ponto da linha:** a linha tem três pontos de conexão: os dois extremos e um **ponto central (no topo do símbolo)**. Ligue o terminal da **Falta** ao ponto central: o sistema detecta a ligação e, nas propriedades da Falta, aparecem a **Linha conectada** e a **Posição na linha (0 a 100 %)**, contada a partir do terminal 1 (ex.: 10 %, 50 %). Sem essa ligação o campo de posição não aparece e a falta vale no ponto ligado. A linha é dividida em dois trechos (p·Z e (1−p)·Z, nas sequências positiva, negativa e zero) e a falta é aplicada no nó entre eles. O painel "Em falta" mostra o ponto (ex.: "A-N a 30 % de LT1"), as impedâncias de Thévenin e as correntes/tensões nos terminais da linha.
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

**Modo do inversor:** *Automático* (padrão, comportamento original: segue a rede com P/Q constantes; em ilha CA sem fonte, o primeiro inversor apto forma a rede), *Seguidor de rede* (nunca forma a rede; sem fonte ou formador na ilha fica sem tensão CA) e *Formador de rede* (fonte de tensão com 5 % de impedância interna). **Vários formadores na mesma ilha operam em paralelo** e dividem a carga conforme as impedâncias do caminho (ex.: duas baterias nos enrolamentos S e T de um transformador de 3 enrolamentos, ambas descarregando); o ângulo de cada formador acompanha a defasagem dos transformadores entre eles, então não há circulação de potência por causa do índice horário. Formador com fonte na ilha opera em paralelo com a rede. Se a tensão do sistema em um terminal do transformador diferir mais de 20 % da nominal do enrolamento, o painel avisa (impedâncias fora de escala).

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

## Copiar e colar

Selecione um ou mais elementos e use **Ctrl+C** / **Ctrl+V** (ou o botão direito: **Copiar** no elemento, **Colar** / **Colar aqui** no fundo). A colagem fica centrada no ponteiro (Ctrl+V sem o ponteiro ter passado pelo diagrama desloca a cada colagem), mantém as ligações entre os elementos copiados e dá nomes novos (DJ1 → DJ2…). IEDs colados saem **sem relé associado** (um relé só pode estar em um IED) e sem atalhos; as associações a disjuntor/TC/TP só valem se esses elementos também foram copiados. Arrastar com o botão direito continua deslocando a vista.

## Texto

Elemento **Texto** (último da barra de elementos): insere texto livre no diagrama, sem terminais e fora do cálculo elétrico. Arraste da barra ou dê duplo clique nela; edite o conteúdo na caixa de texto das propriedades (que ocupa a largura do painel; `- ` ou `* ` no início da linha viram o marcador `• ` e Enter continua a lista; Enter em um marcador vazio a encerra) ou por duplo clique no próprio texto. Propriedades: tamanho da fonte (px), negrito e cor (padrão, azul, verde-água, vermelho, cinza; seguem o tema). Pode ser movido, copiado/colado (não gira) e é exportado/importado no JSON.

## TP trifásico/monofásico e TP de sincronismo

O **TP** tem o parâmetro **Tipo** (trifásico ou monofásico). No monofásico escolha a **fase utilizada** (A, B ou C; medição fase-neutro). O unifilar mostra a identificação ao lado do símbolo (**3φ** ou **1φ B**) e a mesma informação aparece nos dados do TP (ex.: 1φ B · 66,4 V) e nas propriedades. O secundário mostrado é fase-fase no trifásico e fase-neutro da fase escolhida no monofásico.

No **IED**, **TP (tensões)** alimenta VA/VB/VC do relé: TP trifásico entrega as três fases (em falta, os fasores por fase); TP monofásico entrega só a fase medida (as outras ficam em 0 V). **TP de sincronismo (VS)** só aceita **TP monofásico** e alimenta a entrada **VS** do relé (módulo e ângulo da tensão fase-neutro da fase medida), usada na verificação de sincronismo (25) do DigitalRelay; a frequência de VS continua a ajustada na janela de injeção.

**Modelo do IED:** o elemento IED tem o seletor de modelo (SEL-751, SEL-787 ou SEL-2440); a lista de relés mostra só os do modelo escolhido (trocar o modelo desassocia um relé de outro modelo). No SEL-787 o IED aceita até 3 TCs (W1, W2 e W3), que alimentam as correntes dos enrolamentos 1 a 3 do relé (injeção `ia_*`, `w2ia_*`, `w3ia_*`); o disjuntor monitorado continua sendo o do W1. O SEL-2440 não tem entradas analógicas, então só mostra a associação do relé, o IED 61850 e os atalhos.

**Impedância da fonte CA:** campo "Impedância da fonte" escolhe o modo. (0) Potência de curto-circuito (MVA) e relações X1/R1, R0/R1 e X0/X1: Z1 = Vnom²/Ssc com ângulo de X1/R1; R0 = R1·(R0/R1), X0 = X1·(X0/X1). (1) Isc máx: Isc trifásica e monofásica em kA com ângulo (referência: tensão da fonte a 0°): Z1 = E/I3φ e Z0 = 3E/I1φ − 2·Z1, com E = Vnom/√3. Diagramas antigos com Z0/Z1 (z0r) continuam valendo (solver.sourceZ). A seq. zero só entra com o neutro aterrado. Ao trocar o modo, os campos do novo modo recebem os **valores equivalentes** aos do anterior (na tensão nominal da fonte, percentual de 100 %).

**Modos de ajuste equivalentes:** carga (P/Q ↔ S/FP), fonte (Ssc e relações ↔ Isc) e linha (R/X ↔ |Z| e ângulo) usam `get`/`put` dos campos em `model.ts`: o valor exibido é calculado do que está guardado e a edição grava os parâmetros que o solver usa. Os campos mostram até 6 algarismos significativos; valores acima do máximo (ex.: percentual da fonte > 1000, FP > 1) são corrigidos ao digitar.

**TC e TP:** o diagrama mostra só a identificação do TP (3φ / 1φ X); as medições primária e secundária ficam na janela lateral.

**Percentual da fonte** (`pct`, campo "Percentual da fonte (0 a 1000)"; não aceita valor fora da faixa): escala o nível de curto-circuito da fonte (Z1 e Z0 divididos por pct/100). 100 % = parametrizado; 0 % = fonte sem contribuição.

**Medições do IED** (janela lateral): grandezas primárias lidas dos TCs/TPs ligados ao IED, com ou sem relé do DigitalRelay associado — correntes e tensões de fase, tensões de linha, componentes simétricas (I1, I2, I0, 3I0, V1, V2, V0), P/Q/S, FP, VS e, no SEL-787, W2/W3, além do **Diagrama fasorial** (um só diagrama com tensões em traço cheio e correntes tracejadas, cada grupo com sua escala — V no semieixo positivo, A no negativo —, componente `PhasorDiagram` com a prop `second` e as cores do PhaseEngine; desligado por padrão). O usuário escolhe os grupos exibidos (`El.mshow`). São calculadas pela mesma função (`iedAnalog`) que alimenta a injeção do relé associado, então os valores coincidem com os do DigitalRelay.

**Elemento Texto – numeração e alinhamento:** barra acima da caixa de texto com lista numerada (botão ou "1. " / "1) " no início da linha; Enter continua a numeração, Enter num item vazio encerra; as sequências são renumeradas automaticamente) e alinhamento à esquerda, centralizado (padrão), à direita ou justificado (`p.align` 0–3). No justificado a sobra de cada linha é distribuída entre as palavras (word-spacing), exceto na última linha de cada parágrafo.

**Frequência:** a frequência nominal do sistema (60 ou 50 Hz) fica nas Configurações (⚙, salva em `systemlab.settings` e no JSON exportado). Cada fonte pode ter a sua frequência (campo `freq`; vazio ou 0 = nominal). O solver atribui a cada ilha elétrica a frequência da sua fonte (ilha formada só por inversor = nominal) e o resultado vai em `extra.freq`. O IED lê a frequência da ilha do seu TP de tensões (ou do TC) e a do TP de sincronismo (FS), que são enviadas ao relé associado (`freq` e `vs_freq`): uma fonte fora da nominal do outro lado do disjuntor gera escorregamento para o 25. Na tela, a fonte mostra a frequência quando ela difere da nominal.

**Exportar JSON:** o arquivo recebe o título da simulação como nome (caracteres inválidos viram `_`). **Limpar SER dos relés** (Resumo do sistema): apaga o SER de todos os relés do DigitalRelay associados aos IEDs da simulação; fica desativado sem nenhum IED associado.
