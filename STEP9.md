# Step 9 — AI Production Verification

## Goal
Verify that the production server exposes the AI provider status and smoke-test endpoints, reads Gemini/Groq credentials only from the runtime environment, and does not contain committed API secrets.

## Automated checks

Run:

```bash
node step9-ai-production-verification.js
```

For live Railway verification:

```bash
LIVE_URL=https://pro-pran-ai-production.up.railway.app node step9-ai-production-verification.js
```

On Windows PowerShell:

```powershell
$env:LIVE_URL="https://pro-pran-ai-production.up.railway.app"
node step9-ai-production-verification.js
```

The verifier checks:

- required production files exist
- `/api/ai-status` exists in `server.js`
- `/api/ai-test` exists in `server.js`
- Gemini and Groq keys are read from runtime environment variables
- the AI smoke-test response is present
- obvious API-key patterns are not committed
- when `LIVE_URL` is supplied, Railway `/api/health`, `/api/ai-status`, and `/api/ai-test` return successful responses
- the live AI test returns `AI_PROVIDER_TEST_OK`

## Current production acceptance evidence

Railway production has already returned:

- `/api/health`: `success=true`, `ready_for_ai=true`
- `/api/ai-status`: Gemini configured, Groq configured, active provider Gemini
- `/api/ai-test`: `success=true`, response `AI_PROVIDER_TEST_OK`

## Release rule

Step 9 is complete when the automated verifier passes and the deployed AI status/test endpoints confirm that at least one configured provider is ready. API keys must remain in Railway/runtime environment variables and must never be committed to GitHub.
