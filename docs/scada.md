# SCADA

Supervisório dos IEDs em execução no DigitalRelay. Lê o **mapa DNP3 ativo** de cada relé adicionado (mesma fonte da aba DNP3 do
DigitalRelay: `GET /api/sessions/<sid>/dnp?since=<seq>`) e junta os eventos de todos os equipamentos numa linha do tempo só.

Código: `frontend/src/scada/ScadaApp.tsx` (rota `#/scada`), `backend/app/scada.py` (planilha), endpoint `POST /api/scada/map/<sid>`,
testes `backend/tests/test_scada.py`. Ícone `assets/app-icons/scada.png`.

## Uso

- **IEDs supervisionados:** escolha os relés do DigitalRelay (qualquer modelo com mapa DNP: SEL-751, SEL-787, SEL-311C, SEL-2440) e clique em *Adicionar IED*. A tabela mostra modelo, mapa DNP ativo (D1–D3),
  quantidade de pontos BI / AI / BO e a planilha de mapa carregada. *Remover IED* tira o relé da supervisão (não altera o relé).
- **Polling:** de 1 s a 60 s (padrão 2 s). Botões *Pausar/Retomar*, *Atualizar* (leitura imediata) e *Limpar eventos* (só a lista do SCADA).
- **Abas:**
  - **Binários:** eventos BI de todos os IEDs (data/hora real, IED, posição, wordbit, descrição, estado), do mais recente ao mais antigo, e o
    estado atual de todos os pontos binários com a última mudança.
  - **Analógicos:** valores atuais dos pontos AI (valor de engenharia, contagem DNP, qualidade) e os eventos por banda morta.
  - **Comandos:** saídas binárias (BO) de cada IED com *Enviar pulso* (Direct Operate, PULSE_ON, com confirmação) e o registro de comandos
    (enviados pelo SCADA ou pela aba DNP3 do DigitalRelay).
- **Filtros:** por IED e por texto (wordbit, descrição, nome do IED).
- O estado (IEDs, polling, planilhas) fica no `localStorage` (`scada.state`); as planilhas são guardadas por `relay_id`.
  Na primeira leitura de um IED, o SCADA traz os eventos que já estavam no buffer DNP do relé (até 300).

## Planilha de mapa

Colunas (cabeçalho na primeira linha que tiver “Wordbit”; acentos e maiúsculas são ignorados):

| Tipo | Posição | Wordbit | Descrição | Valor 0 | Valor 1 |
|---|---|---|---|---|---|

- **Tipo:** `BI`, `AI` ou `BO`. AI e BO ignoram *Valor 0* e *Valor 1*.
- **Wordbit:** cruzada com o mapa DNP ativo do relé (mesmo tipo). O que coincide é **aceito**; tipo inválido, wordbit vazia ou ausente do mapa é
  **rejeitado** (a lista de rejeitados, com o motivo, aparece ao carregar e pelo link “n rejeitados”).
- **Campos vazios:** prevalece o texto do relé — descrição do ponto e, para os estados, os textos do ALIAS do relatório (`set_R`), ou 0/1.
- **Posição:** informativa; se for diferente da posição do ponto no relé, vale a do relé (fica uma observação).
- Formatos: `.xlsx` (primeira aba) e `.csv` (`;` ou `,`). O `.xls` antigo não é suportado. Limites: 10 MB e 5000 linhas; XML com DOCTYPE é recusado.
- Modelo: [`modelo-mapa-scada.xlsx`](modelo-mapa-scada.xlsx) (pontos do padrão SEL-787, incluindo uma linha inválida de exemplo).

- **Tela cheia:** botão ⛶ na barra das abas abre os eventos (Binários, Analógicos, Comandos, com filtros) ocupando a tela; o navegador entra em tela cheia quando permitido. Sai pelo botão ou com Esc.
- **Destaque:** eventos e pontos binários em 1 ficam com a linha realçada (faixa verde-água) e o estado num selo preenchido; em 0, selo vazado.
- **Estado atual dos pontos binários:** botão Recolher/Expandir no cabeçalho do cartão; a escolha fica salva no navegador (`scada.stateOpen`).
- **Exportar Excel:** botão na barra das abas; gera `scada-eventos-AAAA-MM-DD_HHMM.xlsx` com as abas Binários, Analógicos e Comandos (todos os IEDs, sem filtros; cabeçalho congelado e com filtro). Gerado no navegador (`scada/xlsx.ts`), sem bibliotecas.
- **Período e ordenação:** campos *De* / *Até* (data e hora local, com segundos) filtram eventos binários, analógicos e o registro de comandos; *limpar período* remove o filtro. A ordem pela data/hora (mais recentes ou mais antigos primeiro) troca pelo botão ou clicando no cabeçalho *Data/hora* (▲/▼). Valem junto com os filtros de IED e de texto; o *Exportar Excel* continua levando todos os eventos.
- **Largura das colunas:** arraste a borda direita do cabeçalho de qualquer tabela para redimensionar a coluna; duplo clique na borda volta à largura automática. As larguras ficam salvas no navegador por tabela (`ResizableTables`, mesma função das abas DNP3 e Eventos do DigitalRelay).
