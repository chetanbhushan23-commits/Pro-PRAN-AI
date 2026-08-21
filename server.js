"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");

const { analyzeSentiment } = require("./sentiment.js");
const { saveReport, getReports } = require("./report-history.js");
const { buildResearchQuality } = require("./research-quality.js");

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

/* =========================================================
   AI PROVIDERS
   Keys are read only from runtime environment. Never commit keys.
========================================================= */
const geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
const groqKey = (process.env.GROQ_API_KEY || "").trim();
const geminiModelName = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const groqModelName = (process.env.GROQ_MODEL || "openai/gpt-oss-20b").trim();

const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
const geminiModel = genAI ? genAI.getGenerativeModel({ model: geminiModelName }) : null;
const groq = groqKey ? new Groq({ apiKey: groqKey }) : null;

function providerStatus() {
    return {
        gemini: { configured: Boolean(geminiKey), model: geminiKey ? geminiModelName : null },
        groq: { configured: Boolean(groqKey), model: groqKey ? groqModelName : null },
        active_provider: geminiModel ? "GEMINI" : groq ? "GROQ" : "NONE"
    };
}

console.log("🤖 AI Provider Status:", JSON.stringify(providerStatus()));

/* =========================================================
   PYTHON QUANT PIPELINE
========================================================= */
function runPython(command, args) {
    return new Promise((resolve) => {
        execFile(command, args, {
            cwd: __dirname,
            timeout: Number(process.env.PYTHON_TIMEOUT_MS || 60000),
            maxBuffer: 5 * 1024 * 1024,
            windowsHide: true,
            env: process.env
        }, (error, stdout, stderr) => resolve({
            error,
            stdout: stdout || "",
            stderr: stderr || "",
            command
        }));
    });
}

function parsePythonJson(stdout) {
    const text = String(stdout || "").trim();
    if (!text) throw new Error("Python returned empty output");
    try {
        return JSON.parse(text);
    } catch (_) {
        const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
            try { return JSON.parse(lines[i]); } catch (_) {}
        }
        throw new Error(`Python output was not valid JSON: ${text.slice(0, 1000)}`);
    }
}

function normalizeInputSymbol(symbol) {
    return String(symbol || "")
        .trim()
        .toUpperCase()
        .replace(/\.NSE$/i, "")
        .replace(/\.NS$/i, "")
        .replace(/\.BSE$/i, "")
        .replace(/\.BO$/i, "")
        .replace(/[^A-Z0-9]/g, "");
}

async function getQuantData(symbol) {
    const safeSymbol = normalizeInputSymbol(symbol);
    if (!safeSymbol) return { status: "FAILED", error: "Invalid stock symbol." };

    const configuredPython = process.env.PYTHON_EXECUTABLE?.trim();
    const commands = configuredPython
        ? [configuredPython]
        : process.platform === "win32"
            ? ["python.exe", "py.exe", "python3.exe"]
            : ["python3", "python"];

    const pipelinePath = path.join(__dirname, "quant-pipeline.py");
    const attempts = [];

    for (const command of commands) {
        const result = await runPython(command, [pipelinePath, safeSymbol]);
        attempts.push({
            command,
            exit_error: result.error ? result.error.message : null,
            stderr: result.stderr ? result.stderr.slice(0, 2000) : null
        });

        if (result.error || !result.stdout.trim()) continue;

        try {
            const parsed = parsePythonJson(result.stdout);
            if (parsed?.status === "SUCCESS") {
                console.log(`📊 Quant pipeline SUCCESS via ${command}: ${safeSymbol}`);
                return parsed;
            }
            attempts.push({
                command,
                pipeline_status: parsed?.status || "UNKNOWN",
                pipeline_error: parsed?.error || null
            });
        } catch (error) {
            attempts.push({
                command,
                parse_error: error.message,
                stdout: result.stdout.slice(0, 2000)
            });
        }
    }

    console.error("❌ Quant pipeline failed:", JSON.stringify(attempts, null, 2));
    return {
        status: "FAILED",
        error: "Validated quant pipeline could not be executed successfully.",
        attempts,
        hint: "Install Python dependencies and run: python quant-pipeline.py INFY"
    };
}

