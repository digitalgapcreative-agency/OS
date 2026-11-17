# DGAP OS production readiness checklist

Version 0.1 is a first implementation and **not yet approved for live financial or client data**. Complete this list in a connected test environment.

- [ ] Dependencies installed; `npm run build` passes with no errors.
- [ ] MySQL schema imported into dedicated DB; basic CRUD integration tests pass.
- [ ] First admin setup works once and refuses a second initialization.
- [ ] Invalid login and repeated failed login attempts are rejected.
- [ ] `APP_ORIGIN`, HTTPS, session cookies, and CSRF defenses validated.
- [ ] Client A cannot list, read, upload, download, approve or comment on Client B data.
- [ ] Client viewers cannot approve; client approvers can approve only shared deliverables.
- [ ] Team members cannot access finance; finance-only roles cannot access unauthorized business records.
- [ ] Financial postings, partial invoice payments, supplier bill settlements, budgets and transfers tested against bank statement examples.
- [ ] Historical period cash summaries checked against independent spreadsheets.
- [ ] Large amounts and concurrent payment attempts tested.
- [ ] Upload type, size, safe name and privacy controls tested; files survive restart and redeploy.
- [ ] Password reset/MFA policy decided; access revocation procedure documented.
- [ ] App and MySQL backups performed and restored into a fresh test environment.
- [ ] Logs, error monitoring, data-retention and access reviews configured.
- [ ] Legal/invoicing/tax rules reviewed for the actual company's jurisdiction.
- [ ] Confirm production domain stays separate from `digitalgapco.com`.
