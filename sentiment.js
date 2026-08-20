// sentiment.js
"use strict";
require("dotenv").config();
const axios = require("axios");
const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const NEWS_API_KEY = process.env.NEWS_API_KEY;

async function fetchNews(symbol) {
    if (!NEWS_API_KEY) {
        return { articles: [], error: "NEWS_API_KEY missing in .env" };
    }

    try {
        // Search exact symbol/company phrase rather than a generic market query.
        const query = `"${symbol}" AND (stock OR shares OR NSE OR BSE)`;
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=8&language=en&apiKey=${NEWS_API_KEY}`;
        const response = await axios.get(url, { timeout: 15000 });
        const articles = (response.data.articles || []).filter(a => a.title && a.url).map(a => ({
            title: a.title,
            description: a.description || "",
            source: a.source?.name || "Unknown publisher",
            publishedAt: a.publishedAt || null,
            url: a.url,
        }));
        return { articles };
    } catch (error) {
        console.error("News API Error:", error.response ? error.response.data : error.message);
        return { articles: [], error: error.message };
    }
}

async function analyzeSentiment(symbol) {
    console.log(`📰 Fetching latest verified news for ${symbol}...`);
    const news = await fetchNews(symbol);

    if (!news.articles.length) {
        return {
            sentiment: "N/A",
            score: null,
            summary: "No verified recent news available.",
            articles: [],
            source_status: "UNAVAILABLE",
            error: news.error || null,
        };
    }

    const newsText = news.articles.map((a, i) =>
        `${i + 1}. ${a.title}\nPublisher: ${a.source}\nPublished: ${a.publishedAt}\nURL: ${a.url}\nDescription: ${a.description}`
    ).join("\n\n");

    const prompt = `
You are an Indian stock-market news sentiment analyst.
Analyze ONLY the supplied verified articles for ${symbol}.
Do not add outside facts and do not invent events.

${newsText}

Return ONLY valid JSON:
{
  "sentiment": "Positive" | "Negative" | "Neutral",
  "score": <number 1-10>,
  "summary": "<one short evidence-based sentence>"
}`;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "openai/gpt-oss-20b",
            temperature: 0.1,
        });

        const outputStr = chatCompletion.choices[0]?.message?.content || "{}";
        const jsonMatch = outputStr.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Groq returned invalid JSON");
        const result = JSON.parse(jsonMatch[0]);
        if (!result.sentiment || typeof result.score !== "number") throw new Error("Incomplete sentiment result");

        return {
            ...result,
            articles: news.articles,
            source_status: "VERIFIED_ARTICLES",
        };
    } catch (error) {
        console.error("Groq Error:", error.message);
        return {
            sentiment: "N/A",
            score: null,
            summary: "Sentiment could not be calculated from the verified articles.",
            articles: news.articles,
            source_status: "ANALYSIS_FAILED",
            error: error.message,
        };
    }
}

if (require.main === module) {
    const stock = process.argv[2] || "MCX";
    analyzeSentiment(stock).then(result => console.log(JSON.stringify(result, null, 2)));
}

module.exports = { analyzeSentiment, fetchNews };
