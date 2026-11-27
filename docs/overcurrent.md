# Overcurrent

Aplicativo do Eclipse para montar o **coordenograma de sobrecorrente**: o usuário informa os ajustes das funções **51** (temporizada) e **50** (instantânea / tempo definido)
de fase e de neutro de um ou mais relés, e o app plota as curvas tempo × corrente. Rota: `#/overcurrent`.

É um aplicativo **somente de frontend**. As curvas são as mesmas do relé SEL-751 (constantes de `backend/app/curves.py`, tabelas 4.20 a 4.22 do manual);
para a teoria das funções veja [`funcoes-50-51.md`](funcoes-50-51.md).

| Arquivo | Conteúdo |
|---|---|
| `frontend/src/overcurrent/curves.ts` | Constantes das curvas U1–U5, C1–C5, E1–E3 e `time51()`. |
| `frontend/src/overcurrent/model.ts` | Relés, elementos, cores/estilos de linha e `buildCurves()` (curvas em A primários). |
| `frontend/src/overcurrent/Chart.tsx` | Gráfico log-log em SVG, eixos, curva de falta e tooltip ao passar o mouse. |
| `frontend/src/overcurrent/OvercurrentApp.tsx` | Painel de ajustes, legenda com ocultar/mostrar e tabela de tempos. |

## Como usar

O gráfico é o centro da tela; os ajustes ficam na coluna da direita.

1. **Ajustes → relés:** abra um relé, informe **CTR** (fase) e **CTRN** (neutro) e ative os elementos que quiser. Cada elemento mostra, abaixo dos campos, o pickup em **A primários**.
   - **51 Fase / 51 Neutro:** pickup (A secundários), curva (U1…E3) e dial **TD**; **CT** (tempo constante) e **MR** (resposta mínima) ficam em "CT / MR".
   - **50 Fase / 50 Neutro:** pickup (A secundários) e atraso (s).
   - **+ Relé** adiciona outro relé; "excluir relé" remove.
2. **Curvas:** uma por elemento ativo. **51P** é contínua, **51N** tracejada, **50P** pontilhada e **50N** traço-ponto. O 50 aparece como uma vertical no pickup e uma horizontal no atraso
   (atraso 0 fica rente ao piso do gráfico, 0,01 s).
3. **Ocultar uma curva:** desmarque a caixa dela na legenda acima do gráfico (ou clique no nome). "mostrar todas / ocultar todas" age em todas.
4. **Mudar a cor:** na legenda, clique no círculo colorido da curva. O círculo ao lado do nome do relé (nos ajustes) muda a cor de **todas** as curvas dele.
5. **Tempo de atuação:** passe o mouse sobre qualquer curva. O gráfico marca o ponto, traça guias até os eixos e mostra um balão só com a **corrente** (A primários) e o **tempo** de atuação (ou "não atua", abaixo do pickup). Passar o mouse na legenda destaca a curva.
6. **Zoom:** use a **roda do mouse** (aproxima/afasta nos dois eixos em torno do cursor) ou os botões **+ / −** no canto do gráfico; **arraste** para mover a vista e **duplo clique** (ou o botão **↺**)
   para voltar à vista inicial. Os rótulos dos eixos se adaptam ao zoom. O hover continua mostrando corrente e tempo.
7. **Opções do gráfico** (nos ajustes): *marcações de corrente* (uma ou mais, com "+ marcação" e ✕ para remover; cada uma mostra uma linha vertical e uma tabela com o tempo de cada curva visível e a margem entre curvas vizinhas; estado salvo em `ifaults`), faixa de corrente mínima/máxima
   (automática por padrão) e **51SAT** (limita o múltiplo a 30, como no relé). "restaurar exemplo" volta ao exemplo de dois relés.

## Cálculo

- 51: `t = máx( TD·(A/(M^P − 1) + B), MR ) + CT`, com `M = I ÷ pickup` (só para `M > 1`; com 51SAT, `M ≤ 30`).
- 50: atua com `I ≥ pickup`, após o atraso configurado.
- Pickups primários: `pickup (A sec.) × CTR` (fase) ou `× CTRN` (neutro).

Os ajustes, as cores e as curvas ocultas ficam salvos no navegador (`localStorage`, chave `overcurrent.state`). **Restaurar exemplo** volta ao conjunto de dois relés (Alimentador e Entrada).

## Limitações

- Curvas em regime permanente: não há reset eletromecânico, transitórios nem saturação de TC.
- O controle direcional (67) e o controle de torque não entram no gráfico.
- As curvas não são enviadas ao DigitalRelay (os apps ainda não trocam dados).
