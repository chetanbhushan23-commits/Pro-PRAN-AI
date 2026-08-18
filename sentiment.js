// sentiment.js
"use strict";
require("dotenv").config();
const axios = require("axios");
const Groq = require("groq-sdk");

// Initialize Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const NEWS_API_KEY = process.env.NEWS_API_KEY;

/**
 * 1. Fetch Latest News from NewsAPI
 */
async function fetchNews(symbol) {
    if (!NEWS_API_KEY) {
        return "News API key missing in .env";
    }

    try {
        // Sirf Indian market ki accurate news lane ke liye query optimize ki hai
        const query = `${symbol} Indian stock`;
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=5&language=en&apiKey=${NEWS_API_KEY}`;
        
        const response = await axios.get(url);
        const articles = response.data.articles;
        
        if (!articles || articles.length === 0) {
            return `No recent news found for ${symbol}.`;
        }

        // Sirf Headlines aur description nikalna taaki Groq par load kam pade
        const newsText = articles.map((a, i) => `${i + 1}. ${a.title} - ${a.description}`).join("\n");
        return newsText;

    } catch (error) {
        console.error("News API Error:", error.response ? error.response.data : error.message);
        return "Error fetching news.";
    }
}

/**
 * 2. Analyze Sentiment with Groq
 */
async function analyzeSentiment(symbol) {
    console.log(`📰 Fetching latest news for ${symbol}...`);
    const newsData = await fetchNews(symbol);

    if (newsData.includes("No recent news") || newsData.includes("Error")) {
        return { sentiment: "Neutral", score: 5, summary: "No major news available." };
    }

    console.log(`🧠 Groq is analyzing the news sentiment...`);
    
    // Groq System Prompt
    const prompt = `
    You are an expert Indian Stock Market Sentiment Analyzer. 
    Analyze the following recent news headlines for the stock '${symbol}':
    
    ${newsData}
    
    Return ONLY a valid JSON object in this exact format, nothing else:
    {
        "sentiment": "Positive" | "Negative" | "Neutral",
        "score": <number from 1 to 10>,
        "summary": "<1 short sentence summarizing the overall mood>"
    }`;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "openai/gpt-oss-20b", // Fast & accurate model
            temperature: 0.1, // Low temperature for factual JSON output
        });

        const outputStr = chatCompletion.choices[0]?.message?.content || "{}";
        
        // Extract JSON safely using Regex
        const jsonMatch = outputStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        } else {
            return { sentiment: "Neutral", score: 5, summary: "Failed to parse sentiment." };
        }

    } catch (error) {
        console.error("Groq Error:", error.message);
        return { sentiment: "Neutral", score: 5, summary: "Groq analysis failed." };
    }
}

// Terminal Testing ke liye
if (require.main === module) {
    const stock = process.argv[2] || "ETERNAL";
    analyzeSentiment(stock).then(result => {
        console.log("\n✅ FINAL SENTIMENT JSON:");
        console.log(JSON.stringify(result, null, 2));
    });
}

module.exports = { analyzeSentiment };