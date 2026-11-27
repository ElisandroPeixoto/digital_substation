# Histórico de versões do Eclipse

Versionamento semântico (`MAIOR.MENOR.CORREÇÃO`). O mesmo histórico aparece no aplicativo em **Sobre → Histórico de
versões** (`#/about/versoes`, lista `VERSION_HISTORY` em `frontend/src/eclipse/version.ts`) e no `CHANGELOG.md` da raiz.
Ao lançar uma versão, atualize os três (o teste `backend/tests/test_version.py` confere).

## 1.1.0 – 2026-11-27

- DigitalRelay: novo modelo SEL-311C (proteção de linha: distância mho/quadrilateral, 50/67/51, direcionais 32Q/32G/32P, LOP, SOTF, religamento 79), com frontal próprio e uso no SystemLab, SCADA, IEC61850 e MBitConfig.
- DigitalRelay: no cartão Disjuntor (campo) do SEL-751 e do SEL-311C, chave Simular disjuntor e escolha das variáveis de abertura, de fechamento e da entrada de estado (também respeitadas no SystemLab).
- DigitalRelay: coluna Ajuste (primário) nos Elementos de proteção (751, 787 e 311C); colunas × pickup e Tempo previsto removidas.
- SystemLab: carga ajustável por P e Q ou por S e FP, fonte por Ssc e relações ou por Isc, linha por R/X ou por |Z| e ângulo, com conversão automática entre os modos.
- SystemLab: diagrama fasorial das tensões e correntes do IED; ocultar o painel de comandos DNP3; janela de propriedades esticável; textos explicativos no botão Detalhes.
- Overcurrent: várias marcações fixas de corrente, cada uma com sua tabela de tempos.
- Sobre: histórico de versões em página própria.
- Executável: a janela de controle abre também com outro Eclipse em execução e o Encerrar fecha esse servidor (rota POST /api/shutdown).

## 1.0.0 – 2026-11-26

- Primeira versão numerada do Eclipse.
- Aplicativos: DigitalRelay (SEL-751, SEL-787 e SEL-2440), PhaseEngine, SystemLab, Overcurrent, IEC61850, MBitConfig e SCADA.
- SystemLab: marca de polaridade do TC e inversão da polaridade sem alterar o desenho.
