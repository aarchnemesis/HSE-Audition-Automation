# AGENTS.md — hse-audition-automation

Context file for AI coding agents (Claude Code, Antigravity, Cursor, Codex, …).
This is the **single source of truth**; `CLAUDE.md` just imports it.

`hse-audition-automation` is the **HSE Audit Automation Hub & EHS Compliance Engine** of the Arthwind platform. It automates compliance verification across three independent data sources: Google Drive (actual certificate PDFs), Storz Escudo (LMS training records via Playwright), and Smartsheet RPO (human-entered records).

---

## 🔴 Golden rules (Arthwind / Arthnex standard)

1. **Package manager: `pnpm` only.** Never `npm` / `yarn`. Never commit `package-lock.json` (`pnpm-lock.yaml` is the truth).
2. **Protected branches & PR-only workflow (`main`, `homolog`, `development`):**
   - NEVER commit or push directly to `main` or `development`.
   - Always create a work branch (`feat/<id>`, `fix/<id>`, `refactor/<id>`) branching **from `development`**.
   - Every change MUST be submitted via **Pull Request (PR)** with mandatory peer review and approval before merging into `development`.
   - `main` is reserved exclusively for production releases after thorough testing in `development`.
3. **Before finishing any task, make these green:**
   - `pnpm exec tsc --noEmit`
   - `pnpm exec biome check .`
   - `pnpm exec vitest run`
4. **No new dependencies without prior approval.** Reuse what already exists.
5. **Write unit tests for every new piece of logic / processing algorithm.**
6. **English only:**
   - All **commit messages** MUST be in English following Conventional Commits (`feat: ...`, `fix: ...`, `refactor: ...`, `docs: ...`, `chore: ...`, `test: ...`).
   - All PR titles, descriptions, code, messages, errors, comments, function/variable names, and types MUST be in English.
7. **Senior-level code, minimal comments.** The code explains itself; comment only the non-obvious "why".
8. **Before creating anything new, search for an existing one** (service, adapter, model, util) and reuse/extend it without breaking its current contract.
9. **Resource management & Lifecycle:** Always clean up Playwright browser instances, file streams, HTTP connections, and child processes on unmount or process exit.
10. **Design & UI Icons: NEVER use emojis, ALWAYS use SVG.**
    - Never place emojis (e.g. 🎓, 📋, 🔴, ⚠️, ✔, 🔍) in dashboards, UI templates, HTML generators, or front-end components.
    - Always use crisp, scalable inline SVGs or styled CSS indicators (`<span class="dot ..."></span>`). SVGs ensure a professional industrial aesthetic, uniform rendering across all OS/browsers, and full control over stroke/fill colors.

---

## Commands

