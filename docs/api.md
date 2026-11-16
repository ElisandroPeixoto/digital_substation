# API REST

Base: `/api` (API do aplicativo **DigitalRelay** do Eclipse; o frontend do Eclipse é servido na raiz `/`, com as imagens de `assets/` em `/eclipse-*.png`). Documentação interativa (Swagger): `/docs`. Erros: JSON `{"detail": "..."}`.

## Arquivo `.rdb`

| Método | Rota | Descrição |
|---|---|---|
| POST | `/uploads` | `multipart/form-data` com o campo `file`. Retorna `upload_id` e a lista de ajustes (relés) com arquivos. |
| GET | `/uploads/{uid}` | Reapresenta a lista de ajustes. |
| GET | `/uploads/{uid}/relays/{rid}/files/{caminho}` | Texto de um arquivo (ex.: `set_L1.txt`, `Misc/Cfg.txt`). |
| GET | `/uploads/{uid}/relays/{rid}/zip` | `.zip` com os arquivos de texto do ajuste. |

## Sessões de simulação

| Método | Rota | Descrição |
|---|---|---|
| POST | `/sessions` | `{upload_id, relay_id}` → cria o relé simulado. Retorna informações, rótulos de LEDs/botões, presets e tipos de falta. |
| GET / DELETE | `/sessions/{sid}` | Informações / encerra. |
| POST | `/sessions/{sid}/restart` | Reinicia o relé com os ajustes originais. |
| POST | `/sessions/{sid}/control` | `{running?, speed?}` (velocidade: 0.5, 1, 2, 5, 10). |

## Painel e mesa de teste

| Método | Rota | Descrição |
|---|---|---|
| GET | `/sessions/{sid}/panel` | LEDs, display, estado do disjuntor, entradas, **saídas digitais**, medição (módulo/ângulo, P/Q/S) e configuração da simulação. |
| POST | `/sessions/{sid}/button` | `{button: "PB1".."PB8" \| "TARGET_RESET", pressed}`. Pressionar e soltar são eventos separados. |
| POST | `/sessions/{sid}/inputs` | `{name, value}` – entrada digital. Com `breaker_auto` ligado, a entrada do 52A (`IN101`) move o disjuntor; desligado, só muda o estado da entrada. |
| POST | `/sessions/{sid}/sim` | `{patch: {...}}` – fasores injetados **em valores primários** (`ia_mag`, `ia_ang`, `ib_*`, `ic_*`, `va_*`, `vb_*`, `vc_*`: módulo em A / V fase-neutro, ângulo em graus), `freq`, `vdc`, `open_ms`, `close_ms`, `breaker_auto`, `analog_on` (liga/desliga a injeção analógica), `lop` (perda de potencial simulada), `halarm`, links… |
| POST | `/sessions/{sid}/breaker` | `{closed}` – move o disjuntor no campo (posição física), qualquer que seja o modo da entrada 52A. |
| POST / DELETE | `/sessions/{sid}/fault` | `{type: AG\|BG\|CG\|AB\|BC\|CA\|ABC, current?, persistent?}` / elimina a falta. |
| POST | `/sessions/{sid}/preset` | `{name}` – `normal`, `overload` (carga equilibrada) ou `ag`, `bc`, `abc` (faltas). |

## Estado interno, SER e DNP3

| Método | Rota | Descrição |
|---|---|---|
| GET | `/sessions/{sid}/state` | Entradas, saídas, latches, SV, contadores, MV, proteção, **controle direcional (`directional`)**, religamento, Relay Word, analógicos, bits desconhecidos. |
| GET / DELETE | `/sessions/{sid}/ser?since=N` | Registro sequencial de eventos / limpa. |
| GET | `/sessions/{sid}/dnp?since=N` | Pontos BO/BI/AI, eventos (após `N`), registro de comandos, seleção ativa. |
| DELETE | `/sessions/{sid}/dnp/events` | Limpa os eventos DNP3 (a numeração continua). |
| POST | `/sessions/{sid}/dnp/command` | `{index, code: PULSE_ON\|LATCH_ON\|LATCH_OFF, mode: select\|operate\|direct}`. Resultado: `SUCCESS`, `NO_SELECT`, `TIMEOUT`, `NOT_SUPPORTED`, `FORMAT_ERROR`. |
| POST | `/sessions/{sid}/dnp/map` | `{map: 1..3}` – troca o mapa DNP (classes `D1…D3`). |

## Ajustes

| Método | Rota | Descrição |
|---|---|---|
| GET | `/sessions/{sid}/settings/{classe}` | Ajustes da classe (`G`, `1`, `L1`, `F`, `R`, `D1`…). |
| GET | `/sessions/{sid}/settings/{classe}/raw` | Texto original do arquivo. |
| PATCH | `/sessions/{sid}/settings` | `{cls, key, value}` – altera um ajuste e recompila a lógica (só na sessão). |

## Estampas de tempo

Eventos SER, eventos DNP3, registro de comandos e a "última mudança" dos BI trazem o tempo simulado (`t`, em s) e o **horário real** do computador no instante do evento (`w`, época Unix em s; `changed_w` nos BI). A interface escolhe qual mostrar (aba Configurações, `localStorage` `sel751.prefs`).
