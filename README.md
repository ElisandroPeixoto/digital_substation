# Eclipse

**Eclipse** é um software web de **simulação de sistemas elétricos de potência**. Ele funciona como uma plataforma
que abriga vários aplicativos, que podem ou não interagir entre si. A tela inicial (Home) mostra o ícone/nome
*Eclipse* e, abaixo, os ícones de acesso aos aplicativos; o header traz o logo e os botões **Home** e **About**.

| Aplicativo | Descrição | Rota |
|---|---|---|
| **DigitalRelay** | Simulador de relés SEL-751 (descrito abaixo) | `#/digitalrelay` |
| **PhaseEngine** | Diagrama fasorial de tensões/correntes, potências e componentes de sequência (ver seção abaixo) | `#/phaseengine` |

Para acrescentar um novo aplicativo: registre-o em `frontend/src/eclipse/apps.ts` e crie a rota em `App.tsx`.

---

# DigitalRelay – simulador SEL-751 (MVP)

Ferramenta web que **abre um arquivo `.rdb` do AcSELerator QuickSet**, decompõe os arquivos de texto de ajuste
que existem dentro dele e **simula o relé SEL-751** com o ajuste escolhido:

1. **Painel frontal** – réplica do frontal do relé: display 2×16, LEDs, botões (PB1–PB4 à direita e PB5–PB8 à
   esquerda, com o texto central editável), TARGET RESET e teclas de navegação, funcionando conforme a lógica ajustada.
   Ao lado, a **tela inicial da simulação** mostra a medição (correntes, tensões, frequência, P/Q/S), as entradas
   digitais (inclusive a IN101/52A) e as saídas digitais.
2. **Variáveis internas** – entradas e saídas digitais, latches, variáveis SELogic temporizadas, contadores,
   elementos de proteção, religamento (79) e todos os bits do Relay Word, em tempo real.
3. **DNP3** – estado de cada ponto do mapa (BO / BI / AI), eventos (SOE) e **envio de comandos** (Select / Operate /
   Direct Operate).

Além disso: **janela de injeção** (pop-up com corrente, tensão e frequência em módulo e ângulo, valores primários ou
secundários, diagrama fasorial e componentes de sequência), aba **Ajustes** (consulta e edição em tempo de
execução) e aba **Eventos (SER)**.

```
frontend/   React + TypeScript (Vite)
backend/    Python + FastAPI (motor de simulação, leitura do .rdb, API)
assets/     identidade visual do Eclipse (logo, ícone, mockup da Home) e imagem de referência do frontal do relé
docs/       arquitetura, lógica simulada (premissas/limitações), API e o roadmap do ajuste "Alimentador v1.24"
```

## Como executar

Pré-requisitos: Python 3.10+ e Node 18+.