/* =========================================================
   VERIFIED TECHNICAL FACTS + SCORE
========================================================= */
function buildVerifiedTechnicalFacts(quantData) {
    const t = quantData?.technicals;
    const i = t?.indicators;
    if (!t || !i) return { status: "UNAVAILABLE" };

    const price = t.current_price;
    const ema20 = i.EMA_20;
    const ema50 = i.EMA_50;
    const ema200 = i.EMA_200;
    const values = [price, ema20, ema50, ema200];
    const bullish = values.every(v => v != null) && price > ema20 && ema20 > ema50 && ema50 > ema200;
    const bearish = values.every(v => v != null) && price < ema20 && ema20 < ema50 && ema50 < ema200;

    return {
        status: "VERIFIED",
        price,
        previous_close: t.previous_close,
        trend: t.trend,
        ema_stack: bullish
            ? "BULLISH: Price > EMA20 > EMA50 > EMA200"
            : bearish
                ? "BEARISH: Price < EMA20 < EMA50 < EMA200"
                : "MIXED",
        rsi: i.RSI_14,
        macd_histogram: i.MACD_Histogram,
        volume_ratio: i.Volume_Ratio,
        hard_rule: bullish
            ? "Do not describe this setup as bearish or below moving averages."
            : bearish
                ? "Do not describe this setup as bullish or above moving averages."
                : "Describe the verified setup as mixed only."
    };
}

function buildDeterministicScore(quantData, sentimentData) {
    const i = quantData?.technicals?.indicators;
    const f = quantData?.fundamentals?.values;
    if (!i) return { status: "INCOMPLETE", technical: null, fundamental: null, sentiment: null, market_sector: null };

    let technical = 5;
    if (quantData.technicals.trend === "BULLISH") technical += 2;
    if (quantData.technicals.trend === "BEARISH") technical -= 2;
    if (i.RSI_14 != null && i.RSI_14 >= 50 && i.RSI_14 < 70) technical += 1;
    if (i.RSI_14 != null && i.RSI_14 < 30) technical -= 1;
    if (i.MACD_Histogram != null && i.MACD_Histogram > 0) technical += 1;
    if (i.MACD_Histogram != null && i.MACD_Histogram < 0) technical -= 1;
    if (i.Volume_Ratio != null && i.Volume_Ratio >= 1.5) technical += 1;
    technical = Math.max(0, Math.min(10, technical));

    let fundamental = null;
    if (f && [f.PE_ratio, f.PB_ratio, f.ROE, f.debt_to_equity].some(v => v != null)) {
        fundamental = 5;
        if (f.debt_to_equity != null && f.debt_to_equity < 1) fundamental += 1.5;
        if (f.ROE != null && f.ROE >= 15) fundamental += 1.5;
        if (f.PE_ratio != null && f.PE_ratio > 0 && f.PE_ratio < 35) fundamental += 1;
        if (f.PB_ratio != null && f.PB_ratio > 0 && f.PB_ratio < 8) fundamental += 1;
        fundamental = Math.min(10, fundamental);
    }

    return {
        status: "PARTIAL",
        technical: Number(technical.toFixed(2)),
        fundamental: fundamental == null ? null : Number(fundamental.toFixed(2)),
        sentiment: sentimentData?.score ?? null,
        market_sector: null,
        note: "Unavailable components remain N/A; no estimates."
    };
}

function collectSources(quantData, sentimentData) {
    const sources = [];
    if (quantData?.data_source?.url) sources.push({ ...quantData.data_source, type: "market_data" });
    if (quantData?.fundamentals?.source?.url) sources.push({ ...quantData.fundamentals.source, type: "fundamentals" });

    for (const article of sentimentData?.articles || []) {
        if (!article.url) continue;
        sources.push({
            type: "news",
            provider: article.provider || "News source",
            publisher: article.source || "Unknown publisher",
            source_tier: article.source_tier || "UNKNOWN",
            relevance: article.relevance || "UNKNOWN",
            url: article.url,
            published_at: article.publishedAt || null,
            retrieved_at: article.retrievedAt || null,
            title: article.title || null
        });
    }
    return sources;
}

