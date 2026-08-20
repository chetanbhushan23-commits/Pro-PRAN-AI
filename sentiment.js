// sentiment.js
"use strict";
require("dotenv").config();
const axios = require("axios");
const Groq = require("groq-sdk");

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const LOOKBACK_DAYS = 7;

const COMPANY_ALIASES = {
    HDFCBANK: ["HDFC Bank", "HDFC Bank Ltd"],
    MCX: ["MCX", "Multi Commodity Exchange", "Multi Commodity Exchange of India"],
    RELIANCE: ["Reliance Industries", "Reliance Industries Ltd"],
    INFY: ["Infosys", "Infosys Ltd"],
    TCS: ["TCS", "Tata Consultancy Services"],
};

function getSearchTerms(symbol) {
    const clean = String(symbol || "").trim().toUpperCase().replace(/\.(NS|BO)$/i, "");
    return COMPANY_ALIASES[clean] || [clean];
}

function cutoffDate() {
    return Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
}

function isRecent(article) {
    if (!article.publishedAt) return true;
    const ts = Date.parse(article.publishedAt);
    return Number.isNaN(ts) || ts >= cutoffDate();
}

async function fetchNews(symbol) {
    if (!NEWS_API_KEY) return { articles: [], error: "NEWS_API_KEY missing in .env" };
    try {
        const terms = getSearchTerms(symbol);
        const query = `(${terms.map(t => `"${t}"`).join(" OR ")}) AND (stock OR shares OR NSE OR BSE)`;
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&from=${new Date(cutoffDate()).toISOString()}&sortBy=publishedAt&pageSize=12&language=en&apiKey=${NEWS_API_KEY}`;
        const response = await axios.get(url, { timeout: 15000 });
        const articles = (response.data.articles || []).filter(a => a.title && a.url).map(a => ({
            title: a.title,
            description: a.description || "",
            source: a.source?.name || "Unknown publisher",
            publishedAt: a.publishedAt || null,
            url: a.url,
            provider: "NewsAPI",
            retrievedAt: new Date().toISOString(),
        })).filter(isRecent);
        return { articles };
    } catch (error) {
        console.error("News API Error:", error.response ? error.response.data : error.message);
        return { articles: [], error: error.message };
    }
}

// Google News RSS: no API key required. Used as the broad company/stock discovery layer.
async function fetchGoogleNews(symbol) {
    try {
        const terms = getSearchTerms(symbol);
        const query = `(${terms.map(t => `"${t}"`).join(" OR ")}) stock India after:${new Date(cutoffDate()).toISOString().slice(0, 10)}`;
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
        const response = await axios.get(url, {
            timeout: 15000,
            headers: { "User-Agent": "Pro-PRAN-AI/2.0" },
            responseType: "text",
        });
        const xml = String(response.data || "");
        const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => {
            const block = match[1];
            const read = tag => {
                const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
                return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
            };
            return {
                title: read("title"),
                description: "",
                source: read("source") || "Google News",
                publishedAt: read("pubDate") || null,
                url: read("link"),
                provider: "Google News RSS",
                retrievedAt: new Date().toISOString(),
            };
        }).filter(a => a.title && a.url && isRecent(a)).slice(0, 15);
        return { articles: items };
    } catch (error) {
        console.error("Google News Error:", error.message);
        return { articles: [], error: error.message };
    }
}

function dedupeArticles(articles) {
    const seen = new Set();
    return articles.filter(article => {
        const normalized = String(article.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
    });
}

async function analyzeSentiment(symbol) {
    console.log(`📰 Fetching ${LOOKBACK_DAYS}-day verified news for ${symbol}...`);
    const [newsApiResult, googleNewsResult] = await Promise.all([fetchNews(symbol), fetchGoogleNews(symbol)]);
    const articles = dedupeArticles([...(newsApiResult.articles || []), ...(googleNewsResult.articles || [])])
        .sort((a, b) => (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0))
        .slice(0, 25);

    const providers = { newsapi: !!NEWS_API_KEY, google_news: true };
    if (!articles.length) {
        return {
            sentiment: "N/A", score: null, summary: "No verified recent news available.", articles: [],
            source_status: "UNAVAILABLE", providers,
            lookback_days: LOOKBACK_DAYS,
            errors: [newsApiResult.error, googleNewsResult.error].filter(Boolean),
        };
    }

    const newsText = articles.map((a, i) =>
        `${i + 1}. ${a.title}\nPublisher: ${a.source}\nProvider: ${a.provider}\nPublished: ${a.publishedAt}\nRetrieved: ${a.retrievedAt}\nURL: ${a.url}\nDescription: ${a.description}`
    ).join("\n\n");

    if (!groq) return {
        sentiment: "N/A", score: null,
        summary: "Verified news collected; sentiment model unavailable because GROQ_API_KEY is missing.",
        articles, source_status: "VERIFIED_ARTICLES", providers, lookback_days: LOOKBACK_DAYS,
    };

    const prompt = `You are an Indian stock-market news sentiment analyst. Analyze ONLY the supplied verified articles for ${symbol}. Do not add outside facts and do not invent events. Prefer the newest and most directly company-related articles. Return ONLY valid JSON: {"sentiment":"Positive"|"Negative"|"Neutral","score":<number 1-10>,"summary":"<one short evidence-based sentence>"}\n\n${newsText}`;
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }], model: "openai/gpt-oss-20b", temperature: 0.1,
        });
        const outputStr = chatCompletion.choices[0]?.message?.content || "{}";
        const jsonMatch = outputStr.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Groq returned invalid JSON");
        const result = JSON.parse(jsonMatch[0]);
        if (!result.sentiment || typeof result.score !== "number") throw new Error("Incomplete sentiment result");
        return { ...result, articles, source_status: "VERIFIED_ARTICLES", providers, lookback_days: LOOKBACK_DAYS };
    } catch (error) {
        console.error("Groq Error:", error.message);
        return { sentiment: "N/A", score: null, summary: "Sentiment could not be calculated from the verified articles.", articles, source_status: "ANALYSIS_FAILED", providers, lookback_days: LOOKBACK_DAYS, error: error.message };
    }
}

if (require.main === module) {
    const stock = process.argv[2] || "MCX";
    analyzeSentiment(stock).then(result => console.log(JSON.stringify(result, null, 2)));
}

module.exports = { analyzeSentiment, fetchNews, fetchGoogleNews };
