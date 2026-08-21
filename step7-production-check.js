"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = __dirname;
const requiredFiles = [
    "server.js",
    "quant-pipeline.py",
    "sentiment.js",
    "report-history.js",
    "research-quality.js"
];

const checks = [];

function check(name, passed, detail) {
    checks.push({ name, passed: Boolean(passed), detail });
}

for (const file of requiredFiles) {
    const fullPath = path.join(root, file);
    check(`required file: ${file}`, fs.existsSync(fullPath), "file exists");
}

const serverPath = path.join(root, "server.js");
const serverText = fs.existsSync(serverPath)
    ? fs.readFileSync(serverPath, "utf8")
    : "";

check("server.js has no merge conflict markers", !/(^|\n)(<<<<<<<|=======|>>>>>>>)( |$)/m.test(serverText), "no unresolved Git conflict markers");
check("server.js imports research quality", /require\(["']\.\/research-quality\.js["']\)/.test(serverText), "research-quality integration present");
check("health endpoint exists", /app\.get\(\s*["']\/api\/health["']/.test(serverText), "health endpoint present");
check("analyze endpoint exists", /app\.get\(\s*["']\/api\/analyze["']/.test(serverText), "analyze endpoint present");
check("history endpoint exists", /app\.get\(\s*["']\/api\/history["']/.test(serverText), "history endpoint present");
check("API keys are read from environment", !/AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}/.test(serverText), "no obvious hard-coded API key in server.js");

const syntax = spawnSync(process.execPath, ["--check", serverPath], {
    cwd: root,
    encoding: "utf8"
});
check(
    "server.js syntax check",
    syntax.status === 0,
    syntax.status === 0 ? "node --check passed" : (syntax.stderr || "syntax check failed").trim()
);

const failed = checks.filter((item) => !item.passed);

for (const item of checks) {
    console.log(`${item.passed ? "PASS" : "FAIL"} - ${item.name}: ${item.detail}`);
}

console.log(`\nStep 7 production checks: ${checks.length - failed.length}/${checks.length} passed`);

if (failed.length) {
    console.error("\nProduction validation failed.");
    process.exit(1);
}

console.log("Production validation passed.");