```bash
# 1) backend (ambiente virtual na raiz do projeto)
python -m venv .venv
.venv\Scripts\activate          # Windows (Linux/macOS: source .venv/bin/activate)
pip install -r backend/requirements.txt

# 2) frontend (gera frontend/dist, servido pelo próprio backend)
cd frontend
npm install
npm run build

# 3) subir tudo em http://127.0.0.1:8000 (com a .venv ativa)
cd ../backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

No Windows, o script `run.ps1` faz tudo: cria a `.venv` se não existir, instala o que faltar e abre o servidor:

```powershell
./run.ps1
```

**Modo desenvolvimento** (recarga automática): em um terminal `cd backend && python -m uvicorn app.main:app --reload`,
em outro `cd frontend && npm run dev` e abra http://localhost:5173 (o Vite encaminha `/api` ao backend).

## Como usar

0. Abra http://127.0.0.1:8000, na Home clique no ícone **DigitalRelay**.
1. Arraste o `.rdb` (ex.: `Padrões SEL-751.rdb`) para a tela inicial. Cada pasta `Relays/<nome>` do arquivo vira um
   **ajuste** na lista; é possível ver cada arquivo de texto e baixar um `.zip` com eles.
2. Clique em **Carregar no simulador** no ajuste desejado. O backend lê `set_G`, `set_1…4`, `set_L1…L4`, `set_F`,
   `set_R` e `set_D1…D3` e cria o relé simulado.
3. No **Painel frontal**, use os botões do relé. Clique em **Abrir janela de injeção ↗** para definir correntes,
   tensões e frequência (escolha *Primário* ou *Secundário*; o outro valor aparece ao lado) (a janela só edita valores). A chave **Injeção analógica** do cartão Medição liga/desliga essas grandezas durante a simulação.
   Na tela principal altere entradas digitais (a IN101/52A pode acompanhar o disjuntor automaticamente ou ser definida
   por você), tempos do disjuntor e auxiliares. O botão **✎ Editar texto dos botões** muda o texto central de PB1–PB8
   (salvo no navegador).
4. Os ajustes de pickup dos padrões vêm em `OFF`. Na aba **Ajustes** (classe do grupo ativo, p.ex. `1`) altere, por
   exemplo, `50P1P` para `10` e `51P1P` para `2` (A secundários) para habilitar a proteção. A edição vale só para a
   sessão; o `.rdb` não é alterado.

Exemplo de roteiro com o ajuste **Alimentador v1.24**:

| Ação | Resultado esperado |
|---|---|
| `PB4` duas vezes em até 5 s | disjuntor abre (1º toque arma, LED pisca); 79 vai a bloqueio |
| Falta trifásica transitória, injetada pela API `POST /api/sessions/<sid>/fault` (com `50P1P = 10`) | `TRIP`, disjuntor abre em ~60 ms, religa após 10 s, 79 volta a repouso após 120 s |
| Falta permanente | 3 religamentos (10 s, 20 s, 60 s) e bloqueio (79LO) |
| DNP3 `BO_02` (RB01) em modo Remoto | `LT01` liga (religamento bloqueado) e aparece em `BI_19` |
| Tempo de abertura = 110 / 130 / 150 ms + falta | alarmes de abertura lenta nível 1 / 2 / 3 |

## Testes

```bash
cd backend
python -m pytest -q
```

A suíte (≈40 testes) usa o `Padrões SEL-751.rdb` da raiz do projeto; sem ele, os testes que dependem do arquivo são
ignorados.

## Documentação

- [docs/arquitetura.md](docs/arquitetura.md) – módulos e ciclo de varredura
- [docs/logica-simulada.md](docs/logica-simulada.md) – **o que é simulado, premissas e limitações**
- [docs/api.md](docs/api.md) – endpoints REST
- [docs/roadmap-sel751-alimentador-v1.24.md](docs/roadmap-sel751-alimentador-v1.24.md) – descrição da lógica do ajuste usado nos testes

## Identidade visual

Tema escuro (padrão) e **modo claro** (botão ☀/☾ no header, lembrado no navegador) para todo o Eclipse; a tabela abaixo é a paleta escura (variáveis CSS em `frontend/src/styles.css`):

| Elemento | Hex | Uso |
|---|---|---|
| Fundo principal | `#1A202C` | base da interface |
| Superfície | `#2D3748` | cards, menus, barras |
| Primária | `#63B3ED` | botões principais, links ativos, destaques |
| Secundária | `#4FD1C5` | sucesso, destaques secundários, badges |
| Texto primário | `#E2E8F0` | títulos e corpo |
| Texto secundário | `#A0AEC0` | legendas, ajuda |
| Erro | `#FC8181` | erros, alertas, falhas |

Imagens em `assets/` (servidas na raiz pelo Vite via `publicDir`): `eclipse-logo.png` (header), `eclipse-icon.png`
(ícone da Home e favicon), `eclipse-logo-dark.jpg`, `eclipse-mockup-home.png` e os originais `*-original.png`.
A fonte do título é a Montserrat (pacote `@fontsource/montserrat`, sem depender de CDN). O painel frontal do relé
mantém as cores do hardware real.

## PhaseEngine

Aplicativo 100% frontend (`frontend/src/phaseengine/`). O usuário informa módulo e ângulo de Va, Vb, Vc (fase-neutro, V) e
Ia, Ib, Ic (A); o app mostra:

- **Diagramas fasoriais** de tensões e correntes, com **fasor de referência** selecionável (Nenhum, Va…Ic): o escolhido
  vai a 0° e os demais ficam referenciados a ele (a coluna "Referenciado" mostra os ângulos resultantes);
- **Potências** por fase e trifásica (P, Q, S) e **fator de potência** por fase e total (S = V·I*; total = soma complexa;
  Q > 0 = indutivo; FP = |P|/S). Não dependem da referência;
- **Componentes de sequência** (positiva, negativa e zero) de tensão e corrente, exibidas como **I2/I0** ou **3I2/3I0**
  (e V2/V0 ou 3V2/3V0), conforme a escolha do usuário.

Os valores e opções ficam salvos no navegador (`phaseengine.state`).
