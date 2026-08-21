"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = __dirname;
const requiredFiles = [
  "server.js",
  "quant-pipeline.py",
  "sentiment.js",
  "report-history.js",
  "research-quality.js",
  "package.json"
];

const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`FAIL: ${name} — ${error.message}`);
  }
}

requiredFiles.forEach((file) => {
  check(`required file ${file}`, () => {
    if (!fs.existsSync(path.join(root, file))) throw new Error("file is missing");
  });
});

check("server.js syntax", () => {
  execFileSync(process.execPath, ["--check", path.join(root, "server.js")], { stdio: "pipe" });
});

check("no unresolved git conflict markers", () => {
  const files = ["server.js", "sentiment.js", "report-history.js", "research-quality.js"];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    if (/^(<<<<<<<|=======|>>>>>>>)( |$)/m.test(text)) {
      throw new Error(`conflict marker found in ${file}`);
    }
  }
});

check("research-quality integration", () => {
  const text = fs.readFileSync(path.join(root, "server.js"), "utf8");
  if (!text.includes('require("./research-quality.js")')) throw new Error("module is not imported");
  if (!text.includes("buildResearchQuality")) throw new Error("builder is not referenced");
});

check("health endpoint exists", () => {
  const text = fs.readFileSync(path.join(root, "server.js"), "utf8");
  if (!/app\.get\s*\(\s*["']\/api\/health["']/.test(text)) {
    throw new Error("health endpoint missing");
  }
});

check("analysis endpoint exists", () => {
  const text = fs.readFileSync(path.join(root, "server.js"), "utf8");
  if (!/app\.get\s*\(\s*["']\/api\/analyze["']/.test(text)) {
    throw new Error("analysis endpoint missing");
  }
});

check("environment secrets are not committed in source", () => {
  const files = ["server.js", "sentiment.js", "quant-pipeline.py"];
  const secretPattern = /(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,}|NEWS_API_KEY\s*=\s*[A-Za-z0-9_-]{16,})/;
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    if (secretPattern.test(text)) throw new Error(`possible hard-coded secret in ${file}`);
  }
});

console.log("\nStep 8 production verification summary");
if (failures.length) {
  console.error(`FAILED: ${failures.length} check(s)`);
  process.exitCode = 1;
} else {
  console.log("All production verification checks passed.");
}
