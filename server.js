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

function runPython(command, args) {
    return new Promise(resolve => execFile(command, args, {
        cwd: __dirname,
        timeout: Number(process.env.PYTHON_TIMEOUT_MS || 60000),
        maxBuffer: 5 * 1024 * 1024,
        windowsHide: true,
        env: process.env
    }, (error, stdout, stderr) => resolve({ error, stdout: stdout || "", stderr: stderr || "", command })));
}

function parsePythonJson(stdout) {
    const text = String(stdout || "").trim();
    if (!text) throw new Error("Python returned empty output");
    try { return JSON.parse(text); } catch (_) {
        for (const line of text.split(/\r?\n/).map(x => x.trim()).filter(Boolean).reverse()) {
            try { return JSON.parse(line); } catch (_) {}
        }
        throw new Error(`Python output was not valid JSON: ${text.slice(0, 1000)}`);
    }
}

function normalizeInputSymbol(symbol) {
    return String(symbol || "").trim().toUpperCase()
        .replace(/\.NSE$/i, "").replace(/\.NS$/i, "")
        .replace(/\.BSE$/i, "").replace(/\.BO$/i, "")
        .replace(/[^A-Z0-9]/g, "");
}

async function getQuantData(symbol) {
    const safeSymbol = normalizeInputSymbol(symbol);
    if (!safeSymbol) return { status: "FAILED", error: "Invalid stock symbol." };
    const configuredPython = process.env.PYTHON_EXECUTABLE?.trim();
    const commands = configuredPython ? [configuredPython] : process.platform === "win32" ? ["python.exe", "py.exe", "python3.exe"] : ["python3", "python"];
    const pipelinePath = path.join(__dirname, "quant-pipeline.py");
    const attempts = [];
    for (const command of commands) {
        const result = await runPython(command, [pipelinePath, safeSymbol]);
        attempts.push({ command, exit_error: result.error ? result.error.message : null, stderr: result.stderr?.slice(0, 2000) || null });
        if (result.error || !result.stdout.trim()) continue;
        try {
            const parsed = parsePythonJson(result.stdout);
            if (parsed?.status === "SUCCESS") return parsed;
            attempts.push({ command, pipeline_status: parsed?.status || "UNKNOWN", pipeline_error: parsed?.error || null });
        } catch (error) { attempts.push({ command, parse_error: error.message, stdout: result.stdout.slice(0, 2000) }); }
    }
    console.error("❌ Quant pipeline failed:", JSON.stringify(attempts));
    return { status: "FAILED", error: "Validated quant pipeline could not be executed successfully.", attempts, hint: "Run: python quant-pipeline.py INFY" };
}

function buildVerifiedTechnicalFacts(q) {
    const t = q?.technicals, i = t?.indicators;
    if (!t || !i) return { status: "UNAVAILABLE" };
    const price = t.current_price, e20 = i.EMA_20, e50 = i.EMA_50, e200 = i.EMA_200;
    const bull = [price, e20, e50, e200].every(v => v != null) && price > e20 && e20 > e50 && e50 > e200;
    const bear = [price, e20, e50, e200].every(v => v != null) && price < e20 && e20 < e50 && e50 < e200;
    return { status: "VERIFIED", price, previous_close: t.previous_close, trend: t.trend, ema_stack: bull ? "BULLISH: Price > EMA20 > EMA50 > EMA200" : bear ? "BEARISH: Price < EMA20 < EMA50 < EMA200" : "MIXED", rsi: i.RSI_14, macd_histogram: i.MACD_Histogram, volume_ratio: i.Volume_Ratio, hard_rule: bull ? "Do not describe this setup as bearish or below moving averages." : bear ? "Do not describe this setup as bullish or above moving averages." : "Describe the verified setup as mixed only." };
}

function buildDeterministicScore(q, sentiment) {
    const i = q?.technicals?.indicators, f = q?.fundamentals?.values;
    if (!i) return { status: "INCOMPLETE", technical: null, fundamental: null, sentiment: null, market_sector: null };
    let technical = 5;
    if (q.technicals.trend === "BULLISH") technical += 2;
    if (q.technicals.trend === "BEARISH") technical -= 2;
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
    return { status: "PARTIAL", technical: Number(technical.toFixed(2)), fundamental: fundamental == null ? null : Number(fundamental.toFixed(2)), sentiment: sentiment?.score ?? null, market_sector: null, note: "Unavailable components remain N/A; no estimates." };
}

function collectSources(q, sentiment) {
    const sources = [];
    if (q?.data_source?.url) sources.push({ ...q.data_source, type: "market_data" });
    if (q?.fundamentals?.source?.url) sources.push({ ...q.fundamentals.source, type: "fundamentals" });
    for (const a of sentiment?.articles || []) if (a.url) sources.push({ type: "news", provider: a.provider || "News source", publisher: a.source || "Unknown publisher", source_tier: a.source_tier || "UNKNOWN", relevance: a.relevance || "UNKNOWN", url: a.url, published_at: a.publishedAt || null, retrieved_at: a.retrievedAt || null, title: a.title || null });
    return sources;
}

