// server.js
"use strict";
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { analyzeSentiment } = require("./sentiment.js");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

function runPython(command, args) {
    return new Promise((resolve) => {
        execFile(
            command,
            args,
            {
                cwd: __dirname,
                timeout: 60000,
                maxBuffer: 5 * 1024 * 1024,
                windowsHide: true,
                env: process.env,
            },
            (error, stdout, stderr) => {
                resolve({ error, stdout: stdout || "", stderr: stderr || "", command });
            }
        );
    });
}

function parsePythonJson(stdout) {
    const text = String(stdout || "").trim();
    if (!text) throw new Error("Python returned empty output");

    // Normal case: the pipeline prints exactly one JSON object.
    try {
        return JSON.parse(text);
    } catch (_) {
        // Be tolerant of harmless startup/warning text before the JSON.
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                return JSON.parse(lines[i]);
            } catch (_) {}
        }
        throw new Error(`Python output was not valid JSON: ${text.slice(0, 1000)}`);
    }
}

async function getQuantData(symbol) {
    const safeSymbol = String(symbol || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9._-]/g, "");

    if (!safeSymbol) return { status: "FAILED", error: "Invalid stock symbol." };

    // On Windows, `python` is the same runtime the user can verify with:
    // python -c "import numpy,pandas,yfinance,dotenv; print('OK')"
    // PYTHON_EXECUTABLE can override it when a venv/custom Python is required.
    const configuredPython = process.env.PYTHON_EXECUTABLE;
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

        if (!result.error && result.stdout.trim()) {
            try {
                const parsed = parsePythonJson(result.stdout);
                console.log(`📊 Quant pipeline SUCCESS via ${command}: ${safeSymbol}`);
                return parsed;
            } catch (parseError) {
                attempts.push({
                    command,
                    parse_error: parseError.message,
                    stdout: result.stdout.slice(0, 2000),
                });
            }
        }
    }

    console.error("❌ Quant pipeline execution failed:", JSON.stringify(attempts, null, 2));
    return {
        status: "FAILED",
        error: "Validated quant pipeline could not be executed successfully.",
        attempts,
        hint: "Run 'python quant-pipeline.py SYMBOL' in this project folder. If that works, restart this Node server so it inherits the same environment."
    };
}

function buildVerifiedTechnicalFacts(quantData) {
    const t = quantData?.technicals;
    const i = t?.indicators;
    if (!t || !i) return { status: "UNAVAILABLE" };

    const price = t.current_price;
    const ema20 = i.EMA_20;
    const ema50 = i.EMA_50;
    const ema200 = i.EMA_200;
    const bullishStack = [price, ema20, ema50, ema200].every(v => v != null) && price > ema20 && ema20 > ema50 && ema50 > ema200;
    const bearishStack = [price, ema20, ema50, ema200].every(v => v != null) && price < ema20 && ema20 < ema50 && ema50 < ema200;

    return {
        status: "VERIFIED",
        price,
        previous_close: t.previous_close,
        trend: t.trend,
        ema_stack: bullishStack ? "BULLISH: Price > EMA20 > EMA50 > EMA200" : bearishStack ? "BEARISH: Price < EMA20 < EMA50 < EMA200" : "MIXED",
        rsi: i.RSI_14,
        macd_histogram: i.MACD_Histogram,
        volume_ratio: i.Volume_Ratio,
        hard_rule: bullishStack
            ? "Do not describe this verified setup as bearish, correction, or below moving averages."
            : bearishStack
                ? "Do not describe this verified setup as bullish or above moving averages."
                : "Describe the verified setup as mixed only."
    };
}

