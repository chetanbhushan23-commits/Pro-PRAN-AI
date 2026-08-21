"use strict";

const fs = require("fs");
const { buildDecisionRisk } = require("./decision-risk-engine.js");

const input = process.argv[2];
if (!input) {
    console.error("Usage: node step6-risk-report.js <json-file>");
    process.exit(1);
}

try {
    const payload = JSON.parse(fs.readFileSync(input, "utf8"));
    const result = buildDecisionRisk(
        payload.symbol,
        payload.quantData,
        payload.sentimentData,
        payload.researchQuality
    );
    process.stdout.write(JSON.stringify(result, null, 2));
} catch (error) {
    console.error(`Step 6 risk engine failed: ${error.message}`);
    process.exit(1);
}
