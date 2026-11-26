# Histórico de versões do Eclipse

Versionamento semântico (`MAIOR.MENOR.CORREÇÃO`). A versão fica em `frontend/package.json` e `backend/app/version.py`
(o teste `backend/tests/test_version.py` confere as duas e este arquivo); o histórico mostrado no Sobre fica em
`frontend/src/eclipse/version.ts`.

## 1.0.0 – 2026-11-26

- Primeira versão numerada do Eclipse.
- Aplicativos: DigitalRelay (SEL-751, SEL-787 e SEL-2440), PhaseEngine, SystemLab, Overcurrent, IEC61850, MBitConfig e SCADA.
- SystemLab: marca de polaridade do TC e inversão da polaridade sem alterar o desenho.
