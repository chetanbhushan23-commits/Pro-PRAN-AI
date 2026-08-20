// final-engine.js
"use strict";
require("dotenv").config();
const { exec } = require("child_process");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { analyzeSentiment } = require("./sentiment.js");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

function getQuantData(symbol) {
    return new Promise((resolve) => {
        // Symbol is restricted to NSE-style alphanumeric tickers to avoid shell injection.
        const safeSymbol = String(symbol).replace(/[^A-Za-z0-9._-]/g, "");
        exec(`python quant-pipeline.py ${safeSymbol}`, { timeout: 60000 }, (error, stdout) => {
            if (error) return resolve({ status: "FAILED", error: error.message });
            try {
                resolve(JSON.parse(stdout.trim()));
            } catch (e) {
                resolve({ status: "FAILED", error: "Invalid JSON from Python." });
            }
        });
    });
}

function formatSources(quantData, sentimentData) {
    const sources = [];
    if (quantData?.data_source) sources.push(quantData.data_source);
    if (quantData?.fundamentals?.source) sources.push(quantData.fundamentals.source);
    for (const article of sentimentData?.articles || []) {
        sources.push({
            provider: article.source,
            url: article.url,
            published_at: article.publishedAt,
            title: article.title,
        });
    }
    return sources;
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

    if (!quantData || quantData.status === "FAILED") {
        console.log(`❌ No validated market data available.`);
        console.log(JSON.stringify(quantData, null, 2));
        return;
    }

    const fullContext = {
        symbol: symbol.toUpperCase(),
        quant_data: quantData,
        news_sentiment: sentimentData,
        sources: formatSources(quantData, sentimentData),
    };

    const systemPrompt = `
You are an evidence-first Indian Stock Market Quant Analyst.
Analyze ONLY the supplied JSON for ${symbol}.

NON-NEGOTIABLE DATA RULES:
1. Never invent, estimate, or use your own market knowledge to fill missing data.
2. If a value is null, missing, stale, or unavailable, write N/A.
3. Never claim Dhan is a source. Dhan is removed from this pipeline.
4. Technical indicators are calculated from the supplied validated OHLCV data.
5. News sentiment may use ONLY the supplied verified articles.
6. Every important factual number must identify its source or calculation basis.
7. Do not manufacture OI, FII/DII, sector data, targets, support/resistance, earnings, or news.
8. A BUY/WAIT/SELL conclusion must clearly state which available data supports it and must mention if important inputs are unavailable.

SCORING:
Technical 35%, Fundamental 30%, News/Sentiment 15%, Market/Sector/OI 20%.
If Market/Sector/OI data is unavailable, do NOT assign a fabricated score. Mark that component N/A and state that the overall score is incomplete.
Do not pretend an incomplete score is 100% reliable.

OUTPUT IN SIMPLE HINGLISH:
1. 📊 Data Snapshot — price, trend, RSI, EMA20/50/200, MACD, volume, PE, ROE, debt/equity where available.
2. 📰 Verified News — publisher, date, headline, sentiment, and source URL for relevant supplied articles.
3. 📐 Technical View — explain only calculated indicators.
4. 🧾 Fundamental View — explain only supplied fundamental values.
5. ⚖️ Score — show component scores and mark unavailable components N/A.
6. 🎯 Final Decision — 🟢 BUY / 🟡 WAIT / 🔴 SELL only when justified by available evidence; otherwise 🟡 WAIT with an explicit data limitation.
7. 🔎 SOURCES — list every source URL supplied in the JSON.

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