function buildFallbackReport(symbol, quantData, verified, score, sentimentData, sources, quality) {
    const i = quantData?.technicals?.indicators || {};
    const f = quantData?.fundamentals?.values || {};
    const rec = score.technical >= 7 ? "BUY" : score.technical <= 3 ? "SELL" : "WAIT";
    const trace = sentimentData?.traceability || {};

    const newsLines = (sentimentData?.articles || []).slice(0, 15)
        .map((a, n) => `${n + 1}. **${a.title || "Untitled"}** — ${a.source || "Unknown"} | ${a.relevance || "UNKNOWN"} | ${a.publishedAt || "date N/A"}\n   ${a.url}`)
        .join("\n");

    const sourceLines = sources.length
        ? sources.map((s, n) => `${n + 1}. ${s.provider || s.type} | ${s.publisher || ""} | ${s.relevance || ""} | ${s.url}${s.title ? ` — ${s.title}` : ""}`).join("\n")
        : "- No verified source URL available";

    return `# ${symbol} — Verified Quant Research Report

## Executive Summary
- Recommendation: **${rec}**
- Evidence status: **${quality?.overall_status || "N/A"}**
- Data completeness: **${quality?.data_completeness?.completeness_percent ?? "N/A"}%**
- Technical state: **${quantData.technicals.trend || "N/A"}**
- News sentiment: **${sentimentData?.sentiment || "N/A"} (${sentimentData?.score ?? "N/A"}/10)**
- News evidence quality: **${quality?.news_quality?.quality_label || "N/A"} (${quality?.news_quality?.quality_score ?? "N/A"}/100)**

## Data Snapshot
- Price: ${quantData.technicals.current_price ?? "N/A"}
- Previous Close: ${quantData.technicals.previous_close ?? "N/A"}
- Trend: ${quantData.technicals.trend ?? "N/A"}
- RSI(14): ${i.RSI_14 ?? "N/A"}
- EMA20 / EMA50 / EMA200: ${i.EMA_20 ?? "N/A"} / ${i.EMA_50 ?? "N/A"} / ${i.EMA_200 ?? "N/A"}
- MACD Histogram: ${i.MACD_Histogram ?? "N/A"}
- ATR(14): ${i.ATR_14 ?? "N/A"}
- Volume Ratio: ${i.Volume_Ratio ?? "N/A"}

## Technical Analysis
- Verified EMA structure: ${verified.ema_stack}
- RSI: ${i.RSI_14 ?? "N/A"}
- MACD Histogram: ${i.MACD_Histogram ?? "N/A"}
- Volume ratio: ${i.Volume_Ratio ?? "N/A"}

## Fundamentals
- Market Cap: ${f.market_cap ?? "N/A"}
- PE: ${f.PE_ratio ?? "N/A"}
- PB: ${f.PB_ratio ?? "N/A"}
- ROE: ${f.ROE ?? "N/A"}
- Debt/Equity: ${f.debt_to_equity ?? "N/A"}

## Verified News & Sentiment — Last 7 Days
${sentimentData?.summary || "No verified recent news available."}

- Direct company articles: ${trace.direct_company_articles ?? "N/A"}
- Market-context articles: ${trace.market_context_articles ?? "N/A"}
- Tier-1 publisher articles: ${trace.tier1_articles ?? "N/A"}
- NewsAPI articles: ${trace.newsapi_articles ?? "N/A"}
- Google News discovery/context articles: ${trace.google_news_articles ?? "N/A"}

${newsLines || "No verified articles available."}

## Research Quality & Traceability
- Directly relevant news: ${quality?.news_quality?.directly_relevant_count ?? "N/A"}/${quality?.news_quality?.article_count ?? "N/A"}
- Publishers: ${quality?.news_quality?.publisher_count ?? "N/A"}
- Providers: ${quality?.news_quality?.provider_count ?? "N/A"}
- Average relevance: ${quality?.news_quality?.average_relevance_score ?? "N/A"}/100
- Warnings: ${quality?.warnings?.length ? quality.warnings.join(" | ") : "None"}

## Risk Factors & Conflicting Signals
${(sentimentData?.negative_drivers || []).map(x => `- ${x}`).join("\n") || "- No model-generated negative driver available."}
${(sentimentData?.conflicting_signals || []).map(x => `- Conflict: ${x}`).join("\n") || "- No conflicting signal reported."}

## Quant Score
- Technical: ${score.technical ?? "N/A"}/10
- Fundamental: ${score.fundamental ?? "N/A"}/10
- Sentiment: ${score.sentiment ?? "N/A"}/10
- Market/Sector: N/A

## Final Recommendation
**${rec}** — based only on verified supplied data. This is not a guarantee of future returns.

## Source Traceability
${sourceLines}
`;
}

