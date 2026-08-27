"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const exists = name => fs.existsSync(path.join(ROOT, name));
const files = [
  "quant-pipeline.py", "quarterly-results.py", "sentiment.js", "research.js",
  "research-data-engine.js", "research-data-engine-v2.js", "evidence-validator.js",
  "source-validator.js", "ai-answer-engine.js", "ai-research-agent.js", "final-engine.js"
];

const checks = files.map(file => ({ file, present: exists(file) }));
const envKeys = ["GEMINI_API_KEY", "GROQ_API_KEY", "ALPHA_VANTAGE_API_KEY", "FMP_API_KEY", "NEWS_API_KEY"];
const configured = envKeys.filter(k => String(process.env[k] || "").trim()).map(k => k.replace(/_API_KEY$/, ""));

const layers = [
  ["market_price_ohlcv", "quant-pipeline.py"],
  ["technical_ema_rsi_volume", "quant-pipeline.py"],
  ["quarterly_results", "quarterly-results.py"],
  ["news_sentiment", "sentiment.js"],
  ["research_data", "research-data-engine-v2.js"],
  ["evidence_validation", "evidence-validator.js"],
  ["source_validation", "source-validator.js"],
  ["ai_answer", "ai-answer-engine.js"],
  ["ai_research", "ai-research-agent.js"],
  ["signal_engine", "final-engine.js"]
].map(([layer, file]) => ({ layer, file, present: exists(file) }));

const missing = layers.filter(x => !x.present);
const result = {
  status: missing.length ? "PARTIAL" : "READY",
  checked_at: new Date().toISOString(),
  runtime: process.version,
  files: checks,
  layers,
  ai_providers: configured,
  missing_layers: missing.map(x => x.layer),
  note: "Presence audit only. A provider is not considered live until its endpoint returns validated data. Missing secrets are not errors in source control."
};

console.log(JSON.stringify(result, null, 2));
