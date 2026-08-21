# Step 6 — Decision-Grade Risk & Action Layer

Step 6 adds a deterministic risk layer on top of the verified quant/news/research-quality data from Steps 1–5.

## What it adds

- Risk score: 0–100
- Risk level: LOW / MODERATE / HIGH
- Action bias: BUY BIAS / BUY WITH CAUTION / WAIT / SELL WITH CAUTION / SELL BIAS
- Evidence coverage percentage
- Confidence: LOW / MEDIUM / HIGH
- Explicit risk factors
- Explicit missing-data warnings
- Trading guardrails to prevent unsupported targets, support/resistance, OI/F&O, FII/DII, sector or macro claims

## Important design rule

This layer is deterministic. It does not invent values. Missing fields remain unavailable and reduce evidence coverage.

## Inputs

The engine accepts the same verified objects already produced by the application:

- `quantData`
- `sentimentData`
- `researchQuality`

## Local test

Create a JSON payload containing those three objects and run:

```powershell
node step6-risk-report.js sample-step6.json
```

## Integration target

The next integration change should expose the result from the main `/api/analyze` response as `data.decisionRisk`, and include a short **Risk & Action** section in the generated report. Keep the existing 7-day history and SHA-256 traceability unchanged.

## Step 6 acceptance criteria

1. Existing `/api/health`, `/api/analyze`, `/api/history` and `/api/research-quality` continue working.
2. Risk calculation never uses estimated values.
3. Missing evidence is visible to the user.
4. BUY/SELL wording is explicitly a bias, not a guaranteed forecast.
5. Report history continues to save the complete source-backed context.
