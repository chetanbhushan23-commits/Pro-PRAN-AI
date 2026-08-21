# Step 8 — Production Verification

## Goal
Verify that the merged Pro-PRAN-AI application is structurally ready for production and that the critical server integrations remain intact after Steps 5–7.

## Automated checks

Run:

```bash
node step8-production-verification.js
```

The verifier checks:

- required runtime files exist
- `server.js` parses successfully
- no unresolved Git conflict markers remain
- `research-quality.js` is integrated
- `/api/health` exists
- `/api/analyze` exists
- obvious API-key patterns are not committed in core source files

## Live smoke checks

From the deployed application, verify:

1. `/api/health` returns a successful JSON response.
2. `/api/analyze?symbol=MCX` returns a report or a controlled error.
3. News/sentiment failures degrade gracefully.
4. Report history remains available.
5. Invalid symbols return a controlled HTTP error rather than crashing the server.

## Release rule

Step 8 is complete only when automated checks pass and the deployed health/analyze smoke tests have been manually verified. This step does not claim live deployment success merely from static checks.
