# CLAUDE.md – Simulador SEL-751

Contexto do projeto para quem (humano ou agente) for continuar o trabalho. Idioma do projeto: **português (pt-BR)** –
UI, comentários, docs e mensagens de commit. Identificadores de código em inglês/siglas SEL.

## Objetivo

Ferramenta web que recebe um arquivo **`.rdb`** do AcSELerator QuickSet (biblioteca de ajustes de relés SEL-751),
extrai os arquivos de texto de cada ajuste e **simula o relé** com o ajuste escolhido:

1. **Painel frontal** fiel à imagem de referência (`assets/relay-front-reference.png`): display 2×16, LEDs, botões PB1–PB8,
   TARGET RESET, teclas de navegação.
2. **Variáveis internas** (entradas/saídas digitais, latches, SV, contadores, proteção, religamento, Relay Word).
3. **Mapa DNP3** (BO/BI/AI/eventos) com **envio de comandos** (Select/Operate/Direct).

É um **MVP**: simula o comportamento funcional descrito pelos ajustes, **não** executa o firmware.
Escopo excluído (lido, mas ignorado): Modbus (`M`), Mirrored Bits (`TMBxx`), EtherNet/IP (`E1–E3`), IEC 103 (`I`),
portas (`P1–P4`, `PF`), touchscreen (`SET_HMI.TXT`).

## Stack e estrutura

```
backend/    Python 3.12 + FastAPI (+ olefile, pytest, httpx)
frontend/   React 18 + TypeScript + Vite (sem biblioteca de UI; CSS puro em src/styles.css)
assets/     relay-front-reference.png (imagem de referência do frontal)
docs/       arquitetura.md, logica-simulada.md, api.md, roadmap-sel751-alimentador-v1.24.md
Padrões SEL-751.rdb                 arquivo de exemplo (20 ajustes) – usado pelos testes
Padrões SEL-751 (extraído)/         extração manual feita no início (dado de referência, não é usada pelo código)
run.ps1                             instala, compila o frontend e sobe em http://127.0.0.1:8000
```

### Backend (`backend/app`)

| Módulo | Papel |
|---|---|
| `rdb.py` | Abre o contêiner OLE (`Relays/<pasta>/set_*.txt`, `Misc/*.txt`); nome completo do relé vem de `Misc/Device.txt` (as pastas do .rdb são truncadas em 31 caracteres). Gera `.zip`. |
| `settings.py` | Parser de `set_*.txt` (`[INFO]`, `[classe]`, `NOME,"valor"` com `""` escapado). `RelaySettings.sections[classe]`. |
| `selogic.py` | Interpretador SELogic. **Sem curto-circuito** (as bordas `R_TRIG/F_TRIG` precisam ser avaliadas todo ciclo). Primeira avaliação nunca gera borda. |
| `curves.py` | Curvas U1–U5 / C1–C5. |
| `protection.py` | Elementos 50/51/27/59/81D criados do grupo ativo; pickup `OFF` = desabilitado (bits ainda registrados com 0). |
| `fieldsim.py` | Fasores, tipos de falta (AG BG CG AB BC CA ABC), afundamento, modelo do disjuntor, presets. |
| `engine.py` | `RelayEngine.step(dt)`: ciclo de varredura, TRIP, CLOSE, religamento 79, SV/SC/MV/LT/OUT, grupos, SER, snapshots. |
| `panel.py` | LEDs de alvo (retenção, `RSTLED`), LEDs dos botões (`PBnA/B_LED`, cor `AO`=(ligado,desligado)), pontos de display `DPnn`. |
| `dnp.py` | Mapa `D1–D3`, banda morta, eventos, comandos. |
| `describe.py` | Rótulos (comentários `#`, ALIAS do SER, textos do display), `normal_state`, `standard_label`. |
| `sessions.py` | `SessionManager` + laço de tempo real (varredura a cada 10 ms; `dt = 0,01 × velocidade`). |
| `main.py` | Rotas REST e entrega de `frontend/dist`. |

### Frontend (`frontend/src`)

