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

// AI providers are optional. The server must still work with only market/news data.
const geminiKey = process.env.GEMINI_API_KEY?.trim();
const groqKey = process.env.GROQ_API_KEY?.trim();
const geminiModelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const groqModelName = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
const geminiModel = genAI ? genAI.getGenerativeModel({ model: geminiModelName }) : null;
const groq = groqKey ? new Groq({ apiKey: groqKey }) : null;

function runPython(command, args) {
    return new Promise((resolve) => {
        execFile(command, args, {
            cwd: __dirname,
            timeout: Number(process.env.PYTHON_TIMEOUT_MS || 60000),
            maxBuffer: 5 * 1024 * 1024,
            windowsHide: true,
            env: process.env,
        }, (error, stdout, stderr) => resolve({
            error,
            stdout: stdout || "",
            stderr: stderr || "",
            command,
        }));
    });
}

function parsePythonJson(stdout) {
    const text = String(stdout || "").trim();
    if (!text) throw new Error("Python returned empty output");
    try { return JSON.parse(text); } catch (_) {
        const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
            try { return JSON.parse(lines[i]); } catch (_) {}
        }
        throw new Error(`Python output was not valid JSON: ${text.slice(0, 1000)}`);
    }
}

function normalizeInputSymbol(symbol) {
    return String(symbol || "")
        .trim().toUpperCase()
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
            stderr: result.stderr ? result.stderr.slice(0, 2000) : null,
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
                pipeline_error: parsed?.error || null,
            });
        } catch (error) {
            attempts.push({ command, parse_error: error.message, stdout: result.stdout.slice(0, 2000) });
        }
    }

    return {
        status: "FAILED",
        error: "Validated quant pipeline could not be executed successfully.",
        attempts,
        hint: "Install Python dependencies and run: python quant-pipeline.py INFY",
    };
}

function buildVerifiedTechnicalFacts(quantData) {
    const t = quantData?.technicals;
    const i = t?.indicators;
    if (!t || !i) return { status: "UNAVAILABLE" };
    const price = t.current_price, ema20 = i.EMA_20, ema50 = i.EMA_50, ema200 = i.EMA_200;
    const values = [price, ema20, ema50, ema200];
    const bullishStack = values.every(v => v != null) && price > ema20 && ema20 > ema50 && ema50 > ema200;
    const bearishStack = values.every(v => v != null) && price < ema20 && ema20 < ema50 && ema50 < ema200;
    return {
        status: "VERIFIED", price, previous_close: t.previous_close, trend: t.trend,
        ema_stack: bullishStack ? "BULLISH: Price > EMA20 > EMA50 > EMA200" : bearishStack ? "BEARISH: Price < EMA20 < EMA50 < EMA200" : "MIXED",
        rsi: i.RSI_14, macd_histogram: i.MACD_Histogram, volume_ratio: i.Volume_Ratio,
        hard_rule: bullishStack ? "Do not describe this setup as bearish or below moving averages." : bearishStack ? "Do not describe this setup as bullish or above moving averages." : "Describe the verified setup as mixed only.",
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
        note: "Unavailable components remain N/A; no estimates.",
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
            title: article.title || null,
        });
    }
    return sources;
}

