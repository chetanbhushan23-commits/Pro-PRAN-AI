// sentiment.js
"use strict";
require("dotenv").config();
const axios = require("axios");
const Groq = require("groq-sdk");

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const LOOKBACK_DAYS = 7;

const COMPANY_ALIASES = { HDFCBANK: ["HDFC Bank", "HDFC Bank Ltd"], MCX: ["MCX", "Multi Commodity Exchange", "Multi Commodity Exchange of India"], RELIANCE: ["Reliance Industries", "Reliance Industries Ltd"], INFY: ["Infosys", "Infosys Ltd"], TCS: ["TCS", "Tata Consultancy Services"] };
const HIGH_QUALITY_SOURCES = new Set(["Reuters", "Business Standard", "BusinessLine", "The Economic Times", "Economic Times", "CNBC-TV18", "CNBC TV18", "Moneycontrol", "Mint", "Livemint", "Financial Express", "Business Today", "NDTV Profit", "The Hindu BusinessLine", "The Hindu"]);

function getSearchTerms(symbol) { const clean = String(symbol || "").trim().toUpperCase().replace(/\.(NS|BO)$/i, ""); return COMPANY_ALIASES[clean] || [clean]; }
function cutoffDate() { return Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000; }
function isRecent(article) { if (!article.publishedAt) return true; const ts = Date.parse(article.publishedAt); return Number.isNaN(ts) || ts >= cutoffDate(); }
function classifyArticle(article, symbol) {
    const terms = getSearchTerms(symbol).map(x => x.toLowerCase());
    const text = `${article.title || ""} ${article.description || ""}`.toLowerCase();
    const direct = terms.some(term => text.includes(term));
    const publisher = String(article.source || "").trim();
    const sourceTier = HIGH_QUALITY_SOURCES.has(publisher) ? "TIER_1" : article.provider === "Google News RSS" ? "DISCOVERY" : "OTHER";
    return { ...article, relevance: direct ? "DIRECT_COMPANY" : "MARKET_CONTEXT", source_tier: sourceTier };
}