`App.tsx` (fluxo upload → seleção → simulador; sessão restaurada via `localStorage` chave `sel751.sim`),
`api.ts` (cliente; **eventos de botão em fila ordenada**), `hooks.ts` (`usePoll`), `types.ts`,
`components/`: `RelayFront`, `Lcd` (display + menu), `TestBench`, `MeasurementCard`, `InjectionWindow` (+ `PhasorDiagram`, `phasor.ts`), `VariablesView`, `DnpView`, `SettingsView`,
`EventsView`, `UploadScreen`, `TopBar`, `ui.tsx`.
Estado por **polling**: `/panel` a 10 Hz, `/state` `/dnp` `/ser` a 2–2,5 Hz só com a aba aberta.

## Comandos

```bash
# backend (venv em .venv/ na raiz; run.ps1 a cria sozinho)
python -m venv .venv && .venv\Scripts\activate && pip install -r backend/requirements.txt
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000      # serve a API e frontend/dist
python -m pytest -q                                              # 39 testes (~20 s)

# frontend
cd frontend && npm install
npm run build        # tsc -b && vite build  → frontend/dist
npm run dev          # http://localhost:5173, proxy /api → :8000
```

No Windows: `./run.ps1`. Use sempre a `.venv` (`.venv\Scripts\python.exe`); fora dela, `python -I` não enxerga pacotes do user-site.
O uvicorn não usa `--reload` por padrão: reinicie após mudar o backend (matar a porta 8000 via
`Get-NetTCPConnection -LocalPort 8000 | Stop-Process`). O `dist` é estático: rebuild basta, sem reiniciar.

## Modelo de simulação (essencial)

**Ciclo (`step`)**: 1 evento da fila → entradas (debounce `INxxxD`) e analógicos → proteção → `TR→TRIP` → 79 → `CL→CLOSE` →
lógica do usuário **na ordem SV → SC → MV → LT → OUT** → disjuntor → grupo (`SS1..4`, `TGR`) → LEDs/SER/DNP.

Decisões que afetam o comportamento (verificar contra relé real se possível):
- SV antes dos latches reproduz o comando em **dois toques** (PB4: 1º toque arma `LT04`, janela de 5 s; 2º abre/fecha).
- Latch com SET e RESET simultâneos: **RESET prevalece**.
- Bits RB/OC/CC/TRGTR são **pulsos de 1 ciclo**; PBn sobe ao pressionar e desce ao soltar (um evento por ciclo).
- `TRIP` mantém `TDURD` e só cai com `ULTRIP` e `TR` falso. `CLOSE` cai ao fechar (`52A`), por `ULCL` ou após `CFD` (gera `CF`).
- **79**: `RS`→`CY`→`LO`; tempo morto `79OIn` conta com disjuntor aberto e sem `79STL`; reset `79RSD` com disjuntor fechado e sem
  `79BRS`; `79DTL` leva a bloqueio; `SH0..SH4` = nº de religamentos. Abertura por comando (`SV03T`) leva o 79 a `LO`.
- Bobinas de abertura/fechamento do disjuntor são **deduzidas** das expressões/comentários das `OUTxxx`
  (`TRIP`/"ABERTURA" × `CLOSE`/"FECHAMENTO"); a entrada do 52A é deduzida da equação `52A` (normalmente `IN101`).
- Entradas: estado inicial deduzido de ALIAS/DP ("normal"); `IN101` é movida pelo modelo do disjuntor.
- Injeção: fasores por fase em `SimConfig` (`ia_mag`/`ia_ang`… `vc_*`, **sempre primários**); a UI converte com CTR/PTR no
  modo secundário. Falta ativa sobrepõe as correntes; disjuntor aberto = corrente zero. A janela de injeção é um pop-up da própria
  SPA (`window.open` em `#/injecao/<sid>`, roteado em `App.tsx`); o modo primário/secundário fica em `localStorage`
  (`sel751.inject.mode`).
- `SimConfig.analog_on` (padrão ligado): chave "Injeção analógica" no cartão Medição da tela inicial; desligada = correntes e tensões
  zero no relé (`fieldsim.phasors`). A **janela de injeção só edita valores**: a falta (`POST/DELETE /fault`, presets) segue na API e nos
  testes, mas **não tem controle na UI** (decisão do usuário).
- `SimConfig.breaker_auto` (padrão ligado): a entrada do 52A segue o disjuntor; desligado, é livre (`engine.input_raw`).
  `POST /breaker` move o disjuntor físico em qualquer modo.
