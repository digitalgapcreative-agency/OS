# DGAP OS — Digital Gap Operating System

**Version:** 0.1.0 (first functional source release)  
**Architecture:** React + Vite + TypeScript / Node.js + Express / MySQL 8+  
**Target:** the existing Hostinger Business Web Hosting plan, using a separate Node.js website at `os.digitalgapco.com`.  
**Currency:** IDR, whole-rupiah amounts.  
**Reporting timezone:** Asia/Jakarta.

## What is implemented

- Secure session-based login; first-time administrator initialization; client invitation registration.
- An internal workspace with Overview, CRM, Clients, Projects, Tasks and Finance.
- Lead creation and sales stage progression, client records and single-use client invitation links.
- Projects generated from service-specific task templates. Five delivery stages for full services; Strategic Diagnosis can close after stage three.
- Stage approval gate: all stage tasks must be done and all stage deliverables approved before progression.
- File upload/download in a private directory, project deliverables, client approvals, revision requests and comments.
- Dedicated client portal, with client membership authorization and restricted visibility.
- Finance: bank/cash accounts, income/expense/transfer postings, invoice and bill recording, partial payments, budgets, expense categories, cash reports, charts, project cash contribution and CSV export.
- MySQL schema, audit events for critical changes, server-side access controls, basic security headers and login throttling.

## What is NOT yet implemented

- Fully audited double-entry accounting, accrual-based profit & loss, balance sheet, taxes, bank reconciliation, multi-currency FX, supplier invoice image OCR or bank API feeds.
- Full contract/proposal PDF generation, email delivery of invites, recovery emails, approval notifications and automated reminders.
- Assigning teams through a management UI, time tracking and advanced capacity planning.
- Password reset flow, MFA, detailed per-object role policies and penetration testing.
- Automated integration with `digitalgapco.com` lead form.

**Security status:** functional application code, **not yet independently security-audited or production verified**. Complete the checks in `docs/GO_LIVE_CHECKLIST.md` before storing real client/financial data.

## Local setup (Node.js 22 recommended)

1. Create a dedicated MySQL 8+ database named `dgap_os_db` (or choose your own name).
2. Import `db/schema.sql` into the empty database (using phpMyAdmin or a MySQL client).
3. Copy `.env.example` to `.env` and configure DB credentials, `APP_ORIGIN=http://localhost:5173` for local dev, a random `SETUP_TOKEN` of 32+ characters, and `PRIVATE_UPLOAD_DIR`.
4. Run `npm install`.
5. Run API: `npm run dev:api` (port 3000).
6. In another terminal run frontend: `npm run dev` (Vite port 5173).
7. Open `http://localhost:5173` and select **Set up the first administrator**. Supply your name, email, password (12+ characters) and the `SETUP_TOKEN` configured above.
8. Sign in and create your first client, project and financial account.

For a local single-server simulation, run `npm run build` then `npm start` and open `http://localhost:3000`. In that case set `APP_ORIGIN=http://localhost:3000`.

For production, the `.env` file is **not** committed. Set values in Hostinger hPanel. Do not use development mode on production.

### Troubleshooting

- **Cannot connect to MySQL:** check that the database exists, schema is imported and `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` are correct.
- **Frontend not built:** run `npm run build` before `npm start`.
- **First admin setup not shown:** import the full `db/schema.sql`, including `app_state`, and confirm `SETUP_TOKEN` exists in environment variables.
- **Form saves fail with 'Origin not allowed':** set `APP_ORIGIN` to the precise URL visible in your browser (scheme + host; no trailing slash). For local Vite, use `http://localhost:5173`.
- **Login works but secure cookie missing in production:** use HTTPS and set `NODE_ENV=production`. Keep HTTPS/SSL active.
- **File uploads disappear on redeployment:** configure `PRIVATE_UPLOAD_DIR` to a persistent, private path that is not replaced on deployment and back it up. Test persistence on your hosting plan.

## Deployment

See [`docs/HOSTINGER_DEPLOY.md`](docs/HOSTINGER_DEPLOY.md). Hostinger's managed Node hosting supports uploading a project ZIP or importing from GitHub. The ZIP should contain `package.json` at its root (this archive does).

## Data-model notes

- Amounts are stored as integer IDR in BIGINT columns and checked as safe JavaScript integers; no floating-point currency arithmetic.
- An internal bank-to-bank transfer is one linked transaction, affecting both account balances but **not** total income or total expense.
- Invoices and bills are claims/commitments; they are not cash transactions.
- Applying an invoice payment or paying a bill uses a database transaction and locks the document to prevent overpayment under concurrent requests.
- Posted cash movements are immutable through this V1 API. Adjustments and reversals need a separate audited workflow before live accounting use.
- Cash flow and project cash contribution are **not** net accounting profit.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite frontend, localhost:5173 |
| `npm run dev:api` | Express backend, localhost:3000 |
| `npm run build` | Generate production frontend in `dist/` |
| `npm start` | Serve API + built frontend from `server.js` |
| `npm run db:migrate` | Import base schema from a **local** MySQL-connected machine |
| `npm run admin:create` | Optional **local terminal** administration setup (prefer browser initialization on Hostinger) |
| `npm test` | Pure logic checks; database API integration checks still required |

## Architecture

- `src/App.tsx` — internal app + client portal.
- `src/styles.css` — Digital Gap design system.
- `server/index.mjs` — Express entry, security and static file serving.
- `server/routes-core.mjs` — CRM, project, task, deliverable and portal endpoints.
- `server/routes-finance.mjs` — finance endpoints and calculations.
- `server/auth.mjs` — login, session, invitations and secure setup.
- `db/schema.sql` — initial database schema.
- `tests/` — rules and template checks.

## Important limitation of this delivery

This project was generated without access to a live Hostinger account or MySQL instance. JavaScript/TypeScript syntax was checked; full `npm install`, build, MySQL integration and browser functionality still need to be verified in a connected development environment before deploying to production.
