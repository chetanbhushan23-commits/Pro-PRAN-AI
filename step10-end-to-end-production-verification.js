"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const LIVE_URL = String(process.env.LIVE_URL || "").trim().replace(/\/$/, "");
const SYMBOL = String(process.env.TEST_SYMBOL || "INFY").trim().toUpperCase();

let failures = 0;

function pass(message) {
    console.log(`PASS: ${message}`);
}

function fail(message) {
    failures += 1;
    console.error(`FAIL: ${message}`);
}

function info(message) {
    console.log(`INFO: ${message}`);
}

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), "utf8");
}

function checkFile(name) {
    if (fs.existsSync(path.join(ROOT, name))) pass(`required file ${name}`);
    else fail(`missing required file ${name}`);
}

function assert(condition, message) {
    if (condition) pass(message);
    else fail(message);
}

async function getJson(url) {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    const text = await response.text();
    let body;
    try {
        body = JSON.parse(text);
    } catch (_) {
        throw new Error(`non-JSON response (${response.status}): ${text.slice(0, 300)}`);
    }
    return { response, body };
}

async function run() {
    console.log("\nStep 10 — End-to-End AI Research Production Verification\n");

    [
        "server.js",
        "quant-pipeline.py",
        "sentiment.js",
        "report-history.js",
        "research-quality.js",
        "step8-production-verification.js",
        "step9-ai-production-verification.js",
        "package.json"
    ].forEach(checkFile);

    let server = "";
    try {
        server = read("server.js");
        assert(server.includes('app.get("/api/health"'), "health endpoint exists");
        assert(server.includes('app.get("/api/ai-status"'), "AI status endpoint exists");
        assert(server.includes('app.get("/api/ai-test"'), "AI test endpoint exists");
        assert(server.includes('app.get("/api/analyze"'), "analysis endpoint exists");
        assert(!/(sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})/.test(server), "no obvious API secret in server.js");
        assert(server.includes("process.env.GEMINI_API_KEY") || server.includes("process.env.GOOGLE_API_KEY"), "Gemini key is read from runtime environment");
        assert(server.includes("process.env.GROQ_API_KEY"), "Groq key is read from runtime environment");
    } catch (error) {
        fail(`could not inspect server.js: ${error.message}`);
    }

    if (!LIVE_URL) {
        info("LIVE_URL not set; skipping live Railway end-to-end checks.");
        console.log("\nStep 10 end-to-end production verification summary");
        if (failures) {
            console.error(`${failures} verification check(s) failed.`);
            process.exitCode = 1;
        } else {
            console.log("All Step 10 static verification checks passed.");
        }
        return;
    }

    info(`Checking live production URL: ${LIVE_URL}`);

    try {
        const health = await getJson(`${LIVE_URL}/api/health`);
        assert(health.response.ok && health.body.success === true, "Railway /api/health is healthy");
        assert(health.body.ready_for_ai === true, "Railway reports ready_for_ai=true");
        assert(health.body.dhan_dependency === false, "Dhan dependency remains OFF");
        assert(health.body.ai?.active_provider && health.body.ai.active_provider !== "NONE", "an AI provider is active in Railway");
    } catch (error) {
        fail(`Railway /api/health check failed: ${error.message}`);
    }

    try {
        const status = await getJson(`${LIVE_URL}/api/ai-status`);
        assert(status.response.ok && status.body.success === true, "Railway /api/ai-status succeeds");
        assert(status.body.ready_for_ai === true, "AI status reports ready_for_ai=true");
        assert(Boolean(status.body.gemini?.configured || status.body.groq?.configured), "at least one AI provider is configured");
    } catch (error) {
        fail(`Railway /api/ai-status check failed: ${error.message}`);
    }

    try {
        const smoke = await getJson(`${LIVE_URL}/api/ai-test`);
        assert(smoke.response.ok && smoke.body.success === true, "Railway /api/ai-test succeeds");
        assert(smoke.body.response === "AI_PROVIDER_TEST_OK", "AI smoke test returns AI_PROVIDER_TEST_OK");
    } catch (error) {
        fail(`Railway /api/ai-test check failed: ${error.message}`);
    }

    try {
        const analysis = await getJson(`${LIVE_URL}/api/analyze?symbol=${encodeURIComponent(SYMBOL)}`);
        const data = analysis.body?.data;
        assert(analysis.response.ok && analysis.body?.success === true, `Railway /api/analyze succeeds for ${SYMBOL}`);
        assert(typeof analysis.body?.report === "string" && analysis.body.report.length > 100, "analysis returns a non-empty research report");
        assert(data?.quantData?.status === "SUCCESS", "analysis contains successful validated quant data");
        assert(data?.verifiedTechnicalFacts?.status === "VERIFIED", "verified technical facts are present");
        assert(data?.deterministicScore && typeof data.deterministicScore === "object", "deterministic score is present");
        assert(Array.isArray(data?.sources), "source traceability array is present");
        assert(typeof data?.researchQuality === "object" || typeof data?.quality === "object" || data?.researchQuality == null, "research-quality output is structurally compatible");
        assert(!/Dhan[^\n]*(?:used|source|data)/i.test(analysis.body.report), "report does not claim Dhan data");
        assert(!/(guaranteed returns|guaranteed profit|guaranteed gain)/i.test(analysis.body.report), "report does not make guaranteed-return claims");
    } catch (error) {
        fail(`Railway /api/analyze check failed: ${error.message}`);
    }

    console.log("\nStep 10 end-to-end production verification summary");
    if (failures) {
        console.error(`${failures} verification check(s) failed.`);
        process.exitCode = 1;
    } else {
        console.log("All Step 10 end-to-end production verification checks passed.");
    }
}

run().catch((error) => {
    console.error(`FATAL: ${error.message}`);
    process.exitCode = 1;
});