function buildFallbackReport(symbol, q, verified, score, sentiment, sources, quality) {
    const i = q?.technicals?.indicators || {}, f = q?.fundamentals?.values || {};
    const rec = score.technical >= 7 ? "BUY" : score.technical <= 3 ? "SELL" : "WAIT";
    const news = (sentiment?.articles || []).slice(0, 15).map((a, n) => `${n + 1}. **${a.title || "Untitled"}** — ${a.source || "Unknown"} | ${a.relevance || "UNKNOWN"} | ${a.publishedAt || "date N/A"}\n   ${a.url}`).join("\n");
    const sourceLines = sources.length ? sources.map((s, n) => `${n + 1}. ${s.provider || s.type} | ${s.publisher || ""} | ${s.relevance || ""} | ${s.url}`).join("\n") : "- No verified source URL available";
    return `# ${symbol} — Verified Quant Research Report\n\n## Executive Summary\n- Recommendation: **${rec}**\n- Evidence status: **${quality?.overall_status || "N/A"}**\n- Data completeness: **${quality?.data_completeness?.completeness_percent ?? "N/A"}%**\n- Technical state: **${q.technicals.trend || "N/A"}**\n- News sentiment: **${sentiment?.sentiment || "N/A"} (${sentiment?.score ?? "N/A"}/10)**\n\n## Data Snapshot\n- Price: ${q.technicals.current_price ?? "N/A"}\n- Previous Close: ${q.technicals.previous_close ?? "N/A"}\n- RSI(14): ${i.RSI_14 ?? "N/A"}\n- EMA20 / EMA50 / EMA200: ${i.EMA_20 ?? "N/A"} / ${i.EMA_50 ?? "N/A"} / ${i.EMA_200 ?? "N/A"}\n- MACD Histogram: ${i.MACD_Histogram ?? "N/A"}\n- ATR(14): ${i.ATR_14 ?? "N/A"}\n- Volume Ratio: ${i.Volume_Ratio ?? "N/A"}\n\n## Technical Analysis\n- Verified EMA structure: ${verified.ema_stack}\n\n## Fundamentals\n- Market Cap: ${f.market_cap ?? "N/A"}\n- PE: ${f.PE_ratio ?? "N/A"}\n- PB: ${f.PB_ratio ?? "N/A"}\n- ROE: ${f.ROE ?? "N/A"}\n- Debt/Equity: ${f.debt_to_equity ?? "N/A"}\n\n## Verified News & Sentiment — Last 7 Days\n${sentiment?.summary || "No verified recent news available."}\n\n${news || "No verified articles available."}\n\n## Quant Score\n- Technical: ${score.technical ?? "N/A"}/10\n- Fundamental: ${score.fundamental ?? "N/A"}/10\n- Sentiment: ${score.sentiment ?? "N/A"}/10\n- Market/Sector: N/A\n\n## Final Recommendation\n**${rec}** — based only on verified supplied data. This is not a guarantee of future returns.\n\n## Source Traceability\n${sourceLines}\n`;
}

function buildPrompt(symbol, context) {
    return `You are an evidence-first Indian Stock Market Quant Research Analyst. Analyze ONLY the supplied JSON for ${symbol}. Never invent or estimate facts. null means N/A. Never claim Dhan. Never contradict verifiedTechnicalFacts. Do not manufacture OI/F&O, FII/DII, sector, support/resistance, targets, earnings, macro or regulatory claims unless supplied. News claims ONLY from supplied articles. If sources conflict, report the conflict. Keep source URLs intact. Use simple Hinglish where useful. Produce Executive Summary, Data Snapshot, Technical Analysis, Fundamental Analysis, Business/Market Context only when supplied, Verified News & Sentiment, Positive Drivers, Negative Drivers & Conflicting Signals, Research Quality, Risk Factors, Quant Score, Final Recommendation and Source Traceability.\n\nRAW VERIFIED DATA:\n${JSON.stringify(context, null, 2)}`;
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
    const result = await groq.chat.completions.create({ model: groqModelName, messages: [{ role: "system", content: "You are an evidence-first Indian stock research analyst. Return only the requested report." }, { role: "user", content: prompt }], temperature: 0.1, max_tokens: 12000 });
    const text = result?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Groq returned empty content");
    return text;
}

