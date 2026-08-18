// server.js
"use strict";
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { analyzeSentiment } = require("./sentiment.js");

const app = express();
app.use(cors()); // HTML page ko backend se connect karne deta hai
app.use(express.json());
app.use(express.static(__dirname)); // Yeh aapke HTML ko phone par bhejega

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-pro" });

function getQuantData(symbol) {
    return new Promise((resolve) => {
        exec(`python quant-pipeline.py ${symbol}`, (error, stdout) => {
            if (error) return resolve({ status: "FAILED", error: "Python script failed." });
            try {
                resolve(JSON.parse(stdout.trim()));
            } catch (e) {
                resolve({ status: "FAILED", error: "Invalid JSON from Python." });
            }
        });
    });
}

// API Endpoint jahan HTML request bhejega
app.get("/api/analyze", async (req, res) => {
    const symbol = req.query.symbol;
    if (!symbol) return res.status(400).json({ error: "Stock symbol is required" });

    console.log(`\n🚀 UI Request Received for: ${symbol}`);

    try {
        const [quantData, sentimentData] = await Promise.all([
            getQuantData(symbol),
            analyzeSentiment(symbol)
        ]);

        const fullContext = { symbol, quantData, sentimentData };

        const systemPrompt = `
        You are an Elite Indian Stock Market Quant Analyst. 
        Analyze the JSON data for '${symbol}'.
        Apply 35% Technical, 30% Fundamental, 15% Sentiment, 20% Sector weightage.
        Output in MCX Guide style, use emojis and bullet points. 
        End with a clear 🟢 BUY, 🟡 WAIT, or 🔴 SELL.
        Raw Data: ${JSON.stringify(fullContext)}
        `;

        const result = await geminiModel.generateContent(systemPrompt);
        const finalReport = result.response.text();
        
        // HTML ko final report bhej rahe hain
        res.json({ success: true, report: finalReport });
        console.log(`✅ Report Sent to UI successfully!`);

    } catch (error) {
        console.error("API Error:", error.message);
        res.status(500).json({ success: false, error: "AI Engine failed to generate report." });
    }
});

// Server start karna
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n======================================`);
    console.log(`🌐 AI TRADING SERVER RUNNING ON PORT ${PORT}`);
    console.log(`======================================\n`);
});