async function fetchNews(symbol) {
    if (!NEWS_API_KEY) return { articles: [], error: "NEWS_API_KEY missing in .env" };
    try {
        const terms = getSearchTerms(symbol);
        const query = `(${terms.map(t => `"${t}"`).join(" OR ")}) AND (stock OR shares OR NSE OR BSE)`;
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&from=${new Date(cutoffDate()).toISOString()}&sortBy=publishedAt&pageSize=15&language=en&apiKey=${NEWS_API_KEY}`;
        const response = await axios.get(url, { timeout: 15000 });
        const articles = (response.data.articles || []).filter(a => a.title && a.url).map(a => ({ title: a.title, description: a.description || "", source: a.source?.name || "Unknown publisher", publishedAt: a.publishedAt || null, url: a.url, provider: "NewsAPI", retrievedAt: new Date().toISOString() })).filter(isRecent).map(a => classifyArticle(a, symbol));
        return { articles };
    } catch (error) { return { articles: [], error: error.message }; }
}

async function fetchGoogleNews(symbol) {
    try {
        const terms = getSearchTerms(symbol);
        const query = `(${terms.map(t => `"${t}"`).join(" OR ")}) stock India after:${new Date(cutoffDate()).toISOString().slice(0, 10)}`;
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
        const response = await axios.get(url, { timeout: 15000, headers: { "User-Agent": "Pro-PRAN-AI/3.0" }, responseType: "text" });
        const xml = String(response.data || "");
        const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => {
            const block = match[1];
            const read = tag => { const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i")); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : ""; };
            return { title: read("title"), description: "", source: read("source") || "Google News", publishedAt: read("pubDate") || null, url: read("link"), provider: "Google News RSS", retrievedAt: new Date().toISOString() };
        }).filter(a => a.title && a.url && isRecent(a)).map(a => classifyArticle(a, symbol)).slice(0, 20);
        return { articles: items };
    } catch (error) { return { articles: [], error: error.message }; }
}

function dedupeArticles(articles) {
    const seen = new Set();
    return articles.filter(article => {
        const normalized = String(article.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized); return true;
    });
}

function buildNewsTraceability(articles, symbol) {
    const direct = articles.filter(a => a.relevance === "DIRECT_COMPANY");
    const context = articles.filter(a => a.relevance === "MARKET_CONTEXT");
    const tier1 = articles.filter(a => a.source_tier === "TIER_1");
    const dates = articles.map(a => Date.parse(a.publishedAt || "")).filter(Number.isFinite);
    return { symbol, lookback_days: LOOKBACK_DAYS, total_articles: articles.length, direct_company_articles: direct.length, market_context_articles: context.length, tier1_articles: tier1.length, google_news_articles: articles.filter(a => a.provider === "Google News RSS").length, newsapi_articles: articles.filter(a => a.provider === "NewsAPI").length, newest_published_at: dates.length ? new Date(Math.max(...dates)).toISOString() : null, oldest_published_at: dates.length ? new Date(Math.min(...dates)).toISOString() : null, source_coverage: [...new Set(articles.map(a => a.source).filter(Boolean))], rule: "Google News is discovery/context; publisher URL and date remain traceability fields." };
}

function lexicalSentiment(articles) {
    const positive = /(upgrade|buy|bullish|surge|rally|gain|gains|strong|growth|record|positive|outperform|target|jump|rise|rises|up)/i;
    const negative = /(downgrade|sell|bearish|fall|falls|drop|decline|weak|risk|warning|cut|loss|negative|slump|crash)/i;
    let pos = 0, neg = 0;
    for (const a of articles) {
        const text = `${a.title || ""} ${a.description || ""}`;
        if (positive.test(text)) pos++;
        if (negative.test(text)) neg++;
    }
    const total = Math.max(1, pos + neg);
    const score = Math.max(1, Math.min(10, 5 + ((pos - neg) / total) * 5));
    const sentiment = score >= 6.5 ? "Positive" : score <= 3.5 ? "Negative" : "Neutral";
    return { sentiment, score: Number(score.toFixed(1)), summary: `Deterministic headline fallback: ${pos} positive-signal and ${neg} negative-signal articles.`, positive_drivers: [], negative_drivers: [], conflicting_signals: [] };
}

async function analyzeSentiment(symbol) {
    console.log(`📰 Fetching ${LOOKBACK_DAYS}-day verified news for ${symbol}...`);
    const [newsApiResult, googleNewsResult] = await Promise.all([fetchNews(symbol), fetchGoogleNews(symbol)]);
    const articles = dedupeArticles([...(newsApiResult.articles || []), ...(googleNewsResult.articles || [])])
        .sort((a, b) => (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0))
        .slice(0, 30);
    const traceability = buildNewsTraceability(articles, symbol);
    const providers = { newsapi: !!NEWS_API_KEY, google_news: true, groq: !!groq, groq_model: GROQ_MODEL };
    if (!articles.length) return { sentiment: "N/A", score: null, summary: "No verified recent news available.", articles: [], source_status: "UNAVAILABLE", providers, lookback_days: LOOKBACK_DAYS, traceability, errors: [newsApiResult.error, googleNewsResult.error].filter(Boolean) };
    if (!groq) {
        const fallback = lexicalSentiment(articles);
        return { ...fallback, articles, source_status: "DETERMINISTIC_FALLBACK", providers, lookback_days: LOOKBACK_DAYS, traceability };
    }

    // Prevent 413 token overflow: rank and send only the strongest 10 articles.
    const ranked = [...articles].sort((a, b) => {
        const score = a => (a.relevance === "DIRECT_COMPANY" ? 3 : 0) + (a.source_tier === "TIER_1" ? 3 : 0) + (a.provider === "Google News RSS" ? 0 : 1);
        return score(b) - score(a);
    }).slice(0, 10);
    const newsText = ranked.map((a, i) => `${i + 1}. ${a.title}\nPublisher: ${a.source}\nRelevance: ${a.relevance}\nTier: ${a.source_tier}\nPublished: ${a.publishedAt}\nDescription: ${String(a.description || "").slice(0, 500)}`).join("\n\n");
    const prompt = `You are an Indian stock-market news sentiment analyst. Analyze ONLY these verified articles for ${symbol}. Weight DIRECT_COMPANY and TIER_1 more heavily. Return ONLY JSON: {"sentiment":"Positive"|"Negative"|"Neutral","score":<number 1-10>,"summary":"<short evidence-based sentence>","positive_drivers":["..."],"negative_drivers":["..."],"conflicting_signals":["..."]}.\n\n${newsText}`;
    try {
        const chatCompletion = await groq.chat.completions.create({ messages: [{ role: "user", content: prompt }], model: GROQ_MODEL, temperature: 0.1, response_format: { type: "json_object" } });
        const outputStr = chatCompletion.choices[0]?.message?.content || "{}";
        const result = JSON.parse(outputStr);
        if (!result.sentiment || typeof result.score !== "number") throw new Error("Incomplete sentiment result");
        return { ...result, articles, source_status: "VERIFIED_ARTICLES", providers, lookback_days: LOOKBACK_DAYS, traceability, analyzed_article_count: ranked.length };
    } catch (error) {
        const fallback = lexicalSentiment(ranked);
        return { ...fallback, articles, source_status: "DETERMINISTIC_FALLBACK", providers, lookback_days: LOOKBACK_DAYS, traceability, analyzed_article_count: ranked.length, fallback_reason: error.message };
    }
}

if (require.main === module) analyzeSentiment(process.argv[2] || "MCX").then(result => console.log(JSON.stringify(result, null, 2)));
module.exports = { analyzeSentiment, fetchNews, fetchGoogleNews };