/* =========================================================
   AI REPORT GENERATION
   Gemini is primary; Groq is automatic fallback.
========================================================= */
function buildAIPrompt(symbol, context) {
    return `You are an evidence-first Indian Stock Market Quant Research Analyst.

Analyze ONLY the supplied JSON for ${symbol}. Never invent, estimate, or use outside facts. null means N/A. Never claim Dhan. Never contradict verifiedTechnicalFacts. Never manufacture OI/F&O, FII/DII, sector, support/resistance, targets, earnings, macro or regulatory claims unless supplied. News claims ONLY from supplied articles. Distinguish DIRECT_COMPANY from MARKET_CONTEXT. Treat TIER_1 publishers as higher-quality evidence, not as automatically true. If sources conflict, report the conflict. Every important number must be sourced or clearly described as calculated from supplied OHLCV. Do not create a complete score when components are unavailable.

Write a deep but readable report with: Executive Summary, Data Snapshot, Technical Analysis, Fundamental Analysis, Business/Market Context only when supplied, Verified News & Sentiment (last 7 days with publisher/date/relevance/provider/URL), Positive Drivers, Negative Drivers & Conflicting Signals, Research Quality & Traceability, Risk Factors, Quant Score, Final Recommendation, and numbered Source Traceability. Explicitly mention missing data and evidence limitations. Keep source URLs intact. Use simple Hinglish where useful.

RAW VERIFIED DATA:
${JSON.stringify(context, null, 2)}`;
}

async function generateWithGemini(prompt) {
    if (!geminiModel) throw new Error("GEMINI_API_KEY is not configured");
    const result = await geminiModel.generateContent(prompt);
    const text = result?.response?.text?.();
    if (!text) throw new Error("Gemini returned empty content");
    return text;
}

async function generateWithGroq(prompt) {
    if (!groq) throw new Error("GROQ_API_KEY is not configured");
    const result = await groq.chat.completions.create({
        model: groqModelName,
        messages: [
            { role: "system", content: "You are an evidence-first Indian stock research analyst. Return only the requested report." },
            { role: "user", content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 12000
    });
    const text = result?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Groq returned empty content");
    return text;
}

async function generateAIReport(prompt) {
    const errors = [];

    if (geminiModel) {
        try {
            console.log(`🤖 Gemini ACTIVE (${geminiModelName})`);
            return { text: await generateWithGemini(prompt), provider: "GEMINI", model: geminiModelName, errors };
        } catch (error) {
            console.error("⚠️ Gemini failed:", error.message);
            errors.push({ provider: "GEMINI", error: error.message });
        }
    }

    if (groq) {
        try {
            console.log(`⚡ Groq ACTIVE (${groqModelName})`);
            return { text: await generateWithGroq(prompt), provider: "GROQ", model: groqModelName, errors };
        } catch (error) {
            console.error("⚠️ Groq failed:", error.message);
            errors.push({ provider: "GROQ", error: error.message });
        }
    }

    return { text: null, provider: "DETERMINISTIC", model: null, errors };
}

async function getSentiment(symbol) {
    try {
        return await analyzeSentiment(symbol);
    } catch (error) {
        return {
            sentiment: "N/A",
            score: null,
            summary: "News sentiment unavailable.",
            articles: [],
            source_status: "UNAVAILABLE",
            error: error.message
        };
    }
}

/* =========================================================
   ANALYZE API
========================================================= */
app.get("/api/analyze", async (req, res) => {
    const symbol = normalizeInputSymbol(req.query.symbol);
    if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });

    console.log(`\n🚀 UI Request Received for: ${symbol}`);

    try {
        const quantData = await getQuantData(symbol);
        if (!quantData || quantData.status !== "SUCCESS") {
            return res.status(502).json({
                success: false,
                error: "Validated market data unavailable. Report generation stopped.",
                quantData
            });
        }

        const sentimentData = await getSentiment(symbol);
        const verifiedTechnicalFacts = buildVerifiedTechnicalFacts(quantData);
        const deterministicScore = buildDeterministicScore(quantData, sentimentData);
        const researchQuality = buildResearchQuality(symbol, quantData, sentimentData);
        const sources = collectSources(quantData, sentimentData);

        const fullContext = {
            symbol,
            quantData,
            verifiedTechnicalFacts,
            deterministicScore,
            sentimentData,
            sources,
            researchQuality,
            ai_provider: providerStatus(),
            traceability: {
                news_lookback_days: 7,
                generated_at: new Date().toISOString(),
                history_retention_days: 7
            }
        };

        const aiResult = await generateAIReport(buildAIPrompt(symbol, fullContext));
        const finalReport = aiResult.text || buildFallbackReport(
            symbol,
            quantData,
            verifiedTechnicalFacts,
            deterministicScore,
            sentimentData,
            sources,
            researchQuality
        );

        fullContext.ai_used = aiResult.provider;
        fullContext.ai_model = aiResult.model;
        fullContext.ai_errors = aiResult.errors;

        const history = saveReport(symbol, { report: finalReport, data: fullContext });

        return res.json({
            success: true,
            report: finalReport,
            data: fullContext,
            history
        });
    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({
            success: false,
            error: "AI Engine failed to generate report.",
            detail: error.message
        });
    }
});

