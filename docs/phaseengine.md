# PhaseEngine

Aplicativo do Eclipse para análise de **fasores trifásicos**: o usuário informa tensões e correntes e o app mostra o
diagrama fasorial, as potências, o fator de potência e as componentes de sequência. Rota: `#/phaseengine`.

É um aplicativo **somente de frontend** (não usa o backend): todo o cálculo é feito no navegador.

| Arquivo | Conteúdo |
|---|---|
| `frontend/src/phaseengine/PhaseEngineApp.tsx` | Interface, estado e formatação. |
| `frontend/src/phaseengine/calc.ts` | Cálculos: potências por fase/total e referenciamento dos fasores. |
| `frontend/src/phasor.ts` | Aritmética complexa/polar e componentes simétricas (compartilhado com a janela de injeção do DigitalRelay). |
| `frontend/src/components/PhasorDiagram.tsx` | Diagrama fasorial em SVG (compartilhado com o DigitalRelay). |

## Tela

A tela tem, de cima para baixo: o cartão de **entrada** (com as opções de referência e de sequência) e os **diagramas
fasoriais**, lado a lado; o cartão **Potências**; e os cartões de **sequência** de tensão e de corrente.

### Entrada

Seis fasores: `Va`, `Vb`, `Vc` (tensão **fase-neutro**, em V) e `Ia`, `Ib`, `Ic` (corrente de linha, em A).
Para cada um se informa o **módulo** e o **ângulo** (em graus). Detalhes:

- Os campos aceitam vírgula ou ponto decimal. Texto inválido ou vazio vale 0 no cálculo; o módulo é tomado em valor
  absoluto (módulo negativo não existe: para inverter o fasor, some 180° ao ângulo).
- A coluna **Referenciado** mostra o ângulo de cada fasor depois da escolha do fasor de referência (veja abaixo).
- Valores iniciais de exemplo: tensões de 127 V equilibradas (0°, −120°, +120°) e correntes de 100 A (−30°, −150°, +90°),
  isto é, carga equilibrada indutiva com fator de potência 0,866. O link **Restaurar valores de exemplo** volta a esses
  valores (e à referência "Nenhum").
- Os valores, a referência escolhida e o modo de sequência ficam salvos no navegador (`localStorage`, chave
  `phaseengine.state`).

### Fasor de referência

Botões **Nenhum, Va, Vb, Vc, Ia, Ib, Ic**.

- **Nenhum:** os ângulos são mostrados como foram digitados (normalizados para o intervalo −180° … +180°).
- **Um fasor escolhido:** ele passa a ficar em **0°** e todos os demais (tensões e correntes) giram o mesmo ângulo, ficando
  referenciados a ele. Exemplo: com `Ia` como referência e `Ia = 100∠−30°`, o `Va = 127∠0°` passa a `127∠+30°`.
- Vale para os diagramas, para a coluna "Referenciado" e para os ângulos das componentes de sequência.
- **Não altera** módulos, potências, fator de potência nem os módulos das componentes de sequência, porque uma rotação comum
  não muda as relações entre os fasores (as potências dependem só da diferença de fase entre V e I da mesma fase).

### Diagramas fasoriais

Dois diagramas: **Tensões** (V) e **Correntes** (A). Cada fasor é uma seta a partir da origem, com as cores `a`
(vermelho), `b` (verde-azulado) e `c` (azul). A escala do raio é automática: o círculo externo vale o próximo valor
"redondo" (1, 2 ou 5 × 10ⁿ) maior ou igual ao maior módulo, e o círculo tracejado é a metade. Os eixos mostram 0°, 90°,
180° e −90°. Fasores de módulo zero não são desenhados. O ângulo é positivo no sentido anti-horário.

### Potências

Tabela com **Fase A, B, C** e **Trifásica**, e as colunas **Ativa (P)**, **Reativa (Q)**, **Aparente (S)** e **Fator de
potência**. Os valores usam prefixos automáticos (W/kW/MW, var/kvar/Mvar, VA/kVA/MVA).

Cálculo (`calc.ts`), para cada fase `k`:

```
S_k = V_k · conj(I_k)          P_k = Re(S_k)     Q_k = Im(S_k)     |S_k| = √(P² + Q²)
FP_k = |P_k| / |S_k|
```

- **Q positivo = corrente atrasada em relação à tensão** (carga indutiva); Q negativo = adiantada (capacitiva). O fator de
  potência é acompanhado de **(ind.)** ou **(cap.)** quando Q é diferente de zero.
- **Total trifásico:** soma **complexa** das três fases, `S_3φ = ΣS_k`, `P_3φ = ΣP_k`, `Q_3φ = ΣQ_k` e
  `|S_3φ| = √(P_3φ² + Q_3φ²)` (S aparente vetorial, como nos relés). `FP_3φ = |P_3φ| / |S_3φ|`.
- Com módulos desiguais ou sistemas desequilibrados, o S vetorial pode ser menor que a soma aritmética dos `|S_k|`.

### Componentes de sequência

Dois cartões, um para as **tensões** e outro para as **correntes**, com módulo e ângulo de cada componente. Pelo teorema de
Fortescue, com `a = 1∠120°` (e já divididas por 3):

```
X0 = (Xa + Xb + Xc) / 3
X1 = (Xa + a·Xb + a²·Xc) / 3
X2 = (Xa + a²·Xb + a·Xc) / 3
```

Opção de exibição (botões **I2, I0** / **3I2, 3I0**, vale para tensão e corrente):

| Opção | Mostra | Rótulos |
|---|---|---|
| `I2, I0` | os valores das componentes (já divididos por 3) | `I1`, `I2`, `I0` / `V1`, `V2`, `V0` |
| `3I2, 3I0` | o triplo da negativa e da zero | `I1`, `3I2`, `3I0` / `V1`, `3V2`, `3V0` |

A sequência positiva é sempre mostrada como `I1`/`V1` (nunca multiplicada por 3). O ângulo não muda com a opção; só o módulo.
Em um sistema equilibrado de sequência positiva as componentes negativa e zero são nulas; em uma falta fase-terra, por
exemplo, `3I0` é a corrente residual (soma das três correntes de fase).

## Limitações

- Apenas tensão **fase-neutro**; para tensão de linha, converta antes (√3 × fase-neutro, com ângulo adiantado de 30°).
- Sem importação de dados do DigitalRelay ou do SystemLab (por enquanto os apps não trocam dados).
- Regime permanente senoidal (fasores): não há harmônicos nem formas de onda.
