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
| Carga | Potência ativa (MW) | 10 |
| | Fator de potência | 0,92 |
| | Capacitiva (adiantada) | não (indutiva) |
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
- **Carregar exemplo** (botão da barra superior) cria um sistema pronto: fonte → disjuntor → barra → transformador → barra →
  disjuntor → TC → carga, com um TP na barra de saída.

### Mover, girar, excluir

- **Mover:** arrastar o elemento (fica na grade). Enquanto arrasta, só o **símbolo** é desenhado (somem borda de seleção, nome,
  valores e terminais). As ligações acompanham.
- **Girar:** botão "↻ Girar" ou tecla **R** (passos de 90° no sentido horário). Os nomes e valores ficam sempre na horizontal.
- **Excluir:** botão "Excluir" ou **Delete/Backspace**. Excluir um elemento remove também as ligações dele.
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

### Estado de chaves

**Duplo clique** em disjuntor ou seccionadora abre/fecha, ou use a caixa "Fechado/Fechada" do painel. O resultado é recalculado
imediatamente.

### Vista

- **Zoom:** roda do mouse (30 % a 250 %, centrado no cursor).
- **Mover a vista:** arrastar o fundo (clicar no fundo também limpa a seleção).
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
- **Sem seleção:** **Resumo do sistema** com geração, carga e perdas dos transformadores, lista de barramentos (clicável) e
  medições (TC e TP).

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
   - **Carga:** **impedância constante** calculada na **tensão nominal da zona**: `y = conj((P + jQ)/SBASE)`, com
     `Q = P·tan(acos(FP))` (negativo se capacitiva). Por isso a potência real cai com o quadrado da tensão.
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
