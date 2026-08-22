"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const root = __dirname;
let failures = 0;

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`FAIL: ${message}`);
}

function requireFile(file) {
  if (fs.existsSync(path.join(root, file))) pass(`required file ${file}`);
  else fail(`missing required file ${file}`);
}

function sourceContains(file, pattern, label) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  if (text.includes(pattern)) pass(label);
  else fail(label);
}

function noCommittedSecrets(file) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const suspicious = [
    /AIza[0-9A-Za-z_-]{20,}/,
    /gsk_[0-9A-Za-z_-]{20,}/,
    /sk-[0-9A-Za-z_-]{20,}/
  ];
  if (suspicious.some((re) => re.test(text))) fail(`possible API secret in ${file}`);
  else pass(`no obvious API secret in ${file}`);
}

function request(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https://") ? https : http;
    const req = client.get(url, { timeout: 15000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
  });
}

async function liveCheck() {
  const base = String(process.env.LIVE_URL || "").trim().replace(/\/$/, "");
  if (!base) {
    console.log("INFO: LIVE_URL not set; skipping live Railway checks.");
    return;
  }

  for (const endpoint of ["/api/health", "/api/ai-status", "/api/ai-test"]) {
    try {
      const result = await request(`${base}${endpoint}`);
      if (result.status === 200) pass(`live ${endpoint} returned HTTP 200`);
      else fail(`live ${endpoint} returned HTTP ${result.status}`);

      if (endpoint === "/api/ai-status") {
        const data = JSON.parse(result.body);
        if (data.ready_for_ai === true) pass("live AI status reports ready_for_ai=true");
        else fail("live AI status is not ready_for_ai=true");
      }

      if (endpoint === "/api/ai-test") {
        const data = JSON.parse(result.body);
        if (data.success === true && data.response === "AI_PROVIDER_TEST_OK") {
          pass("live AI provider test returned AI_PROVIDER_TEST_OK");
        } else {
          fail("live AI provider test did not return AI_PROVIDER_TEST_OK");
        }
      }
    } catch (error) {
      fail(`live ${endpoint} request failed: ${error.message}`);
    }
  }
}

async function main() {
  requireFile("server.js");
  requireFile("step8-production-verification.js");
  requireFile("package.json");

  sourceContains("server.js", "/api/ai-status", "AI status endpoint exists");
  sourceContains("server.js", "/api/ai-test", "AI test endpoint exists");
  sourceContains("server.js", "GEMINI_API_KEY", "Gemini key is read from runtime environment");
  sourceContains("server.js", "GROQ_API_KEY", "Groq key is read from runtime environment");
  sourceContains("server.js", "AI_PROVIDER_TEST_OK", "AI provider smoke-test response exists");
  noCommittedSecrets("server.js");

  await liveCheck();

  console.log("\nStep 9 AI production verification summary");
  if (failures) {
    console.error(`${failures} verification check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("All Step 9 verification checks passed.");
  }
}

main().catch((error) => {
  console.error(`FAIL: verifier crashed: ${error.message}`);
  process.exitCode = 1;
});
