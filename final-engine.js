// final-engine.js
"use strict";
require("dotenv").config();
const { execFile } = require("child_process");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { analyzeSentiment } = require("./sentiment.js");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

function getQuantData(symbol) {
    return new Promise((resolve) => {
        const safeSymbol = String(symbol).replace(/[^A-Za-z0-9._-]/g, "");
        execFile("python3", ["quant-pipeline.py", safeSymbol], { timeout: 60000 }, (error, stdout, stderr) => {
            if (error) {
                return resolve({ status: "FAILED", error: error.message, stderr: stderr || null });
            }
            try {
                const parsed = JSON.parse(stdout.trim());
                resolve(parsed);
            } catch (e) {
                resolve({ status: "FAILED", error: "Invalid JSON from Python pipeline.", raw_output: stdout || null });
            }
        });
    });
}

function formatSources(quantData, sentimentData) {
    const sources = [];
    if (quantData?.data_source?.url) sources.push(quantData.data_source);
    if (quantData?.fundamentals?.source?.url) sources.push(quantData.fundamentals.source);
    for (const article of sentimentData?.articles || []) {
        if (article.url) {
            sources.push({
                provider: article.source,
                url: article.url,
                published_at: article.publishedAt,
                title: article.title,
            });
        }
    }
    return sources;
}