```bash
pnpm install                       # install dependencies
pnpm typecheck                     # typecheck with tsc --noEmit
pnpm check                         # lint + format check with Biome
pnpm check:write                   # auto-fix lint/format with Biome
pnpm format                        # format code with Biome
pnpm test                          # run all unit tests with Vitest
pnpm test:watch                    # watch mode tests
pnpm build                         # compile TypeScript to dist/
pnpm run triangulate               # run audit triangulation CLI
pnpm run storz-audit               # run Storz scraping and audit CLI
pnpm run hse-report                # generate consolidated HSE report & dashboard
pnpm run drive-rpo-audit           # audit divergence between Drive/Storz and RPO
pnpm run drive-reconcile           # cross the second source (shared drive "TREINAMENTOS") against the SSOT; report-only by default, --execute copies missing/newer docs into the SSOT (canonical names, old->Obsoletos, undo log). Flags: --branch=01,02 --kinds=COPY_MISSING,UPDATE_NEWER,NEW_COLLAB --collaborator=NAME --limit=N
pnpm run drive-split-pessoal       # phase 2: classify every SSOT file personal vs training and move misfiled personal docs into each collaborator's "01. Documentos Pessoais" (created when missing). Report-only by default, --execute moves with real-parent fix + undo log. ASO(01) counts as personal by default (--no-aso to exclude); OS(02)/EPI(06) stay. Flags: --branch=01 --limit=N --delay=ms
pnpm run drive-fix-doc041          # fixes leftover "<code> – Doc <code> – ..." placeholder titles (keeps the load-bearing leading code, swaps the title to canonical, e.g. 04.1 -> "Contrato de Trabalho CLT"; fills a SEM_DATA date from the content cache when available). Report-only by default; --execute renames with undo log.
pnpm run drive-undated-report      # read-only: buckets every SSOT file with no date in its name into CORRETO_SEM_DATA (permanent/personal codes + civil uncoded), FALTA_DATA_CACHE_OK (dated code, date already in cache), FALTA_DATA_PRECISA_EXTRAIR (dated code, needs download+OCR) and SEM_CODIGO. Writes undated_need_extract.json to feed buildContentCacheForFiles --input=, then runDriveFixSemData fills the dated ones. Date detection accepts . / - _ separators; codes are zero-padded.
pnpm run backfill-history          # rebuild data/compliance_history.json from the git history of the database
pnpm run storz-history-report      # generate student training history report
pnpm run portal-report             # client-portal pendencies x project briefing, e-mails EHS and ops (--no-email for preview)
pnpm run portal-coverage           # map every platform in the EHS credentials sheet vs. briefing and automation -> data/portais/portal_coverage.json
pnpm run portal-login -- <id>      # log into a Tier-3/TDoc portal with sheet creds, save session to scratch/portais/sessions/<id>.session.json
pnpm run portal-sessions           # list saved portal sessions and whether each is still usable or must be re-logged
pnpm run veriduss-extract          # pull the Veriduss (Goldwind) census over REST using a saved session -> data/portais/veriduss-goldwind.census.json
pnpm run egestiona-extract -- <id> # log into an eGestiona tenant and scrape its workforce grid (DPR/DPE/active) -> data/portais/<id>.census.json
pnpm run tdoc-extract -- <id>      # log into a TDoc tenant (Keycloak) and scrape tasks/workers/documents -> data/portais/<id>.census.json
pnpm run surisoft-extract          # log into Surisoft and pull each client's workforce via its internal document API -> data/portais/surisoft.census.json
pnpm run test-gdrive               # test Google Drive API connection
```

---

## Stack & Architecture

- **Runtime & Tooling:** Node 22, TypeScript (strict), Playwright, Vitest, Biome `1.9.4`.
- **Architecture Overview:**
  - `src/domain/`:
    - `models/`: Data types, validation schemas, entity definitions (`StorzRequest`, `AuditSnapshot`, `PendencyReport`).
    - `services/`: Business logic, triangulation engine (`AuditTriangulator`), profile classifier (`EmployeeProfileClassifier`), matcher (`InspectorMatcher`), compliance rules (`ComplianceEngine`, `EHSEvaluator`), retest tracker (`RetestTracker`), and repository storage (`HSEDatabaseRepository`).
  - `src/adapters/`:
    - `drive/`: Local filesystem and Google Drive OAuth v3 API adapter for certificate PDF scraping and parsing.
    - `storz/`: Playwright crawler for Storz LMS and HTML dossier parser.
    - `smartsheet/`: Read-only API integration for RPO-EHS sheets.
    - `email/`: Nodemailer SMTP email dispatcher and HTML digest generator.
    - `excel/`: ExcelJS consolidated spreadsheet generator.
    - `dashboard/`: Static HTML and Chart.js reporting renderer.
  - `src/ports/`: Hexagonal architecture interface contracts (`IDocumentProvider`, `IEmailService`, `IRPOExporter`, `IStorzProvider`).
  - `src/cli/`: Automation runners and batch scripts for scheduled execution.
- **Formatter & Linter:** Biome `1.9.4`: 2-space indent, width 80, single quotes, **no semicolons**, `trailingCommas: es5`.
- **Testing:** Vitest.
