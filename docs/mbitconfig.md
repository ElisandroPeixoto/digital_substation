# MBitConfig (Eclipse)

App gráfico para criar **links SEL MIRRORED BITS** entre os relés carregados no DigitalRelay (rota `#/mbitconfig`). Base: guia de aplicação SEL AG2018-24.
Código: `backend/app/mbits.py` (`MbNetwork` em `SessionManager.mb`), `frontend/src/mbitconfig/MBitConfigApp.tsx`, testes `backend/tests/test_mbits.py`.

## Como usar

1. No DigitalRelay, carregue os relés (SEL-751 e/ou SEL-2440; botão "＋ Relé").
2. No MBitConfig cada relé é um cartão com as portas **P2** (borda esquerda) e **P3** (borda direita). Portas **verdes** estão aptas: `PROTO` = **MB8A** ou **MB8B** (também aceitos MBA/MBB). Portas cinzas não estão aptas.
3. Clique em uma porta apta de um relé e depois em uma porta apta de outro para criar o link. Clique em um relé para editar `PROTO`, `TXID`, `RXID`, `SPEED` e `RXDFLT` das portas (só na simulação).
4. Clique no link para ver o estado: ajustes que impedem o fechamento (com o botão **Casar os ajustes de B com A**), os 8 pares TMB→RMB ao vivo, ROK/RBAD/CBAD, contadores de mensagens, cabo desconectado e perda de mensagens (%).

## Regras

- **Canal local A/B:** o canal da porta vem do `PROTO` (MB8**A** → equações `TMB1A–TMB8A`, bits recebidos `RMB1A–RMB8A`; MB8**B** → canal B). As letras não trafegam: o `TMB1A` de um relé chega no `RMB1B` do outro se a porta dele for B. Cada relé tem até 8 bits por canal.
- **Fechamento do link:** `TXID` de um = `RXID` do outro (e vice-versa), `TXID` ≠ `RXID` em cada relé, mesma `SPEED` e mesma família (MB × MB8). O mesmo canal (A ou B) não pode estar em dois links do mesmo relé, e uma porta só entra em um link.
- **Transmissão:** o motor avalia `TMBnA/TMBnB` (classe `L` no SEL-2440, `L1–L4` no SEL-751, uma vez por ciclo; `NA` = 0). Pode usar qualquer bit/equação SELogic; o valor aparece também como bit do Relay Word (SER, lógica).
- **Recepção:** os `RMBnX` entram na lógica como qualquer bit. Uma mensagem a cada 40 bits/`SPEED` (mínimo 4 ms) por sentido; o RMB só muda após `RMBnPU`/`RMBnDO` mensagens consecutivas.
- **Falha do canal:** sem recepção por 3 períodos (underrun) → `ROKx` = 0 e os `RMB` vão para `RXDFLT` (primeiro caractere = RMB8; `X` mantém o último valor). `RBADx` = 1 após `RBADPU` s fora; `CBADx` = 1 se perdas/mensagens > `CBADPU` ppm. Também derrubam o canal: relé pausado, `HALARM`, cabo desconectado.
- Tempo: relógio real (a velocidade do relé não altera o link).

## Não implementado

Loopback (`LOOP`/`LBOK`), `TXMODE`, relatório `COM A`, portas diferentes de 2 e 3, pilha serial real.
