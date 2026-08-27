"use strict";

// Safe connectivity audit: source-control presence is NOT treated as a live connection.
// Only layers with an implemented runtime entrypoint are reported as connected.
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;
const exists = f => fs.existsSync(path.join(ROOT, f));

const runtimeLayers = [
  ["market_price_ohlcv", "quant-pipeline.py"],
  ["technical_ema_rsi_volume", "quant-pipeline.py"],
  ["signal_engine", "server-v2.js"],
  ["ai_answer", "server-v2.js"],
  ["news_sentiment", "sentiment.js"]
];

const optionalLayers = [
  ["quarterly_results", "quarterly-results.py"],
  ["research_data", "research-data-engine-v2.js"],
  ["evidence_validation", "evidence-validator.js"],
  ["source_validation", "source-validator.js"],
  ["ai_research", "ai-research-agent.js"]
];

const providers = [
  ["GEMINI", "GEMINI_API_KEY"],
  ["GROQ", "GROQ_API_KEY"],
  ["ALPHA_VANTAGE", "ALPHA_VANTAGE_API_KEY"]
];

const result = {
  status: "SOURCE_AUDIT",
  checked_at: new Date().toISOString(),
  runtime_layers: runtimeLayers.map(([layer,file]) => ({layer,file,present:exists(file)})),
  optional_layers: optionalLayers.map(([layer,file]) => ({layer,file,present:exists(file)})),
  configured_providers: providers.filter(([,key]) => !!String(process.env[key] || "").trim()).map(([name]) => name),
  not_claimed_connected: ["FMP","NEWS_API","FII_DII","FNO_OPTION_CHAIN","PROMOTER_HISTORY","SECTOR_RELATIVE_STRENGTH"],
  note: "A configured secret or source file is not proof of live connectivity. Only runtime-tested providers should be marked CONNECTED."
};

console.log(JSON.stringify(result, null, 2));
