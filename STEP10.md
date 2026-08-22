# Step 10 — End-to-End AI Research Production Verification

## Goal
Verify the complete production path: Railway health → AI provider readiness → AI smoke test → stock analysis → validated quant data → verified technical facts → deterministic score → source traceability.

## Automated checks

Run static checks:

```bash
node step10-end-to-end-production-verification.js
```

Run live Railway checks:

```bash
LIVE_URL=https://pro-pran-ai-production.up.railway.app node step10-end-to-end-production-verification.js
```

On Windows PowerShell:

```powershell
$env:LIVE_URL="https://pro-pran-ai-production.up.railway.app"
node step10-end-to-end-production-verification.js
```

Optional test symbol:

```bash
TEST_SYMBOL=INFY LIVE_URL=https://pro-pran-ai-production.up.railway.app node step10-end-to-end-production-verification.js
```

## What Step 10 verifies

- required production files exist
- `/api/health`, `/api/ai-status`, `/api/ai-test`, and `/api/analyze` exist
- Gemini/Groq credentials are read only from runtime environment variables
- no obvious API secret is committed in `server.js`
- Railway is healthy and `ready_for_ai=true`
- at least one AI provider is active
- AI smoke test returns `AI_PROVIDER_TEST_OK`
- `/api/analyze` returns a successful report for the selected symbol
- validated quant data is successful
- verified technical facts are present
- deterministic scoring is present
- source traceability is present
- the report does not claim Dhan data or guaranteed returns

## Release rule

Step 10 is complete when the static verifier passes and the live Railway verifier passes against the production URL. API keys remain only in Railway/runtime environment variables and are never committed to GitHub.
