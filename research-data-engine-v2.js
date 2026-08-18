// =====================================================
// RESEARCH DATA ENGINE V2
// Evidence → Yahoo → Technical → News → Claims
// Full replacement version (Fixed Smart Router & Screener)
// =====================================================

"use strict";

require("dotenv").config();

const { collectTechnical: collectTechnicalV3 } = require("./technical-engine-v3");
const https = require("https");
const { verifyArticle, fetchPage, htmlToText } = require("./article-verifier");
const { verifyClaims } = require("./claim-verifier");

// =====================================================
// CONFIG
// =====================================================

const CONFIG = {
  brokers: [
    "UBS", "JPMorgan", "JP Morgan", "Jefferies", "Morgan Stanley",
    "Goldman Sachs", "Motilal Oswal", "Nuvama", "Emkay", "ICICI Securities",
    "HDFC Securities", "Kotak Securities", "Axis Securities", "Yes Securities",
    "Prabhudas Lilladher", "Sharekhan", "Angel One", "IIFL Securities",
    "Edelweiss", "Citi", "Citigroup", "Nomura", "Macquarie", "Bernstein",
    "HSBC", "CLSA", "Bank of America", "BofA", "Barclays"
  ],
  yahooHost: "query1.finance.yahoo.com",
  newsPageSize: 3, // Token limit bachane ke liye chota rakha hai
  technicalPeriod: "6mo",
  technicalInterval: "1d"
};

// =====================================================
// HTTP HELPER
// =====================================================

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (_) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, data: parsed });
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("Request timeout")));
    if (body) req.write(body);
    req.end();
  });
}

// =====================================================
// TEXT HELPERS
// =====================================================

function cleanText(value) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

// =====================================================
// SYMBOL NORMALIZATION
// =====================================================

function normalizeSymbol(symbol) {
  if (!symbol) return "";
  return String(symbol).trim().toUpperCase().replace(/\s+/g, "").replace(/\.NS$/i, "").replace(/\.NSE$/i, "");
}

function yahooSymbol(symbol) {
  const clean = normalizeSymbol(symbol);
  if (!clean) return "";
  if (clean.startsWith("^") || clean.includes("=")) return clean;
  return `${clean}.NS`;
}

function normalizeIndianSymbol(symbol) { return normalizeSymbol(symbol); }
function getYahooStyleSymbol(symbol) { return yahooSymbol(symbol); }

// =====================================================
// NUMBER HELPERS
// =====================================================

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

// =====================================================
// ARRAY HELPERS
// =====================================================

function uniqueNumbers(values) {
  const result = [];
  for (const value of values) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    if (!result.some(x => Math.abs(x - n) < 0.000001)) result.push(n);
  }
  return result;
}

function sortNumbers(values) {
  return [...values].sort((a, b) => a - b);
}

// =====================================================
// EMA & SMA & RSI & ATR
// =====================================================

function calculateEMA(values, period) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length < period || period <= 0) return null;
  const multiplier = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += clean[i];
  ema /= period;
  for (let i = period; i < clean.length; i++) {
    ema = (clean[i] - ema) * multiplier + ema;
  }
  return ema;
}