function buildHardTechnicalFacts(quantData) {
    const t = quantData?.technicals;
    const i = t?.indicators;
    if (!t || !i) return { status: "UNAVAILABLE" };

    const price = t.current_price;
    const ema20 = i.EMA_20;
    const ema50 = i.EMA_50;
    const ema200 = i.EMA_200;
    const bullishStack = price > ema20 && ema20 > ema50 && ema50 > ema200;
    const bearishStack = price < ema20 && ema20 < ema50 && ema50 < ema200;
    const macdPositive = i.MACD_Histogram != null && i.MACD_Histogram > 0;
    const volumeStrong = i.Volume_Ratio != null && i.Volume_Ratio >= 1.5;

    return {
        status: "VERIFIED",
        price,
        trend: t.trend,
        ema_stack: bullishStack ? "BULLISH: Price > EMA20 > EMA50 > EMA200" : bearishStack ? "BEARISH: Price < EMA20 < EMA50 < EMA200" : "MIXED",
        macd_momentum: macdPositive ? "POSITIVE: MACD histogram > 0" : "NON-POSITIVE",
        volume_confirmation: volumeStrong ? "CONFIRMED: volume ratio >= 1.5x" : "NOT_CONFIRMED",
        rsi: i.RSI_14,
        volume_ratio: i.Volume_Ratio,
        indicators: i,
        hard_rule: bullishStack ? "Do not describe the verified technical setup as bearish/correction/below moving averages." : bearishStack ? "Do not describe the verified technical setup as bullish/above moving averages." : "Describe the setup as mixed only."
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

    const fundamentalAvailable = [f?.PE_ratio, f?.PB_ratio, f?.ROE, f?.debt_to_equity].some(v => v != null);
    let fundamental = null;
    if (fundamentalAvailable) {
        fundamental = 5;
        if (f?.debt_to_equity != null && f.debt_to_equity < 1) fundamental += 1.5;
        if (f?.ROE != null && f.ROE >= 15) fundamental += 1.5;
        if (f?.PE_ratio != null && f.PE_ratio > 0 && f.PE_ratio < 35) fundamental += 1;
        if (f?.PB_ratio != null && f.PB_ratio > 0 && f.PB_ratio < 8) fundamental += 1;
        fundamental = Math.min(10, fundamental);
    }

    const sentiment = sentimentData?.score != null ? sentimentData.score : null;
    return {
        status: "PARTIAL",
        technical: Number(technical.toFixed(2)),
        fundamental: fundamental == null ? null : Number(fundamental.toFixed(2)),
        sentiment,
        market_sector: null,
        note: "Market/Sector/OI is N/A unless verified data is supplied."
    };
}

async function generateFinalReport(symbol) {
    console.log(`\n==============================================`);
    console.log(`🚀 STARTING PRO-QUANT ANALYSIS FOR: ${symbol}`);
    console.log(`==============================================\n`);

    console.log(`⏳ Fetching validated market data + verified news...`);
    const [quantData, sentimentData] = await Promise.all([
        getQuantData(symbol),
        analyzeSentiment(symbol),
    ]);

    if (!quantData || quantData.status !== "SUCCESS") {
        console.log(`❌ No validated market data available. AI report generation stopped.`);
        console.log(JSON.stringify(quantData, null, 2));
        return;
    }

    const hardTechnicalFacts = buildHardTechnicalFacts(quantData);
    const deterministicScore = buildDeterministicScore(quantData, sentimentData);
    const fullContext = {
        symbol: symbol.toUpperCase(),
        quant_data: quantData,
        verified_technical_facts: hardTechnicalFacts,
        deterministic_score: deterministicScore,
        news_sentiment: sentimentData,
        sources: formatSources(quantData, sentimentData),
    };

    const systemPrompt = `
You are an evidence-first Indian Stock Market Quant Analyst.
Analyze ONLY the supplied JSON for ${symbol}.

CRITICAL: The Python quant pipeline has already validated the OHLCV data. Treat quant_data and verified_technical_facts as authoritative for this run. Do not replace them with memory, an old chart, another data source, or an assumed market view.

NON-NEGOTIABLE DATA RULES:
1. Never invent, estimate, or use outside market knowledge to fill missing data.
2. If a value is null, missing, or unavailable, write N/A.
3. Never claim Dhan is a source.
4. Never say the Python feed failed if quant_data.status is SUCCESS.
5. Never say price is below EMA20/EMA50 when the supplied verified values show it is above them.
6. Never describe a verified bullish EMA stack as a bearish correction.
7. News sentiment may use ONLY supplied verified articles.
8. Every important factual number must identify its source or calculation basis.
9. Do not manufacture OI, FII/DII, sector data, targets, support/resistance, earnings, market share, regulatory events, or macro events.
10. If support/resistance is not supplied, write N/A instead of inventing levels.
11. If ROE/ROCE is null, write N/A. Do not substitute a remembered value.
12. If Market/Sector/OI data is unavailable, score it N/A and do not produce a 100%-complete composite score.

TECHNICAL CONSISTENCY:
Use verified_technical_facts exactly. For this run, the hard_rule in that object is mandatory. Do not contradict it.

SCORING:
Show Technical, Fundamental, Sentiment and Market/Sector/OI separately. Use deterministic_score as the baseline and explain that the score is partial when components are N/A. Do not manufacture missing components.

FINAL DECISION:
BUY/WAIT/SELL must be based only on supplied verified evidence. If important inputs are missing, explicitly say so. Do not turn missing data into a bearish or bullish claim.

OUTPUT IN SIMPLE HINGLISH:
1. 📊 Data Snapshot — price, previous close, trend, RSI, EMA20/50/200, MACD, volume, PE, PB, ROE, debt/equity where available.
2. 📰 Verified News — publisher, date, headline, sentiment, and clickable source URL for supplied articles only.
3. 📐 Technical View — calculated indicators only; must match verified_technical_facts.
4. 🧾 Fundamental View — supplied fundamental values only.
5. ⚖️ Score — component scores, with N/A for unavailable components.
6. 🎯 Final Decision — 🟢 BUY / 🟡 WAIT / 🔴 SELL with a short evidence-based reason.
7. 🔎 SOURCES — list every supplied source URL and label what it supports.

RAW VERIFIED DATA:
${JSON.stringify(fullContext, null, 2)}
`;

    try {
        const result = await geminiModel.generateContent(systemPrompt);
        console.log(`==============================================`);
        console.log(`       💎 FINAL AI INTELLIGENCE REPORT        `);
        console.log(`==============================================\n`);
        console.log(result.response.text());
        console.log(`\n==============================================`);
    } catch (error) {
        console.error("❌ Gemini API Error:", error.message);
    }
}

if (require.main === module) {
    const stock = process.argv[2] || "MCX";
    generateFinalReport(stock);
}

module.exports = { generateFinalReport, getQuantData };