- Textos centrais dos botões PB1–PB8 são só de UI (`localStorage`, chave `sel751.pbtitles.<relay_id>`); coluna esquerda = PB5–PB8,
  direita = PB1–PB4.
- Medidas: `IN` e `IG` = soma fasorial das fases; pickups em A **secundários** (primário ÷ CTR); `VNOM`×`PTR` = tensão L-L primária.
- DNP: `AI = round(valor × escala)` saturado em 16 bits (`OVER_RANGE`); evento quando |Δcontagem| > banda morta; `Latch Off` →
  `NOT_SUPPORTED`; `Select→Operate` vale 10 s simulados.
- Resolução 10 ms a 1× (a 10×, 100 ms): os alarmes de tempo de abertura (100/120/140 ms) só são confiáveis em 1×.

Detalhes e limitações: `docs/logica-simulada.md`. **Não implementado**: 67, 49, 46, HIF, 52ABF interno, 25, 78, 55,
`E27I/E59I`, demanda, `79SKP/79SEQ/79DLS/79CLSD`, menu completo do display, pilha DNP3 em rede, `MR` das curvas.

## Convenções e cuidados

- Os `.rdb`/set files são **dados não confiáveis**: apenas parseados, nunca executados. Upload limitado a 100 MB; sessões ≤ 8.
- Endpoints que tocam o motor são `async def` de propósito: rodam na mesma thread do laço de simulação (sem locks).
  Não os transforme em `def` sem repensar a concorrência. Parse do upload usa `run_in_threadpool`.
- Cada equação SELogic habilitada deve ser avaliada **uma vez por ciclo**; não avalie expressões fora do `step`
  (afeta `R_TRIG/F_TRIG`). Display DP lê apenas bits (sem avaliar expressões).
- `engine._rebuild()` reconstrói elementos/lógica/painel/DNP ao trocar de grupo ou editar ajuste; latches, temporizadores SV e
  contadores persistem (ficam em `vals`/`sv_state`).
- Nomes no Relay Word: tudo em maiúsculas em `engine.vals` (analógicos incluídos; `analog_keys` distingue). Identificador
  desconhecido vale 0 e aparece em `snapshot_state()["unresolved"]` – os testes exigem lista vazia para o padrão Alimentador.
- Frontend: sem estado global; componentes de aba fazem seu próprio polling. Campos numéricos (`NumField`) só sobrescrevem o
  valor local no foco, para o polling não apagar a digitação.

## Testes (`backend/tests`)

`conftest.py` (fixtures `archive`, `feeder`; helpers `run`, `tap`), `test_selogic.py`, `test_rdb_settings.py`,
`test_engine_feeder.py` (cenários do padrão Alimentador v1.24: falta/religamento/bloqueio, dois toques, local/remoto, DNP,
grupos, alarmes de abertura, debounce, LEDs), `test_api.py` (TestClient com upload real).
Testes que dependem do `.rdb` são ignorados se o arquivo da raiz não existir. Ao mudar o motor, rode a suíte inteira.

## Verificação manual rápida

Subir o servidor, criar upload + sessão (`POST /api/uploads`, `POST /api/sessions`), gravar
`localStorage['sel751.sim'] = {"sid": "...", "uid": "..."}` no navegador e recarregar abre direto o simulador.
Roteiro: `50P1P=10` na aba Ajustes → falta trifásica transitória (via `POST /api/sessions/<sid>/fault`, sem botão na UI) → TRIP, abertura em ~60 ms, religamento em ~10 s.
O padrão de teste "SEL751 - Alimentador v1.24" tem CTR 120, grupos/lógicas/mapas D1–D3 idênticos entre si e todos os
pickups em `OFF`.

## Ideias / próximos passos

Elementos faltantes (67, 49, 46, 52BF interno); comparar tempos com relé real; WebSocket no lugar do polling;
pilha DNP3 real (ex.: `opendnp3`) para testar com um mestre externo; GOOSE/seletividade lógica (hoje só sinalizados);
validação das ordens de avaliação (SV/LT) e da prioridade RESET; suporte a outros relés do `.rdb` com bobinas/entradas atípicas
(heurísticas em `engine._detect_coils` e `_default_input`).
