// server.js
"use strict";
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { analyzeSentiment } = require("./sentiment.js");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

function getQuantData(symbol) {
    return new Promise((resolve) => {
        const safeSymbol = String(symbol || "")
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9._-]/g, "");

        if (!safeSymbol) {
            return resolve({ status: "FAILED", error: "Invalid stock symbol." });
        }

        const pythonCommand = process.platform === "win32" ? "python" : "python3";

        execFile(
            pythonCommand,
            ["quant-pipeline.py", safeSymbol],
            { timeout: 60000, maxBuffer: 5 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    return resolve({
                        status: "FAILED",
                        error: "Validated quant pipeline failed.",
                        details: error.message,
                        stderr: stderr || null,
                    });
                }

                try {
                    const parsed = JSON.parse(stdout.trim());
                    resolve(parsed);
                } catch (e) {
                    resolve({
                        status: "FAILED",
                        error: "Quant pipeline returned invalid JSON.",
                        raw_output: stdout || null,
                        stderr: stderr || null,
                    });
                }
            }
        );
    });
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
        ema_stack: bullishStack
            ? "BULLISH: Price > EMA20 > EMA50 > EMA200"
            : bearishStack
                ? "BEARISH: Price < EMA20 < EMA50 < EMA200"
                : "MIXED",
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
        if (article.url) {
            sources.push({
                provider: article.source || article.publisher || "News source",
                url: article.url,
                published_at: article.publishedAt || article.published_at || null,
                title: article.title || null,
            });
        }
    }
    return sources;
}

app.get("/api/analyze", async (req, res) => {
    const symbol = String(req.query.symbol || "").trim().toUpperCase();
    if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });

    console.log(`\n🚀 UI Request Received for: ${symbol}`);

    try {
        const [quantData, sentimentData] = await Promise.all([
            getQuantData(symbol),
            analyzeSentiment(symbol),
        ]);

        // Never let Gemini create a report from failed/unverified market data.
        if (!quantData || quantData.status !== "SUCCESS") {
            console.error("❌ Validated quant data unavailable:", quantData);
            return res.status(502).json({
                success: false,
                error: "Validated market data unavailable. Report generation stopped.",
                quantData,
            });
        }

        const verifiedTechnicalFacts = buildVerifiedTechnicalFacts(quantData);
        const deterministicScore = buildDeterministicScore(quantData, sentimentData);
        const sources = collectSources(quantData, sentimentData);

        const fullContext = {
            symbol,
            quantData,
            verifiedTechnicalFacts,
            deterministicScore,
            sentimentData,
            sources,
        };

        const systemPrompt = `
You are an evidence-first Indian Stock Market Quant Analyst.
Analyze ONLY the supplied JSON for ${symbol}.

CRITICAL DATA RULES:
1. quantData.status is SUCCESS and is the authoritative market-data result for this run.
2. Never say the Python/quant feed failed when quantData.status is SUCCESS.
3. Never invent, estimate, or fill missing values from memory or outside knowledge.
4. Null/unavailable values must be shown as N/A.
5. Never claim Dhan as a source.
6. Never contradict verifiedTechnicalFacts.
7. If Price > EMA20 > EMA50 > EMA200, do NOT call the stock bearish, a correction, or below moving averages.
8. If Price < EMA20 < EMA50 < EMA200, do NOT call the stock bullish or above moving averages.
9. Do not manufacture 52-week claims, OI/F&O data, FII/DII, sector data, support/resistance, targets, market share, earnings, macro events, or regulatory events unless explicitly supplied in JSON.
10. ROE/ROCE null means N/A. Do not substitute remembered values.
11. News claims may use ONLY supplied sentimentData articles. Each article must retain its supplied URL.
12. Every important factual number must identify its source or say it is calculated from Yahoo Finance OHLCV.
13. Do not create a complete 100% score when Market/Sector/OI is N/A. Clearly mark missing components.

OUTPUT:
1. 📊 Data Snapshot
2. 📰 Verified News — publisher/date/headline/sentiment + Open Source URL
3. 📐 Technical Analysis — exact supplied indicators and verified interpretation
4. 🧾 Fundamental Analysis — supplied values only
5. ⚖️ Quant Score — show component scores and N/A where unavailable
6. 🎯 Final Recommendation — BUY / WAIT / SELL only from supplied evidence
7. 🔎 Sources — list every supplied source URL and what it supports

Use simple Hinglish and professional trader style. Do not add facts that are not in RAW VERIFIED DATA.

RAW VERIFIED DATA:
${JSON.stringify(fullContext, null, 2)}
`;

        const result = await geminiModel.generateContent(systemPrompt);
        const finalReport = result.response.text();

        res.json({
            success: true,
            report: finalReport,
            data: {
                quantData,
                verifiedTechnicalFacts,
                deterministicScore,
                sources,
            },
        });

        console.log(`✅ Verified source-backed report sent for ${symbol}`);
    } catch (error) {
        console.error("API Error:", error.message);
        res.status(500).json({ success: false, error: "AI Engine failed to generate report." });
    }
});

app.get("/api/health", (req, res) => {
    res.json({ success: true, server: "running", data_engine: "validated-python-yahoo", dhan_dependency: false });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n======================================`);
    console.log(`🌐 AI TRADING SERVER RUNNING ON PORT ${PORT}`);
    console.log(`📊 Data engine: validated quant-pipeline.py`);
    console.log(`🚫 Dhan dependency: OFF`);
    console.log(`======================================\n`);
});