async function generateAIReport(prompt) {
    const errors = [];
    if (geminiModel) {
        try { console.log(`🤖 Gemini ACTIVE (${geminiModelName})`); return { text: await generateWithGemini(prompt), provider: "GEMINI", model: geminiModelName, errors }; }
        catch (e) { console.error("⚠️ Gemini failed:", e.message); errors.push({ provider: "GEMINI", error: e.message }); }
    }
    if (groq) {
        try { console.log(`⚡ Groq ACTIVE (${groqModelName})`); return { text: await generateWithGroq(prompt), provider: "GROQ", model: groqModelName, errors }; }
        catch (e) { console.error("⚠️ Groq failed:", e.message); errors.push({ provider: "GROQ", error: e.message }); }
    }
    return { text: null, provider: "DETERMINISTIC", model: null, errors };
}

async function getSentiment(symbol) {
    try { return await analyzeSentiment(symbol); }
    catch (e) { return { sentiment: "N/A", score: null, summary: "News sentiment unavailable.", articles: [], source_status: "UNAVAILABLE", error: e.message }; }
}

app.get("/api/analyze", async (req, res) => {
    const symbol = normalizeInputSymbol(req.query.symbol);
    if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });
    try {
        const quantData = await getQuantData(symbol);
        if (!quantData || quantData.status !== "SUCCESS") return res.status(502).json({ success: false, error: "Validated market data unavailable. Report generation stopped.", quantData });
        const sentimentData = await getSentiment(symbol);
        const verifiedTechnicalFacts = buildVerifiedTechnicalFacts(quantData);
        const deterministicScore = buildDeterministicScore(quantData, sentimentData);
        const researchQuality = buildResearchQuality(symbol, quantData, sentimentData);
        const sources = collectSources(quantData, sentimentData);
        const fullContext = { symbol, quantData, verifiedTechnicalFacts, deterministicScore, sentimentData, sources, researchQuality, ai_provider: providerStatus(), traceability: { news_lookback_days: 7, generated_at: new Date().toISOString(), history_retention_days: 7 } };
        const ai = await generateAIReport(buildPrompt(symbol, fullContext));
        const report = ai.text || buildFallbackReport(symbol, quantData, verifiedTechnicalFacts, deterministicScore, sentimentData, sources, researchQuality);
        fullContext.ai_used = ai.provider;
        fullContext.ai_model = ai.model;
        fullContext.ai_errors = ai.errors;
        const history = saveReport(symbol, { report, data: fullContext });
        return res.json({ success: true, report, data: fullContext, history });
    } catch (error) { console.error("API Error:", error); return res.status(500).json({ success: false, error: "AI Engine failed to generate report.", detail: error.message }); }
});

app.get("/api/research-quality", async (req, res) => {
    const symbol = normalizeInputSymbol(req.query.symbol);
    if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });
    try {
        const quantData = await getQuantData(symbol);
        if (!quantData || quantData.status !== "SUCCESS") return res.status(502).json({ success: false, error: "Validated market data unavailable.", quantData });
        const sentimentData = await getSentiment(symbol);
        return res.json({ success: true, researchQuality: buildResearchQuality(symbol, quantData, sentimentData) });
    } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
});

app.get("/api/history", (req, res) => {
    const symbol = normalizeInputSymbol(req.query.symbol);
    if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });
    try { return res.json({ success: true, ...getReports(symbol) }); }
    catch (error) { return res.status(500).json({ success: false, error: error.message }); }
});

app.get("/api/health", (req, res) => res.json({ success: true, server: "running", data_engine: "validated-python-yahoo", dhan_dependency: false, news_lookback_days: 7, history_enabled: true, research_quality_enabled: true, ai: providerStatus(), ready_for_ai: Boolean(geminiModel || groq) }));
app.get("/api/ai-status", (req, res) => res.json({ success: true, ...providerStatus() }));
app.get("/api/ai-test", async (req, res) => { const result = await generateAIReport("Reply with exactly: AI_PROVIDER_TEST_OK"); res.json({ success: Boolean(result.text), provider: result.provider, model: result.model, response: result.text, errors: result.errors, configured: providerStatus() }); });

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const server = app.listen(PORT, HOST, () => {
    const s = providerStatus();
    console.log("\n==============================================");
    console.log(`🚀 AI TRADING SERVER RUNNING ON ${HOST}:${PORT}`);
    console.log("==============================================");
    console.log("📊 Market Data: validated quant-pipeline.py");
    console.log("📈 Market Provider: Yahoo Finance / yfinance");
    console.log("📰 News Lookback: 7 days");
    console.log("🔎 Research Quality: relevance + freshness + source diversity");
    console.log("💾 Report History: enabled");
    console.log("🚫 Dhan Dependency: OFF");
    console.log(`🤖 Gemini: ${s.gemini.configured ? `ON (${s.gemini.model})` : "OFF - GEMINI_API_KEY missing"}`);
    console.log(`⚡ Groq: ${s.groq.configured ? `ON (${s.groq.model})` : "OFF - GROQ_API_KEY missing"}`);
    console.log(`🧠 Active AI: ${s.active_provider}`);
    console.log("==============================================\n");
});
server.on("error", error => console.error("❌ Server error:", error.message));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