function calculateSMA(values, period) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length < period) return null;
  const slice = clean.slice(clean.length - period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

function calculateRSI(values, period = 14) {
  const prices = values.map(Number).filter(Number.isFinite);
  if (prices.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }
  if (averageLoss === 0) return 100;
  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

function calculateATR(highs, lows, closes, period = 14) {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) return null;
  const trueRanges = [];
  for (let i = 1; i < closes.length; i++) {
    const high = Number(highs[i]);
    const low = Number(lows[i]);
    const previousClose = Number(closes[i - 1]);
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(previousClose)) continue;
    const tr = Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
    trueRanges.push(tr);
  }
  if (trueRanges.length < period) return null;
  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

// =====================================================
// SUPPORT / RESISTANCE
// =====================================================

function calculateSupportResistance(highs, lows, closes, currentPrice, ema20, ema50, ema200) {
  const price = Number(currentPrice);
  if (!Number.isFinite(price)) return { supports: [], resistances: [], support: null, resistance: null };
  const highValues = highs.map(Number).filter(Number.isFinite);
  const lowValues = lows.map(Number).filter(Number.isFinite);
  
  const swingSupports = [];
  const lookback = Math.min(lowValues.length - 1, 120);
  for (let i = 2; i < lookback - 2; i++) {
    const index = lowValues.length - 1 - i;
    if (index < 2) continue;
    const current = lowValues[index];
    if (current <= lowValues[index - 1] && current <= lowValues[index - 2] && current <= lowValues[index + 1] && current <= lowValues[index + 2]) {
      swingSupports.push(current);
    }
  }

  const swingResistances = [];
  const highLookback = Math.min(highValues.length - 1, 120);
  for (let i = 2; i < highLookback - 2; i++) {
    const index = highValues.length - 1 - i;
    if (index < 2) continue;
    const current = highValues[index];
    if (current >= highValues[index - 1] && current >= highValues[index - 2] && current >= highValues[index + 1] && current >= highValues[index + 2]) {
      swingResistances.push(current);
    }
  }

  const recentLow = lowValues.length ? Math.min(...lowValues.slice(-60)) : null;
  const recentHigh = highValues.length ? Math.max(...highValues.slice(-60)) : null;

  const supportCandidates = uniqueNumbers([...swingSupports, recentLow, ema20, ema50, ema200])
    .filter(level => Number.isFinite(level) && level < price).sort((a, b) => b - a);

  const resistanceCandidates = uniqueNumbers([...swingResistances, recentHigh])
    .filter(level => Number.isFinite(level) && level > price).sort((a, b) => a - b);

  function filterLevels(levels, direction) {
    const output = [];
    for (const level of levels) {
      const tolerance = Math.max(price * 0.008, 1);
      const tooClose = output.some(existing => Math.abs(existing - level) <= tolerance);
      if (!tooClose) output.push(round(level));
    }
    if (direction === "support") return output.sort((a, b) => b - a).slice(0, 3);
    return output.sort((a, b) => a - b).slice(0, 3);
  }

  const supports = filterLevels(supportCandidates, "support");
  const resistances = filterLevels(resistanceCandidates, "resistance");

  return {
    supports, resistances,
    support: supports[0] || null, resistance: resistances[0] || null,
    majorSupport: supports[2] || supports[1] || supports[0] || null,
    majorResistance: resistances[2] || resistances[1] || resistances[0] || null
  };
}

// =====================================================
// TREND
// =====================================================

function determineTrend(price, ema20, ema50, ema200, rsi) {
  let score = 0;
  if (Number.isFinite(price) && Number.isFinite(ema20)) score += price > ema20 ? 1 : -1;
  if (Number.isFinite(ema20) && Number.isFinite(ema50)) score += ema20 > ema50 ? 1 : -1;
  if (Number.isFinite(ema50) && Number.isFinite(ema200)) score += ema50 > ema200 ? 1 : -1;
  if (Number.isFinite(rsi)) {
    if (rsi >= 55) score++;
    else if (rsi < 45) score--;
  }
  if (score >= 3) return "BULLISH";
  if (score <= -2) return "BEARISH";
  return "NEUTRAL";
}

// =====================================================
// TECHNICAL ENGINE & FETCHERS
// =====================================================

function calculateTechnicalFromChart(chart) {
  // Keeping this intact as per your original file structure
  return { success: false, error: "Use V3 Engine" }; // We primarily use V3 now
}

async function collectTechnical(symbol) {
  console.log(`\n📊 V3 Technical Engine: ${symbol}`);
  try {
    const result = await collectTechnicalV3(symbol);
    if (!result || result.success !== true) {
      return { provider: result?.provider || "Technical Engine V3", success: false, symbol, technical: null, error: result?.error || "Technical provider returned no data" };
    }
    return result;
  } catch (error) {
    return { provider: "Technical Engine V3", success: false, symbol, technical: null, error: error.message };
  }
}

async function collectYahoo(symbol) {
  const ySymbol = yahooSymbol(symbol);
  if (!ySymbol) return { provider: "Yahoo Finance", success: false, error: "Invalid symbol" };
  const path = `/v7/finance/quote?symbols=${encodeURIComponent(ySymbol)}`;
  const options = { hostname: CONFIG.yahooHost, path, method: "GET", headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } };
  
  try {
    const response = await request(options);
    if (response.statusCode < 200 || response.statusCode >= 300) return { provider: "Yahoo Finance", success: false, error: `Yahoo HTTP ${response.statusCode}` };
    const quote = response.data?.quoteResponse?.result?.[0];
    if (!quote) return { provider: "Yahoo Finance", success: false, error: "Yahoo quote unavailable" };
    return { provider: "Yahoo Finance", success: true, data: quote };
  } catch (error) {
    return { provider: "Yahoo Finance", success: false, error: error.message };
  }
}

