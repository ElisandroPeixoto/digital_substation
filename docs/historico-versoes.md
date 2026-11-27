# Histórico de versões do Eclipse

Versionamento semântico (`MAIOR.MENOR.CORREÇÃO`). O mesmo histórico aparece no aplicativo em **Sobre → Histórico de
versões** (`#/about/versoes`, lista `VERSION_HISTORY` em `frontend/src/eclipse/version.ts`) e no `CHANGELOG.md` da raiz.
Ao lançar uma versão, atualize os três (o teste `backend/tests/test_version.py` confere).

## 1.0.0 – 2026-11-26

- Primeira versão numerada do Eclipse.
- Aplicativos: DigitalRelay (SEL-751, SEL-787 e SEL-2440), PhaseEngine, SystemLab, Overcurrent, IEC61850, MBitConfig e SCADA.
- SystemLab: marca de polaridade do TC e inversão da polaridade sem alterar o desenho.
