# docs/

## Guia_Treinamentos_Normativos_SST_arTH.xlsx

Guia de referência das NRs (Normas Regulamentadoras) — carga horária, periodicidade de
reciclagem, pré-requisitos e responsável técnico para 39 tipos de treinamento. Versão 2.0,
auditado pela ARTH-Wind SSMA em agosto/2026. Fornecido pelo usuário em 21/08/2026.

Achados aplicados no código em 21/08/2026 (ver `src/adapters/drive/certificateFilenameParser.ts`,
`src/domain/services/ComplianceEngine.ts`, `src/adapters/storz/dossieParser.ts`):

1. **Código morto removido**: `ANNUAL_VALIDITY_CODES` tinha `'33'`, que não existe no catálogo
   (o código interno da NR-33 é `'20'`, não `'33'`) — confusão entre "número da NR" e "código
   interno do documento". Removido.
2. **NR-01 (código `10`) e NR-06 (código `11`) não expiram mais por calendário** — o guia confirma
   que são retreinados só por gatilho (mudança de risco, acidente grave, troca de EPI), nunca por
   periodicidade fixa. Como o modelo de dados não tem "documento sem prazo, só por evento",
   marcamos com validade de 50 anos (`EVENT_TRIGGERED_ONLY_CODES` em `certificateFilenameParser.ts`)
   — fica CONFORME indefinidamente até alguém modelar retreinamento por gatilho de verdade.
3. **NR-33 (código `20`) mantido em 1 ano** — cobre Supervisor/Vigia (anuais); não temos código
   separado pra Equipe de Emergência (bienal), então essa nuance ainda não é distinguida.
4. **CIPA adicionada ao catálogo** como código `34` (deliberadamente não `'33'`, pra não repetir a
   confusão do item 1) — anual, reconhecida também no parser de treinamentos da Storz
   (`dossieParser.ts`, casa com nomes reais tipo "NR5 - CIPA - GRAU DE RISCO 3", o caso real da
   Jessica Alves da Silva). Ainda não é um documento *exigido* por nenhum perfil — só aparece se
   a pessoa tiver o registro; ver limitação documentada em `EmployeeProfileClassifier.ts`.

Testes: `certificateFilenameParser.test.ts` (novo) e `dossieParser.test.ts` cobrem os 4 pontos.

## Storz só é buscada pra treinamentos normativos (21/08/2026)

A Storz é uma empresa de treinamentos normativos (NR/GWO/LOTO/CIPA) — não faz sentido buscar lá
documentos pessoais/médicos (ASO, CTPS, vacina), de trânsito (CNH) ou certificações de terceiros
(SIT/ESO Vestas, GWO WINDA ID, CRT, Diploma). Duas correções:

1. **`dossieParser.classifyTrainingCode`**: removidas as classificações especulativas de
   `'ASO'`→`01`, `'CNH'`→`08`, `'VESTAS'`→`25`, `'WINDA'`→`30` — nunca foram confirmadas contra
   nome de curso real raspado (só NR-xx, LOTO e CIPA apareceram de fato).
2. **`AuditTriangulator`**: agora só tenta casar um documento com uma solicitação na Storz se o
   código estiver em `STORZ_SEARCHABLE_DOC_CODES` (`ComplianceEngine.ts`) — antes, mesmo ASO/CNH
   passavam pela busca (só não achavam nada na prática, mas a lógica não fazia sentido e um
   registro coincidente por engano poderia gerar falso `SOLICITADO_STORZ`).

Testes: `dossieParser.test.ts` (classificação retorna `null` pra ASO/CNH/Vestas/WINDA) e
`AuditTriangulator.test.ts` (documento fora do conjunto nunca é promovido por um registro Storz
coincidente).
