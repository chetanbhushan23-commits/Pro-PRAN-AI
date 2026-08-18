// final-engine.js
"use strict";
require("dotenv").config();
const { exec } = require("child_process");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { analyzeSentiment } = require("./sentiment.js");

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

/**
 * 1. Python se Dhan & Yahoo ka Quant Data Lana
 */
function getQuantData(symbol) {
    return new Promise((resolve) => {
        exec(`python quant-pipeline.py ${symbol}`, (error, stdout, stderr) => {
            if (error) {
                console.error("Python Execution Error:", error.message);
                return resolve({ status: "FAILED", error: "Python script failed." });
            }
            try {
                // Python ka clean JSON output parse karna
                resolve(JSON.parse(stdout.trim()));
            } catch (e) {
                console.error("Failed to parse Python Output:", stdout);
                resolve({ status: "FAILED", error: "Invalid JSON from Python." });
            }
        });
    });
}

/**
 * 2. THE MASTER ENGINE - Sab kuch jodna aur Gemini se decision lena
 */
async function generateFinalReport(symbol) {
    console.log(`\n==============================================`);
    console.log(`🚀 STARTING PRO-QUANT ANALYSIS FOR: ${symbol}`);
    console.log(`==============================================\n`);

    console.log(`⏳ Step 1 & 2: Fetching Dhan Data & Groq News Sentiment (Parallel Execution)...`);
    
    // Time bachane ke liye Python Data aur Groq Sentiment ek sath chalayenge!
    const [quantData, sentimentData] = await Promise.all([
        getQuantData(symbol),
        analyzeSentiment(symbol)
    ]);

    if (!quantData || quantData.status === "FAILED") {
        console.log(`❌ System Error: Dhan/Yahoo se Data fetch nahi ho paya. Error: ${quantData.error}`);
        return;
    }

    console.log(`✅ Data Fetched Successfully!`);
    console.log(`🧠 Step 3: Feeding Data to Gemini Master AI...\n`);

    const fullContext = {
        symbol: symbol,
        quant_data: quantData,
        news_sentiment: sentimentData
    };

    // GEMINI SYSTEM PROMPT WITH STRICT INSTITUTIONAL LOGIC
    const systemPrompt = `
    You are an Elite Indian Stock Market Quant Analyst. 
    Analyze the provided JSON data for the stock '${symbol}'.
    
    APPLY THIS STRICT SCORING ENGINE LOGIC (Out of 100%):
    1. TECHNICAL (35%): Check 'technicals' data (RSI, MACD, EMA_50, Trend). If RSI is >55 and Price > EMA_50, score high.
    2. FUNDAMENTAL (30%): Check 'fundamentals'. Look at PE_ratio, ROE, debt_to_equity. Lower PE and High ROE score high.
    3. NEWS/SENTIMENT (15%): Check 'news_sentiment'. Use the score (out of 10) and the summary provided by Groq.
    4. MARKET/SECTOR & OI (20%): Use your own baseline knowledge of the Indian market condition for this sector to fill this gap.

    OUTPUT FORMAT REQUIREMENTS:
    Give your final output in a highly professional but simple 'MCX Guide' style. Use Hinglish (Hindi written in English alphabet) mixed with professional financial terms. 
    Use bullet points and emojis. Do not output raw JSON, write it as a formatted report.

    Structure:
    1. 📊 Quant Engine Data: (Mention Current Price, Source, RSI, PE Ratio)
    2. 📰 Sentiment Engine: (Briefly summarize the Groq sentiment)
    3. ⚖️ Scoring Breakdown: (Give a rough calculated score out of 100% based on the 35/30/15/20 weightage)
    4. 🎯 Final AI Decision: Must end with either 🟢 BUY, 🟡 WAIT, or 🔴 SELL in large text with a 1-line bold reason.

    RAW DATA FOR ANALYSIS:
    ${JSON.stringify(fullContext)}
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

// Run the engine from terminal
if (require.main === module) {
    const stock = process.argv[2] || "ETERNAL";
    generateFinalReport(stock);
}