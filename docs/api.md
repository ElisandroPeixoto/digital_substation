# API REST

Base: `/api` (API do aplicativo **DigitalRelay** do Eclipse; o frontend do Eclipse é servido na raiz `/`, com as imagens de `assets/` em `/eclipse-*.png`). Documentação interativa (Swagger): `/docs`. Erros: JSON `{"detail": "..."}`.

## Versão

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/version` | `{"version": "1.0.0"}` – versão do Eclipse servida pelo backend. |
| POST | `/api/shutdown` | Encerra o servidor local (botão Encerrar da janela do `Eclipse.exe`). Exige o cabeçalho `X-Eclipse-Launcher: 1` (sem ele: 403), o que obriga o preflight CORS e impede chamadas de outras origens. No executável, para o servidor interno; no uvicorn de linha de comando (`run.ps1`), equivale a Ctrl+C. |

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
| GET | `/sessions/{sid}/panel` | `model` (`751`/`787`/`2440`/`311C`; no 311C `panel` traz também `fault_type` e `local_bits`) `bits` (VB/CB/RB usados e observados) e, no SEL-2440, `io` (cartões 100/200/300 de 16 pontos, bits VB/CB/RB usados e LEDs de estado). LEDs, display, estado do disjuntor, entradas, **saídas digitais**, medição (módulo/ângulo, P/Q/S) e configuração da simulação. |
| POST | `/sessions/{sid}/button` | `{button: "PB1".."PB8" (SEL-311C: até "PB10") \| "TARGET_RESET", pressed}`. Pressionar e soltar são eventos separados. |
| POST | `/sessions/{sid}/bits` | `{name: VB###\|CB###\|RB##\|LBn, mode: set\|clear\|toggle\|pulse\|watch}` – aciona bits virtuais, de controle e remotos (SEL-751, SEL-2440 e SEL-311C, que usa `RBn`/`LBn` sem zero à esquerda; `LBn` = bits locais do menu CNTRL); `watch` só passa a exibir o bit. |
| POST | `/sessions/{sid}/inputs` | `{name, value}` – entrada digital. Com `breaker_auto` ligado, a entrada do 52A (`IN101`) move o disjuntor; desligado, só muda o estado da entrada. |
| POST | `/sessions/{sid}/sim` | `{patch: {...}}` – fasores injetados **em valores primários** (`ia_mag`, `ia_ang`, `ib_*`, `ic_*`, `va_*`, `vb_*`, `vc_*`: módulo em A / V fase-neutro, ângulo em graus), `freq`, `vdc`, `open_ms`, `close_ms`, `breaker_auto` (simular disjuntor), `bk_trip`/`bk_close` (bits do Relay Word que abrem/fecham o disjuntor, separados por vírgula; vazio = deduzidos; nome desconhecido → 400), `bk_status` (entrada `INxxx` do estado; vazio = a da equação 52A), `analog_on` (liga/desliga a injeção analógica), `lop` (perda de potencial simulada), `halarm`, links… |
| POST | `/sessions/{sid}/force` | `{name, value}` – força uma variável lógica (SV, SVT, LT, SCnn/SCnnQ, MV, OUT…) em 0/1 (ou número em SC/MV); `value: null` libera. |
| DELETE | `/sessions/{sid}/force` | Libera todas as variáveis forçadas. |
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

## IEC 61850 (módulo IEC61850)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/sessions` | Lista os relés instanciados: `{id, model, relay_id, device, filename, running, ied}`. |
| POST | `/iec61850/files` | Multipart `file` (.scd/.cid/.icd); acrescenta os IEDs ao projeto e devolve o projeto. |
| GET | `/iec61850` | Projeto: IEDs, blocos GOOSE (com FCDA→bit e assinantes), assinaturas (com VB e conferência `issues`). |
| DELETE | `/iec61850` · `/iec61850/ieds/{nome}` | Limpa o projeto / remove um IED. |
| GET | `/iec61850/status` | Estado da rede: vínculos, por IED `comm_ok/reason`, `stNum/sqNum`, valores, assinaturas válidas. |
| POST | `/iec61850/bind` | `{sid, ied}` associa a sessão ao IED (`ied: null` desassocia). |
| POST | `/iec61850/gcb` | `{ied, cb, fields}` – altera parâmetros do bloco GOOSE só na simulação (`go_id, dataset, conf_rev, mac, appid, vlan_id, vlan_prio, min_ms, max_ms, enabled`). Devolve o projeto. |
| POST | `/iec61850/sub` | `{ied, pub, cb, fields, vbs}` – idem para a assinatura (`+ status_vb`); `vbs` = `{índice: "VBnnn"}`. |
| POST | `/iec61850/reset` | `{ied?}` – restaura os valores do arquivo. |
| POST | `/iec61850/network` | `{vlan_aware?, latency_ms?, loss_pct?, status_on_loss?, cut?: [IED]}` (`vlan_aware: false` desconsidera VLAN-ID/prioridade). |

Detalhes: [iec61850.md](iec61850.md).

## Mirrored Bits (MBitConfig)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/mbits` | Relés (portas 2/3 com PROTO/TXID/RXID/SPEED, bits TMB/RMB, ROK/RBAD/CBAD) e links (`closed`, `issues`, `phys`, contadores por sentido). |
| POST | `/mbits/links` | `{a: {sid, port}, b: {sid, port}}` – cria o link (portas 2 ou 3; uma porta em um só link). |
| PATCH | `/mbits/links/{id}` | `{cut?, loss_pct?}` – cabo desconectado / perda de mensagens. |
| DELETE | `/mbits/links/{id}` | Remove o link. |
| POST | `/mbits/clear` | Zera as estatísticas (equivale a COM A C). |

Detalhes: [mbitconfig.md](mbitconfig.md).

## Estampas de tempo

Eventos SER, eventos DNP3, registro de comandos e a "última mudança" dos BI trazem o tempo simulado (`t`, em s) e o **horário real** do computador no instante do evento (`w`, época Unix em s; `changed_w` nos BI). A interface escolhe qual mostrar (aba Configurações, `localStorage` `sel751.prefs`).