function buildFallbackReport(symbol, quantData, verified, score, sentimentData, sources, researchQuality) {
    const i = quantData?.technicals?.indicators || {};
    const f = quantData?.fundamentals?.values || {};
    const rec = score.technical >= 7 ? "BUY" : score.technical <= 3 ? "SELL" : "WAIT";
    const trace = sentimentData?.traceability || {};
    const newsLines = (sentimentData?.articles || []).slice(0, 15).map((a, n) => `${n + 1}. **${a.title || "Untitled"}** — ${a.source || "Unknown"} | ${a.relevance || "UNKNOWN"} | ${a.publishedAt || "date N/A"}\n   ${a.url}`).join("\n");
    const sourceLines = sources.length ? sources.map((s, n) => `${n + 1}. ${s.provider || s.type} | ${s.publisher || ""} | ${s.relevance || ""} | ${s.url}${s.title ? ` — ${s.title}` : ""}`).join("\n") : "- No verified source URL available";
    return `# ${symbol} — Verified Quant Research Report\n\n## Executive Summary\n- Recommendation: **${rec}**\n- Evidence status: **${researchQuality?.overall_status || "N/A"}**\n- Data completeness: **${researchQuality?.data_completeness?.completeness_percent ?? "N/A"}%**\n- Technical state: **${quantData.technicals.trend || "N/A"}**\n- News sentiment: **${sentimentData?.sentiment || "N/A"} (${sentimentData?.score ?? "N/A"}/10)**\n- News evidence quality: **${researchQuality?.news_quality?.quality_label || "N/A"} (${researchQuality?.news_quality?.quality_score ?? "N/A"}/100)**\n\n## Data Snapshot\n- Price: ${quantData.technicals.current_price ?? "N/A"}\n- Previous Close: ${quantData.technicals.previous_close ?? "N/A"}\n- Trend: ${quantData.technicals.trend ?? "N/A"}\n- RSI(14): ${i.RSI_14 ?? "N/A"}\n- EMA20 / EMA50 / EMA200: ${i.EMA_20 ?? "N/A"} / ${i.EMA_50 ?? "N/A"} / ${i.EMA_200 ?? "N/A"}\n- MACD Histogram: ${i.MACD_Histogram ?? "N/A"}\n- ATR(14): ${i.ATR_14 ?? "N/A"}\n- Volume Ratio: ${i.Volume_Ratio ?? "N/A"}\n\n## Technical Analysis\n- Verified EMA structure: ${verified.ema_stack}\n- RSI: ${i.RSI_14 ?? "N/A"}\n- MACD Histogram: ${i.MACD_Histogram ?? "N/A"}\n- Volume ratio: ${i.Volume_Ratio ?? "N/A"}\n\n## Fundamentals\n- Market Cap: ${f.market_cap ?? "N/A"}\n- PE: ${f.PE_ratio ?? "N/A"}\n- PB: ${f.PB_ratio ?? "N/A"}\n- ROE: ${f.ROE ?? "N/A"}\n- Debt/Equity: ${f.debt_to_equity ?? "N/A"}\n\n## Verified News & Sentiment — Last 7 Days\n${sentimentData?.summary || "No verified recent news available."}\n\n- Direct company articles: ${trace.direct_company_articles ?? "N/A"}\n- Market-context articles: ${trace.market_context_articles ?? "N/A"}\n- Tier-1 publisher articles: ${trace.tier1_articles ?? "N/A"}\n- NewsAPI articles: ${trace.newsapi_articles ?? "N/A"}\n- Google News discovery/context articles: ${trace.google_news_articles ?? "N/A"}\n\n${newsLines || "No verified articles available."}\n\n## Research Quality & Traceability\n- Directly relevant news: ${researchQuality?.news_quality?.directly_relevant_count ?? "N/A"}/${researchQuality?.news_quality?.article_count ?? "N/A"}\n- Publishers: ${researchQuality?.news_quality?.publisher_count ?? "N/A"}\n- Providers: ${researchQuality?.news_quality?.provider_count ?? "N/A"}\n- Average relevance: ${researchQuality?.news_quality?.average_relevance_score ?? "N/A"}/100\n- Warnings: ${researchQuality?.warnings?.length ? researchQuality.warnings.join(" | ") : "None"}\n\n## Risk Factors & Conflicting Signals\n${(sentimentData?.negative_drivers || []).map(x => `- ${x}`).join("\n") || "- No model-generated negative driver available."}\n${(sentimentData?.conflicting_signals || []).map(x => `- Conflict: ${x}`).join("\n") || "- No conflicting signal reported."}\n\n## Quant Score\n- Technical: ${score.technical ?? "N/A"}/10\n- Fundamental: ${score.fundamental ?? "N/A"}/10\n- Sentiment: ${score.sentiment ?? "N/A"}/10\n- Market/Sector: N/A\n\n## Final Recommendation\n**${rec}** — based only on verified supplied data. This is not a guarantee of future returns.\n\n## Source Traceability\n${sourceLines}\n`;
}

function buildPrompt(symbol, fullContext) {
    return `You are an evidence-first Indian Stock Market Quant Research Analyst.\n\nAnalyze ONLY the supplied JSON for ${symbol}. Never invent, estimate, or use outside facts. null means N/A. Never claim Dhan. Never contradict verifiedTechnicalFacts. Never manufacture 52-week, OI/F&O, FII/DII, sector, support/resistance, targets, market-share, earnings, macro or regulatory claims unless supplied. News claims ONLY from supplied articles. Distinguish DIRECT_COMPANY from MARKET_CONTEXT. Treat TIER_1 publishers as higher-quality evidence, not as automatically true. If sources conflict, report the conflict. Every important number must be sourced or clearly described as calculated from supplied OHLCV. Do not create a complete score when components are unavailable.\n\nWrite a deep but readable report with: Executive Summary, Data Snapshot, Technical Analysis, Fundamental Analysis, Business/Market Context only when supplied, Verified News & Sentiment (last 7 days with publisher/date/relevance/provider/URL), Positive Drivers, Negative Drivers & Conflicting Signals, Research Quality & Traceability, Risk Factors, Quant Score, Final Recommendation, and numbered Source Traceability. Explicitly mention missing data and evidence limitations. Keep source URLs intact. Use simple Hinglish where useful.\n\nRAW VERIFIED DATA:\n${JSON.stringify(fullContext, null, 2)}`;
}

async function generateWithGroq(prompt) {
    if (!groq) throw new Error("GROQ_API_KEY is not configured");
    const response = await groq.chat.completions.create({
        model: groqModelName,
        messages: [
            { role: "system", content: "You are an evidence-first Indian stock research analyst. Return only the requested report." },
            { role: "user", content: prompt },
        ],
        temperature: 0.1,
    });
    const text = response.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Groq returned empty content");
    return text;
}