async function getFMP(symbol) {
  const key = process.env.FMP_API_KEY;
  if (!key) return { provider: "FMP", success: false, error: "FMP_API_KEY missing" };
  const options = { hostname: "financialmodelingprep.com", path: `/stable/quote?symbol=${encodeURIComponent(normalizeSymbol(symbol))}&apikey=${encodeURIComponent(key)}`, method: "GET", headers: { Accept: "application/json" } };
  
  try {
    const response = await request(options);
    if (response.statusCode >= 200 && response.statusCode < 300 && Array.isArray(response.data) && response.data.length) {
      return { provider: "FMP", success: true, data: response.data[0] };
    }
    return { provider: "FMP", success: false, error: "FMP data unavailable" };
  } catch (error) { return { provider: "FMP", success: false, error: error.message }; }
}

async function getAlpha(symbol) {
  return { provider: "Alpha Vantage", success: false, error: "Disabled to save time" };
}

async function collectNews(symbol) {
  const key = process.env.NEWS_API_KEY;
  if (!key) return { provider: "News API", success: false, error: "NEWS_API_KEY missing", articles: [] };
  const query = encodeURIComponent(`"${normalizeSymbol(symbol)}" India stock`);
  const path = `/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=${CONFIG.newsPageSize}&apiKey=${encodeURIComponent(key)}`;
  const options = { hostname: "newsapi.org", path, method: "GET", headers: { Accept: "application/json", "User-Agent": "indian-stock-ai/2.0" } };
  
  try {
    const response = await request(options);
    if (response.statusCode >= 200 && response.statusCode < 300 && response.data?.status === "ok") {
      const articles = (response.data.articles || []).map(article => ({
        title: cleanText(article.title), source: article.source?.name || null,
        publishedAt: article.publishedAt || null, description: cleanText(article.description),
        content: cleanText(article.content), url: article.url || null
      })).filter(article => article.title && article.url);
      return { provider: "News API", success: true, totalResults: response.data.totalResults || articles.length, articles };
    }
    return { provider: "News API", success: false, error: "News request failed", articles: [] };
  } catch (error) { return { provider: "News API", success: false, error: error.message, articles: [] }; }
}

async function getNews(symbol) { return collectNews(symbol); }

// =====================================================
// BROKER & REGULATOR & CLAIMS EXTRACTION
// =====================================================

