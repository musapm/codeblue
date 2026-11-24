# Launch checklist (Phase 17)

> Every unchecked item needs the product owner's action or approval. Items done in this repository
> are checked; nothing has been deployed.

## Built and tested in the repository
- [x] Demo university content and a demo reset limited to demo universities (migration 24)
- [x] Health check with a deep mode and the deployed version; structured request-error reports (`ERROR_REPORT_URL`)
- [x] CI on every push: typecheck, lint, unit, secret scan, dependency audit, database tests (with pgvector), build and browser tests
- [x] Deployment runbook (`docs/runbooks/deploy.md`), backup restore runbook, demo script (English and Arabic)

## Owner actions before launch
- [ ] Choose domains, plans and the email provider; confirm data-residency needs of the first universities
- [ ] Apply migrations 12–24 to the production database; bootstrap the platform owner
- [ ] Configure Supabase Auth (URLs, SMTP, templates, TOTP, anonymous sign-ins, CAPTCHA)
- [ ] Set production environment variables, including `ANTHROPIC_API_KEY` and `RATE_LIMIT_SECRET`
- [ ] **Approve the first production deployment**
- [ ] Run the smoke test (runbook §4), including two-step sign-in live
- [ ] Run the AI eval suite with the key (`RUN_AI_EVALS=1 npm run test:eval`); no launch on a regression
- [ ] Perform the backup restore drill
- [ ] Uptime check and alerting on `/api/health?deep=1`
- [ ] Schedule `subscription_sweep()` daily
- [ ] Legal review of the Privacy Policy and Terms; real support and sales emails