async function generateAIReport(symbol, fullContext, fallback) {
    const prompt = buildPrompt(symbol, fullContext);
    if (geminiModel) {
        try {
            const result = await geminiModel.generateContent(prompt);
            const text = result.response?.text?.();
            if (text) return { report: text, provider: "Gemini", model: geminiModelName };
            throw new Error("Gemini returned empty content");
        } catch (error) {
            console.error(`⚠️ Gemini failed (${geminiModelName}): ${error.message}`);
        }
    }
    if (groq) {
        try {
            const text = await generateWithGroq(prompt);
            return { report: text, provider: "Groq", model: groqModelName };
        } catch (error) {
            console.error(`⚠️ Groq failed (${groqModelName}): ${error.message}`);
        }
    }
    return { report: fallback, provider: "Deterministic", model: null };
}

async function getSentiment(symbol) {
    try { return await analyzeSentiment(symbol); }
    catch (error) {
        return { sentiment: "N/A", score: null, summary: "News sentiment unavailable.", articles: [], source_status: "UNAVAILABLE", error: error.message };
    }
}

app.get("/api/analyze", async (req, res) => {
    const symbol = normalizeInputSymbol(req.query.symbol);
    if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });
    console.log(`\n🚀 UI Request Received for: ${symbol}`);
    try {
        const quantData = await getQuantData(symbol);
        if (!quantData || quantData.status !== "SUCCESS") {
            return res.status(502).json({ success: false, error: "Validated market data unavailable. Report generation stopped.", quantData });
        }
        const sentimentData = await getSentiment(symbol);
        const verifiedTechnicalFacts = buildVerifiedTechnicalFacts(quantData);
        const deterministicScore = buildDeterministicScore(quantData, sentimentData);
        const researchQuality = buildResearchQuality(symbol, quantData, sentimentData);
        const sources = collectSources(quantData, sentimentData);
        const fullContext = {
            symbol, quantData, verifiedTechnicalFacts, deterministicScore, sentimentData, sources, researchQuality,
            traceability: { news_lookback_days: 7, generated_at: new Date().toISOString(), history_retention_days: 7 },
        };
        const fallback = buildFallbackReport(symbol, quantData, verifiedTechnicalFacts, deterministicScore, sentimentData, sources, researchQuality);
        const ai = await generateAIReport(symbol, fullContext, fallback);
        const history = saveReport(symbol, { report: ai.report, data: { ...fullContext, ai: { provider: ai.provider, model: ai.model } } });
        return res.json({ success: true, report: ai.report, data: { ...fullContext, ai: { provider: ai.provider, model: ai.model } }, history });
    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ success: false, error: "AI Engine failed to generate report.", detail: error.message });
    }
});

app.get("/api/research-quality", async (req, res) => {
    const symbol = normalizeInputSymbol(req.query.symbol);
    if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });
    try {
        const quantData = await getQuantData(symbol);
        if (!quantData || quantData.status !== "SUCCESS") return res.status(502).json({ success: false, error: "Validated market data unavailable.", quantData });
        const sentimentData = await getSentiment(symbol);
        return res.json({ success: true, researchQuality: buildResearchQuality(symbol, quantData, sentimentData) });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/api/history", (req, res) => {
    const symbol = normalizeInputSymbol(req.query.symbol);
    if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });
    try { return res.json({ success: true, ...getReports(symbol) }); }
    catch (error) { return res.status(500).json({ success: false, error: error.message }); }
});

app.get("/api/health", (req, res) => res.json({
    success: true,
    server: "running",
    data_engine: "validated-python-yahoo",
    dhan_dependency: false,
    news_lookback_days: 7,
    history_enabled: true,
    research_quality_enabled: true,
    ai: {
        gemini: { enabled: !!geminiKey, model: geminiKey ? geminiModelName : null },
        groq: { enabled: !!groqKey, model: groqKey ? groqModelName : null },
        fallback: "deterministic",
    },
    runtime: { platform: process.platform, node: process.version },
}));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
    console.log("\n==============================================");
    console.log(`🚀 AI TRADING SERVER RUNNING ON ${HOST}:${PORT}`);
    console.log("==============================================");
    console.log("📊 Market Data: validated quant-pipeline.py");
    console.log("📈 Market Provider: Yahoo Finance / Alpha Vantage fallback");
    console.log("📰 News Lookback: 7 days");
    console.log("🔎 Research Quality: relevance + freshness + source diversity");
    console.log("💾 Report History: enabled");
    console.log("🚫 Dhan Dependency: OFF");
    console.log(`🤖 Gemini: ${geminiKey ? `ON (${geminiModelName})` : "OFF"}`);
    console.log(`⚡ Groq: ${groqKey ? `ON (${groqModelName})` : "OFF"}`);
    console.log("==============================================\n");
});

server.on("error", (error) => {
    console.error("❌ Server error:", error.message);
    if (error.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Stop the old server or set PORT in .env.`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