function buildDeterministicScore(quantData, sentimentData) {
    const i = quantData?.technicals?.indicators;
    const f = quantData?.fundamentals?.values;
    if (!i) return { status: "INCOMPLETE", technical: null, fundamental: null, sentiment: null, market_sector: null };

    let technical = 5;
    if (quantData.technicals.trend === "BULLISH") technical += 2;
    if (i.RSI_14 != null && i.RSI_14 >= 50 && i.RSI_14 < 70) technical += 1;
    if (i.MACD_Histogram != null && i.MACD_Histogram > 0) technical += 1;
    if (i.Volume_Ratio != null && i.Volume_Ratio >= 1.5) technical += 1;
    technical = Math.min(10, technical);

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
        note: "Market/Sector/OI remains N/A unless verified data is supplied."
    };
}

function collectSources(quantData, sentimentData) {
    const sources = [];
    if (quantData?.data_source?.url) sources.push(quantData.data_source);
    if (quantData?.fundamentals?.source?.url) sources.push(quantData.fundamentals.source);
    for (const article of sentimentData?.articles || []) {
        if (article.url) sources.push({ provider: article.source || article.publisher || "News source", url: article.url, published_at: article.publishedAt || article.published_at || null, title: article.title || null });
    }
    return sources;
}

app.get("/api/analyze", async (req, res) => {
    const symbol = String(req.query.symbol || "").trim().toUpperCase();
    if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });

    console.log(`\n🚀 UI Request Received for: ${symbol}`);

    try {
        const [quantData, sentimentData] = await Promise.all([getQuantData(symbol), analyzeSentiment(symbol)]);

        if (!quantData || quantData.status !== "SUCCESS") {
            console.error("❌ Validated quant data unavailable:", JSON.stringify(quantData, null, 2));
            return res.status(502).json({
                success: false,
                error: "Validated market data unavailable. Report generation stopped.",
                quantData,
                debug: "Check the server terminal for the Python executable/dependency error."
            });
        }

        const verifiedTechnicalFacts = buildVerifiedTechnicalFacts(quantData);
        const deterministicScore = buildDeterministicScore(quantData, sentimentData);
        const sources = collectSources(quantData, sentimentData);
        const fullContext = { symbol, quantData, verifiedTechnicalFacts, deterministicScore, sentimentData, sources };

        const systemPrompt = `You are an evidence-first Indian Stock Market Quant Analyst. Analyze ONLY the supplied JSON for ${symbol}.
Rules: quantData.status SUCCESS is authoritative; never invent or estimate; null means N/A; never say the quant feed failed when SUCCESS; never claim Dhan; never contradict verifiedTechnicalFacts; never manufacture 52-week, OI/F&O, FII/DII, sector, support/resistance, targets, market-share, earnings, macro or regulatory claims unless supplied; news claims only from supplied articles; every important number must have its source or say calculated from Yahoo Finance OHLCV; do not create a complete score when components are unavailable.
Output: Data Snapshot, Verified News with Open Source URL, Technical Analysis with exact indicators, Fundamental Analysis, Quant Score with N/A missing components, Final Recommendation (BUY/WAIT/SELL), and Sources. Use simple Hinglish and professional trader style.
RAW VERIFIED DATA:\n${JSON.stringify(fullContext, null, 2)}`;

        const result = await geminiModel.generateContent(systemPrompt);
        const finalReport = result.response.text();

        res.json({ success: true, report: finalReport, data: { quantData, verifiedTechnicalFacts, deterministicScore, sources } });
        console.log(`✅ Verified source-backed report sent for ${symbol}`);
    } catch (error) {
        console.error("API Error:", error.message);
        res.status(500).json({ success: false, error: "AI Engine failed to generate report." });
    }
});

app.get("/api/health", (req, res) => res.json({ success: true, server: "running", data_engine: "validated-python-yahoo", dhan_dependency: false }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n======================================`);
    console.log(`🌐 AI TRADING SERVER RUNNING ON PORT ${PORT}`);
    console.log(`📊 Data engine: validated quant-pipeline.py`);
    console.log(`🚫 Dhan dependency: OFF`);
    console.log(`======================================\n`);
});