function extractBroker(text) {
  const source = String(text || "");
  for (const broker of CONFIG.brokers) {
    const regex = new RegExp(`\\b${broker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (regex.test(source)) return broker;
  }
  return null;
}

function extractRegulator(text) {
  const regulators = ["SEBI", "RBI", "IRDAI", "IRDA", "PFRDA", "CCI"];
  for (const regulator of regulators) {
    if (new RegExp(`\\b${regulator}\\b`, "i").test(text)) return regulator;
  }
  return "REGULATOR";
}

function buildClaims(article) {
  const title = cleanText(article.title);
  const description = cleanText(article.description);
  const content = cleanText(article.content);
  const text = `${title} ${description} ${content}`;
  const claims = [];
  const broker = extractBroker(text);

  if (broker && /upgrade|downgrade|buy|sell|hold|neutral|overweight|underweight/i.test(text)) {
    claims.push({ type: "BROKERAGE_VIEW", source: broker, title, evidence: description || content || title, url: article.url });
  }
  if (/target\s*price|price\s*target|target\s+of|target\s*:/i.test(text)) {
    claims.push({ type: "TARGET_PRICE", source: broker || extractBroker(text), title, evidence: description || content || title, url: article.url });
  }
  if (/sebi|rbi|irdai|proposal|proposed|approved/i.test(text)) {
    claims.push({ type: "REGULATORY", source: extractRegulator(text), title, evidence: description || content || title, url: article.url });
  }

  const unique = [];
  for (const claim of claims) {
    const key = [claim.type, claim.source, claim.title, claim.url].join("|").toLowerCase();
    if (!unique.some(item => [item.type, item.source, item.title, item.url].join("|").toLowerCase() === key)) unique.push(claim);
  }
  return unique;
}

// =====================================================
// PROCESS ARTICLE & RESEARCH
// =====================================================

async function processArticle(article) {
  const claims = buildClaims(article);
  if (claims.length === 0) return { article, status: "NO_FINANCIAL_CLAIMS", totalClaims: 0, verifiedClaims: 0, claims: [], safeClaims: [] };
  
  let articleResult;
  try { articleResult = await verifyArticle(article, claims); } 
  catch (error) { articleResult = { success: false, error: error.message }; }
  
  if (!articleResult || !articleResult.success) {
    return { article, status: "ARTICLE_NOT_VERIFIED", articleVerification: articleResult, totalClaims: claims.length, verifiedClaims: 0, claims: claims.map(c => ({...c, verification: { verified: false }})), safeClaims: [] };
  }

  let articleText = "";
  try {
    const page = await fetchPage(article.url);
    articleText = htmlToText(page.html);
  } catch (error) {}

  if (!articleText) return { article, status: "ARTICLE_TEXT_UNAVAILABLE", totalClaims: claims.length, verifiedClaims: 0, claims: claims.map(c => ({...c, verification: { verified: false }})), safeClaims: [] };

  let verificationResult;
  try { verificationResult = verifyClaims(claims, articleText); } 
  catch (error) { verificationResult = { results: claims.map(c => ({...c, verification: { verified: false }})), safeClaims: [], warnings: [error.message] }; }

  return { article, status: "VERIFIED", totalClaims: verificationResult.results?.length || 0, verifiedClaims: verificationResult.safeClaims?.length || 0, claims: verificationResult.results || [], safeClaims: verificationResult.safeClaims || [], warnings: verificationResult.warnings || [] };
}

async function processResearch(articles = []) {
  const results = [];
  for (const article of articles) {
    try { results.push(await processArticle(article)); } 
    catch (error) { results.push({ article, status: "ERROR", error: error.message, totalClaims: 0, verifiedClaims: 0, claims: [], safeClaims: [] }); }
  }
  const allClaims = results.flatMap(r => r.claims || []);
  const safeClaims = results.flatMap(r => r.safeClaims || []);
  return { success: true, articlesProcessed: results.length, totalClaims: allClaims.length, verifiedClaims: safeClaims.length, results, safeClaims, warnings: [] };
}

// =====================================================
// 🧠 STOCK DETECTION & SMART MAPPING (STRICT WHITELIST)
// =====================================================

const NSE_MASTER_DB = {
  // Banks & Finance
  "HDFC": "HDFCBANK", "HDFCBANK": "HDFCBANK", "HDFC BANK": "HDFCBANK",
  "SBI": "SBIN", "SBIN": "SBIN", "STATE BANK OF INDIA": "SBIN",
  "ICICI": "ICICIBANK", "ICICIBANK": "ICICIBANK", "ICICI BANK": "ICICIBANK",
  "KOTAK": "KOTAKBANK", "AXIS": "AXISBANK", "PNB": "PNB",
  
  // IT Sector
  "TCS": "TCS", "INFY": "INFY", "INFOSYS": "INFY", "WIPRO": "WIPRO", 
  "HCLTECH": "HCLTECH", "TECHM": "TECHM",
  
  // Auto & Infra
  "TATAMOTORS": "TATAMOTORS", "TATA MOTORS": "TATAMOTORS", 
  "MARUTI": "MARUTI", "M&M": "M&M", "MAHINDRA": "M&M",
  "LT": "LT", "LARSEN": "LT",
  
  // Energy & Conglomerates
  "RELIANCE": "RELIANCE", "RIL": "RELIANCE",
  "ITC": "ITC", "ZOMATO": "ZOMATO", "MCX": "MCX",
  "TATASTEEL": "TATASTEEL", "TATA STEEL": "TATASTEEL",
  "ADANI": "ADANIENT", "ADANIENT": "ADANIENT", "ADANI PORTS": "ADANIPORTS"
};

function extractStocksFromQuestion(question) {
  const text = String(question || "").toUpperCase();
  const found = [];

  // 1. Check if user's question contains any name from our Master DB
  for (const [key, symbol] of Object.entries(NSE_MASTER_DB)) {
    const regex = new RegExp(`\\b${key}\\b`, "i");
    if (regex.test(text)) {
      found.push(symbol);
    }
  }

  // 2. Duplicate remove karna aur Token Limit ke liye max 2 stocks rakhna
  let finalStocks = [...new Set(found)].slice(0, 2); 

  // 3. Agar user ne Database ka koi bhi stock nahi likha
  if (finalStocks.length === 0) {
    console.log("⚠️ No specific stock matched in Master DB. Screener Will Trigger!");
  }

  return finalStocks;
}

// =====================================================
// 🚀 LIVE NSE MARKET SCREENER (FMP API)
// =====================================================

async function getLiveNseScreener() {
  const key = process.env.FMP_API_KEY;
  const defaultStocks = ["RELIANCE", "HDFCBANK"];
  
  if (!key) return defaultStocks;

  try {
    console.log("📡 Hitting FMP Stock Screener API for live NSE data...");
    const url = `https://financialmodelingprep.com/api/v3/stock-screener?exchange=NSE&priceMoreThan=100&volumeMoreThan=1000000&limit=10&apikey=${key}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data && data.length > 0) {
      const liveStocks = data.slice(0, 2).map(stock => stock.symbol.replace('.NS', ''));
      console.log(`✅ Live Screener Found: ${liveStocks.join(", ")}`);
      return liveStocks;
    }
  } catch (error) {
    console.log("⚠️ Screener API failed, using default NIFTY stocks.", error.message);
  }
  return defaultStocks;
}

