"use strict";

// Production guard for /api/analyze:
// 1) coalesces duplicate in-flight requests for the same symbol/payload
// 2) caches completed analysis responses for a short TTL
// 3) prevents accidental double-clicks/retries from running the expensive
//    quant + news + AI pipeline multiple times concurrently.

const express = require("express");
const crypto = require("crypto");

const originalPost = express.application.post;
const cache = new Map();
const inflight = new Map();
const TTL_MS = Math.max(30_000, Number(process.env.ANALYZE_CACHE_TTL_MS || 300_000));
const MAX_CACHE = Math.max(10, Number(process.env.ANALYZE_CACHE_MAX || 100));

function keyFor(req) {
    const body = req && req.body ? req.body : {};
    const symbol = String(body.symbol || body.ticker || body.stock || "").trim().toUpperCase();
    const stable = JSON.stringify({ symbol, body });
    return crypto.createHash("sha256").update(stable).digest("hex");
}

function trimCache() {
    while (cache.size > MAX_CACHE) {
        const first = cache.keys().next().value;
        if (first === undefined) break;
        cache.delete(first);
    }
}

function replay(res, result) {
    if (res.headersSent) return;
    res.statusCode = result.statusCode || 200;
    if (result.type === "json") return res.json(result.body);
    if (result.type === "text") return res.send(result.body);
    return res.end(result.body);
}

function wrapAnalyze(handler) {
    return async function productionAnalyzeGuard(req, res, next) {
        const key = keyFor(req);
        const now = Date.now();
        const cached = cache.get(key);

        if (cached && cached.expiresAt > now) {
            console.log(`⚡ ANALYZE CACHE HIT ${String(req.body?.symbol || "").toUpperCase()}`);
            return replay(res, cached.result);
        }
        if (cached) cache.delete(key);

        if (inflight.has(key)) {
            console.log(`🔁 ANALYZE COALESCED ${String(req.body?.symbol || "").toUpperCase()}`);
            try {
                const result = await inflight.get(key);
                return replay(res, result);
            } catch (err) {
                return next(err);
            }
        }

        let resolveInflight;
        let rejectInflight;
        const promise = new Promise((resolve, reject) => {
            resolveInflight = resolve;
            rejectInflight = reject;
        });
        inflight.set(key, promise);

        let captured = null;
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);
        const originalEnd = res.end.bind(res);

        const finish = (result) => {
            if (!captured) {
                captured = result;
                cache.set(key, { expiresAt: Date.now() + TTL_MS, result });
                trimCache();
                resolveInflight(result);
            }
        };

        res.json = (body) => {
            finish({ type: "json", statusCode: res.statusCode || 200, body });
            return originalJson(body);
        };
        res.send = (body) => {
            finish({ type: "text", statusCode: res.statusCode || 200, body });
            return originalSend(body);
        };
        res.end = (body, encoding, callback) => {
            finish({ type: "end", statusCode: res.statusCode || 200, body: body == null ? null : body.toString() });
            return originalEnd(body, encoding, callback);
        };

        try {
            const result = handler(req, res, next);
            if (result && typeof result.then === "function") await result;
            if (!captured && res.headersSent) {
                finish({ type: "end", statusCode: res.statusCode || 200, body: null });
            }
        } catch (err) {
            rejectInflight(err);
            inflight.delete(key);
            throw err;
        }

        inflight.delete(key);
        if (!captured && !res.headersSent) {
            const result = { type: "end", statusCode: 204, body: null };
            finish(result);
        }
    };
}

express.application.post = function productionPost(path, ...handlers) {
    if (path === "/api/analyze") {
        handlers = handlers.map((handler) =>
            typeof handler === "function" ? wrapAnalyze(handler) : handler
        );
    }
    return originalPost.call(this, path, ...handlers);
};

console.log(`🛡️ Production hardening enabled: analyze cache TTL=${TTL_MS}ms, max=${MAX_CACHE}`);


/*
 * PRAN AI quarterly-results route.
 * This route is registered before Express starts listening so the existing
 * server-v2.js does not need to be modified just to expose quarterly data.
 */
const originalListen = express.application.listen;
express.application.listen = function pranListen(...args) {
    const app = this;
    if (!app.__pranQuarterlyRouteInstalled) {
        app.__pranQuarterlyRouteInstalled = true;
        app.get("/api/quarterly", (req, res) => {
            const symbol = String(req.query?.symbol || "").trim().toUpperCase();
            if (!symbol) {
                return res.status(400).json({ success: false, error: "Stock symbol is required." });
            }
            const python = String(
                process.env.PYTHON_EXECUTABLE ||
                (process.platform === "win32" ? "python.exe" : "python3")
            );
            const script = require("path").join(__dirname, "quarterly-pipeline.py");
            require("child_process").execFile(
                python,
                [script, symbol],
                {
                    cwd: __dirname,
                    timeout: Number(process.env.QUARTERLY_TIMEOUT_MS || 60000),
                    maxBuffer: 4 * 1024 * 1024,
                    env: process.env
                },
                (error, stdout, stderr) => {
                    if (error && !String(stdout || "").trim()) {
                        return res.status(502).json({
                            success: false,
                            error: "Quarterly data fetch failed.",
                            detail: String(stderr || error.message).slice(0, 1200)
                        });
                    }
                    try {
                        const data = JSON.parse(String(stdout || "").trim());
                        if (data.status !== "SUCCESS") {
                            return res.status(502).json({
                                success: false,
                                error: data.error || "Quarterly data unavailable."
                            });
                        }
                        return res.json({
                            success: true,
                            symbol: data.symbol,
                            period: data.period,
                            quarters: data.quarters || [],
                            source: data.source || null,
                            note: data.note || null
                        });
                    } catch (parseError) {
                        return res.status(502).json({
                            success: false,
                            error: "Quarterly pipeline returned invalid JSON.",
                            detail: String(stderr || parseError.message).slice(0, 1200)
                        });
                    }
                }
            );
        });
        console.log("📈 Quarterly Results API enabled: /api/quarterly");
    }
    return originalListen.apply(this, args);
};