/* =========================================================
   RESEARCH QUALITY + HISTORY
========================================================= */
app.get("/api/research-quality", async (req, res) => {
    const symbol = normalizeInputSymbol(req.query.symbol);
    if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });

    try {
        const quantData = await getQuantData(symbol);
        if (!quantData || quantData.status !== "SUCCESS") {
            return res.status(502).json({ success: false, error: "Validated market data unavailable.", quantData });
        }
        const sentimentData = await getSentiment(symbol);
        return res.json({
            success: true,
            researchQuality: buildResearchQuality(symbol, quantData, sentimentData)
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/api/history", (req, res) => {
    const symbol = normalizeInputSymbol(req.query.symbol);
    if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });

    try {
        return res.json({ success: true, ...getReports(symbol) });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/* =========================================================
   HEALTH + AI TEST APIs
========================================================= */
app.get("/api/health", (req, res) => {
    const status = providerStatus();
    return res.json({
        success: true,
        server: "running",
        data_engine: "validated-python-yahoo",
        market_data: "Yahoo Finance via quant-pipeline.py",
        dhan_dependency: false,
        news_engine: "sentiment.js",
        news_lookback_days: 7,
        history_enabled: true,
        history_retention_days: 7,
        research_quality_enabled: true,
        ai: status,
        ready_for_ai: Boolean(geminiModel || groq),
        runtime: { platform: process.platform, node: process.version },
        timestamp: new Date().toISOString()
    });
});

app.get("/api/ai-status", (req, res) => {
    return res.json({ success: true, ...providerStatus() });
});

app.get("/api/ai-test", async (req, res) => {
    try {
        const result = await generateAIReport("Reply with exactly: AI_PROVIDER_TEST_OK");
        return res.json({
            success: Boolean(result.text),
            provider: result.provider,
            model: result.model,
            response: result.text,
            errors: result.errors,
            configured: providerStatus()
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message, configured: providerStatus() });
    }
});

/* =========================================================
   SERVER START
========================================================= */
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
    const status = providerStatus();
    console.log("\n==============================================");
    console.log(`🚀 AI TRADING SERVER RUNNING ON ${HOST}:${PORT}`);
    console.log("==============================================");
    console.log("📊 Market Data: validated quant-pipeline.py");
    console.log("📈 Market Provider: Yahoo Finance / yfinance");
    console.log("📰 News Lookback: 7 days");
    console.log("🔎 Research Quality: relevance + freshness + source diversity");
    console.log("💾 Report History: enabled");
    console.log("🚫 Dhan Dependency: OFF");
    console.log(`🤖 Gemini: ${status.gemini.configured ? `ON (${status.gemini.model})` : "OFF - GEMINI_API_KEY missing"}`);
    console.log(`⚡ Groq: ${status.groq.configured ? `ON (${status.groq.model})` : "OFF - GROQ_API_KEY missing"}`);
    console.log(`🧠 Active AI: ${status.active_provider}`);
    console.log("==============================================\n");
});

server.on("error", (error) => {
    console.error("❌ Server error:", error.message);
    if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use. Stop the old server or set PORT in .env.`);
    }
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