// =====================================================
// LANGUAGE DETECTION
// =====================================================

function detectLanguage(question) {
  const text = String(question || "").toLowerCase();
  const hindiWords = ["kya", "kyu", "kyun", "gir", "raha", "hai", "batao", "kaise", "kitna", "support", "resistance", "share", "stock", "mein", "me", "aur"];
  const hindiCount = hindiWords.filter(word => text.includes(word)).length;
  if (/[\u0900-\u097F]/.test(text)) return "HINDI";
  if (hindiCount >= 2) return "HINGLISH";
  return "ENGLISH";
}

// =====================================================
// COLLECT COMPLETE RESEARCH
// =====================================================

async function collectResearch(question) {
  let stocks = extractStocksFromQuestion(question);
  const language = detectLanguage(question);

  // 🔥 THE MAGIC SCREENER TRIGGER 🔥
  if (stocks.length === 0) {
    console.log("\n🔍 Screener Triggered! Fetching Live Active Stocks from NSE...");
    stocks = await getLiveNseScreener();
  }

  console.log(`\n📌 Collecting complete evidence for ${stocks.join(", ") || "UNKNOWN"}`);

  if (stocks.length === 0) {
    return { success: true, question, language, stocks: [], evidence: [], research: { success: true, articlesProcessed: 0, totalClaims: 0, verifiedClaims: 0, unverifiedClaims: 0, results: [], safeClaims: [], warnings: [] } };
  }

  const evidence = [];

  for (const symbol of stocks) {
    console.log(`\n📌 Researching ${symbol}...`);
    const [yahoo, technical, fmp, alpha, news] = await Promise.all([
      collectYahoo(symbol), collectTechnical(symbol), getFMP(symbol), getAlpha(symbol), collectNews(symbol)
    ]);

    const articles = news.success ? news.articles || [] : [];
    const research = await processResearch(articles);

    evidence.push({
      symbol: normalizeSymbol(symbol), yahooSymbol: yahooSymbol(symbol),
      yahoo: yahoo.success ? yahoo.data : null, yahooStatus: yahoo,
      technical: technical.success ? technical.data : null, technicalStatus: technical,
      fmp: fmp.success ? fmp.data : null, fmpStatus: fmp,
      alpha: alpha.success ? alpha.data : null, alphaStatus: alpha,
      news: news.success ? { totalResults: news.totalResults, articles: news.articles } : { totalResults: 0, articles: [] },
      newsStatus: news, research
    });
  }

  const allResults = evidence.flatMap(item => item.research?.results || []);
  const allClaims = evidence.flatMap(item => item.research?.results?.flatMap(result => result.claims || []) || []);
  const safeClaims = evidence.flatMap(item => item.research?.safeClaims || []);

  return {
    success: true, question, language, stocks, evidence,
    research: { success: true, articlesProcessed: evidence.reduce((sum, item) => sum + (item.research?.articlesProcessed || 0), 0), totalClaims: allClaims.length, verifiedClaims: safeClaims.length, results: allResults, safeClaims, warnings: [] }
  };
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  CONFIG, cleanText, normalizeSymbol, normalizeIndianSymbol, yahooSymbol,
  getYahooStyleSymbol, extractBroker, extractRegulator, buildClaims, calculateEMA,
  calculateSMA, calculateRSI, calculateATR, calculateSupportResistance, determineTrend,
  calculateTechnicalFromChart, collectTechnical, collectYahoo, getFMP, getAlpha,
  collectNews, getNews, processArticle, processResearch, collectResearch
};