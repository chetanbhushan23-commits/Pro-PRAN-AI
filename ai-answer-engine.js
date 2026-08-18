"use strict";

require("dotenv").config();

const https = require("https");

// Safely optional requires for secondary modules if present in your environment
try {
  const { verifyArticle, fetchPage, htmlToText } = require("./article-verifier");
  const { verifyClaims } = require("./claim-verifier");
} catch (e) {
  // Ignored if run in isolated environment
}

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
  newsPageSize: 3
};

// ⚡ IN-MEMORY CACHE STORAGE (Prevents API rate limits and speeds up repeated queries)
const memoryCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

function getCache(key) {
  if (!memoryCache.has(key)) return null;
  const cached = memoryCache.get(key);
  if (Date.now() > cached.expiry) {
    memoryCache.delete(key);
    return null;
  }
  return cached.data;
}

function setCache(key, data) {
  memoryCache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

// Standard browser headers to prevent Yahoo Finance blocking (403/429)
const DEFAULT_HEADERS = {
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Connection": "keep-alive"
};

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    options.headers = { ...DEFAULT_HEADERS, ...(options.headers || {}) };

    const req = https.request(options, res => {
      // Handle automatic HTTP redirects (Yahoo 301/302)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try {
          const url = new URL(res.headers.location);
          const newOptions = { 
            ...options, 
            hostname: url.hostname, 
            path: url.pathname + url.search 
          };
          return request(newOptions, body).then(resolve).catch(reject);
        } catch (err) {
          // Fall through to normal collection if redirect parse fails
        }
      }

      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (_) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, data: parsed });
      });
    });
    
    req.on("error", reject);
    req.setTimeout(25000, () => req.destroy(new Error("Request timeout")));
    if (body) req.write(body);
    req.end();
  });
}

function cleanText(value) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeSymbol(symbol) {
  if (!symbol) return "";
  return String(symbol).trim().toUpperCase().replace(/\s+/g, "").replace(/\.NS$/i, "").replace(/\.NSE$/i, "").replace(/\.BO$/i, "");
}

function yahooSymbol(symbol) {
  const clean = normalizeSymbol(symbol);
  if (!clean) return "";
  if (clean.startsWith("^") || clean.includes("=")) return clean;
  return `${clean}.NS`;
}

function round(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function uniqueNumbers(values) {
  const result = [];
  for (const value of values) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    if (!result.some(x => Math.abs(x - n) < 0.000001)) result.push(n);
  }
  return result;
}

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

function calculateSupportResistance(highs, lows, closes, currentPrice, ema20, ema50, ema200) {
  const price = Number(currentPrice);
  if (!Number.isFinite(price)) return { supports: [], resistances: [], support: null, resistance: null };
  const highValues = highs.map(Number).filter(Number.isFinite);
  const lowValues = lows.map(Number).filter(Number.isFinite);
  
  const recentLow = lowValues.length ? Math.min(...lowValues.slice(-60)) : null;
  const recentHigh = highValues.length ? Math.max(...highValues.slice(-60)) : null;

  const supportCandidates = uniqueNumbers([recentLow, ema20, ema50, ema200])
    .filter(level => Number.isFinite(level) && level < price).sort((a, b) => b - a);

  const resistanceCandidates = uniqueNumbers([recentHigh])
    .filter(level => Number.isFinite(level) && level > price).sort((a, b) => a - b);

  return {
    support: supportCandidates[0] || round(price * 0.95),
    resistance: resistanceCandidates[0] || round(price * 1.05),
    supports: supportCandidates.map(round),
    resistances: resistanceCandidates.map(round)
  };
}

function determineTrend(price, ema20, ema50, ema200, rsi) {
  let score = 0;
  if (Number.isFinite(price) && Number.isFinite(ema20)) score += price > ema20 ? 1 : -1;
  if (Number.isFinite(ema20) && Number.isFinite(ema50)) score += ema20 > ema50 ? 1 : -1;
  if (Number.isFinite(ema50) && Number.isFinite(ema200)) score += ema50 > ema200 ? 1 : -1;
  if (Number.isFinite(rsi)) {
    if (rsi >= 55) score++;
    else if (rsi < 45) score--;
  }
  if (score >= 2) return "BULLISH";
  if (score <= -1) return "BEARISH";
  return "NEUTRAL";
}

async function collectTechnical(symbol) {
  const cacheKey = `tech_${normalizeSymbol(symbol)}`;
  const cachedData = getCache(cacheKey);
  if (cachedData) {
    console.log(`⚡ [CACHE HIT] Technicals for ${symbol}`);
    return { success: true, data: cachedData };
  }

  const ySymbol = yahooSymbol(symbol);
  const path = `/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=1d&range=6mo`;
  const options = { hostname: CONFIG.yahooHost, path, method: "GET" };
  
  try {
    const res = await request(options);
    const result = res.data?.chart?.result?.[0];
    if (!result) return { success: false, error: "Technical chart data unavailable" };

    const quotes = result.indicators?.quote?.[0] || {};
    const closes = (quotes.close || []).filter(Number.isFinite);
    const highs = (quotes.high || []).filter(Number.isFinite);
    const lows = (quotes.low || []).filter(Number.isFinite);
    const volumes = (quotes.volume || []).filter(Number.isFinite);

    if (closes.length < 15) return { success: false, error: "Insufficient technical history" };

    const currentPrice = closes[closes.length - 1];
    const previousClose = closes[closes.length - 2] || currentPrice;
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const ema200 = calculateEMA(closes, 200);
    const rsi = calculateRSI(closes, 14);
    const levels = calculateSupportResistance(highs, lows, closes, currentPrice, ema20, ema50, ema200);
    const trend = determineTrend(currentPrice, ema20, ema50, ema200, rsi);

    const payload = {
      symbol: result.meta?.symbol || ySymbol,
      price: round(currentPrice),
      previousClose: round(previousClose),
      change: round(currentPrice - previousClose),
      changePercent: round(((currentPrice - previousClose) / previousClose) * 100),
      rsi: round(rsi),
      ema20: round(ema20),
      ema50: round(ema50),
      ema200: round(ema200),
      support: levels.support,
      resistance: levels.resistance,
      supports: levels.supports,
      resistances: levels.resistances,
      trend,
      volume: volumes[volumes.length - 1] || null
    };

    setCache(cacheKey, payload);
    return { success: true, data: payload };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function collectYahoo(symbol) {
  const cacheKey = `yahoo_${normalizeSymbol(symbol)}`;
  const cachedData = getCache(cacheKey);
  if (cachedData) return { success: true, data: cachedData };

  const ySymbol = yahooSymbol(symbol);
  if (!ySymbol) return { success: false, error: "Invalid symbol" };
  const path = `/v7/finance/quote?symbols=${encodeURIComponent(ySymbol)}`;
  const options = { hostname: CONFIG.yahooHost, path, method: "GET" };
  
  try {
    const response = await request(options);
    const quote = response.data?.quoteResponse?.result?.[0];
    if (!quote) return { success: false, error: "Yahoo quote unavailable" };
    setCache(cacheKey, quote);
    return { success: true, data: quote };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getFMP(symbol) {
  const key = process.env.FMP_API_KEY;
  if (!key) return { success: false, error: "FMP_API_KEY missing" };
  const options = { hostname: "financialmodelingprep.com", path: `/stable/quote?symbol=${encodeURIComponent(normalizeSymbol(symbol))}&apikey=${encodeURIComponent(key)}`, method: "GET" };
  
  try {
    const response = await request(options);
    if (response.statusCode >= 200 && response.statusCode < 300 && Array.isArray(response.data) && response.data.length) {
      return { success: true, data: response.data[0] };
    }
    return { success: false, error: "FMP data unavailable" };
  } catch (error) { return { success: false, error: error.message }; }
}

async function collectNews(symbol) {
  const key = process.env.NEWS_API_KEY;
  if (!key) return { success: false, articles: [] };
  const query = encodeURIComponent(`"${normalizeSymbol(symbol)}" India stock`);
  const path = `/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=${CONFIG.newsPageSize}&apiKey=${encodeURIComponent(key)}`;
  const options = { hostname: "newsapi.org", path, method: "GET", headers: { Accept: "application/json", "User-Agent": "indian-stock-ai/2.0" } };
  
  try {
    const response = await request(options);
    if (response.statusCode >= 200 && response.statusCode < 300 && response.data?.status === "ok") {
      const articles = (response.data.articles || []).map(article => ({
        title: cleanText(article.title), source: article.source?.name || null,
        publishedAt: article.publishedAt || null, description: cleanText(article.description), url: article.url || null
      })).filter(a => a.title && a.url);
      return { success: true, articles };
    }
    return { success: false, articles: [] };
  } catch (error) { return { success: false, articles: [] }; }
}

const CHAT_STOP_WORDS = new Set([
  "THE", "AND", "FOR", "WHY", "WHAT", "HOW", "IS", "ARE", "THIS", "THAT",
  "STOCK", "STOCKS", "PRICE", "SUPPORT", "RESISTANCE", "TODAY", "NEWS",
  "SHARE", "SHARES", "INDIA", "NSE", "BSE", "TOP", "CURRENT", "PROFIT",
  "LIST", "BULLISH", "BEARISH", "BREAKOUT", "BREAKDOWN", "SIGNALS",
  "TECHNICAL", "DATA", "ACTIVE", "VOLUME", "MARKET", "TREND", "ANALYSIS",
  "COMPANY", "BUY", "SELL", "TARGET", "BEST", "PERFORMANCE", "AI",
  "KYA", "KYU", "KY", "KA", "KE", "KI", "KO", "MEIN", "PAR", "HAI", "HO",
  "HUA", "HUI", "BTAO", "BATAO", "DIKHAO", "CHAHIYE", "H", "Y", "HI",
  "KAISE", "BATAYO", "BATA", "KARNA", "KAUN", "KON", "H", "H?", "KY H",
  "AUR", "YA", "KRE", "KESE", "DE", "KRO", "GALT", "ANS", "RAHA", "BATAO"
]);

// Expanded basket of top liquid Indian NSE stocks for screener queries
const NIFTY_BASKET = [
  "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "SBIN",
  "BHARTIARTL", "ITC", "LT", "BAJFINANCE", "TATAMOTORS", "ZOMATO",
  "M&M", "MARUTI", "SUNPHARMA", "NTPC", "AXISBANK", "ULTRACEMCO",
  "TITAN", "WIPRO", "HCLTECH", "ONGC", "POWERGRID", "ADANIENT", "TATASTEEL"
];

function extractStocksFromQuestion(question) {
  const text = String(question || "").toUpperCase();
  
  if (text.includes("NIFTY 50") || text.includes("NIFTY50")) return { stocks: ["^NSEI"], isScreener: false };
  if (text.includes("SENSEX")) return { stocks: ["^BSESN"], isScreener: false };
  if (text.includes("NIFTY NEXT 50") || text.includes("NEXT 50")) return { stocks: ["^CNXNXT"], isScreener: false };
  if (text.includes("MCX")) return { stocks: ["MCX"], isScreener: false };

  const isScreener = text.includes("LIST") || text.includes("TOP") || text.includes("BEST") ||
                     text.includes("BREAKOUT") || text.includes("BULLISH") || text.includes("BEARISH") || 
                     text.includes("SCREENER") || text.includes("BTAO");

  const matches = text.match(/\b[A-Z]{2,12}\b/g) || [];
  const found = [];

  for (const word of matches) {
    if (!CHAT_STOP_WORDS.has(word)) {
      found.push(word);
    }
  }

  let finalStocks = [...new Set(found)].slice(0, 2);
  
  return { stocks: finalStocks, isScreener: (isScreener && finalStocks.length === 0) };
}

const SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes background cycle

async function scanBasketInBatches(basket, batchSize) {
  const results = [];
  for (let i = 0; i < basket.length; i += batchSize) {
    const batch = basket.slice(i, i + batchSize);
    const batchPromises = batch.map(sym => collectTechnical(sym));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  return results;
}

async function runMarketScan() {
  console.log("🔄 [BACKGROUND SCAN] Starting automated market analysis...");
  const scanResults = await scanBasketInBatches(NIFTY_BASKET, 5);
  
  const bullishStocks = scanResults
    .filter(r => r.success && r.data)
    .filter(r => {
      const isBullish = r.data.trend === "BULLISH";
      const isBreakout = r.data.price >= r.data.resistance;
      const isOversoldReversal = r.data.rsi > 30 && r.data.rsi < 50 && r.data.price > r.data.ema20;
      return isBullish || isBreakout || isOversoldReversal;
    })
    .sort((a, b) => b.data.rsi - a.data.rsi)
    .map(r => r.data.symbol.replace(".NS", ""));

  if (bullishStocks.length > 0) {
    // Save to a persistent memory cache for 20 mins
    memoryCache.set("BACKGROUND_BREAKOUTS", { data: bullishStocks, expiry: Date.now() + (20 * 60 * 1000) });
    console.log(`✅ [BACKGROUND SCAN] Complete! Top Breakouts updated: ${bullishStocks.slice(0, 5).join(", ")}`);
  } else {
    console.log("⚠️ [BACKGROUND SCAN] Complete, but no strong breakouts found.");
  }
}

function startBackgroundScanner() {
  console.log("⏰ Initializing Pro Background Scanner...");
  runMarketScan(); // Run immediately on server start
  setInterval(runMarketScan, SCAN_INTERVAL_MS); // Run every 15 minutes automatically
}

async function collectResearch(question) {
  const extracted = extractStocksFromQuestion(question);
  let stocks = extracted.stocks;
  const evidence = [];

  // MINI-SCREENER LOGIC
  if (extracted.isScreener) {
    const preScanned = getCache("BACKGROUND_BREAKOUTS");
    
    if (preScanned && preScanned.length > 0) {
      console.log("⚡ [CACHE HIT] Using pre-calculated background breakouts!");
      stocks = preScanned.slice(0, 3);
    } else {
      console.log("🔍 [ON-DEMAND] Screener intent detected. Scanning Nifty basket...");
      
      const scanResults = await scanBasketInBatches(NIFTY_BASKET, 5);

      const bullishStocks = scanResults
        .filter(r => r.success && r.data)
        .filter(r => {
          const isBullish = r.data.trend === "BULLISH";
          const isBreakout = r.data.price >= r.data.resistance;
          const isOversoldReversal = r.data.rsi > 30 && r.data.rsi < 50 && r.data.price > r.data.ema20;
          return isBullish || isBreakout || isOversoldReversal;
        })
        .sort((a, b) => b.data.rsi - a.data.rsi)
        .map(r => r.data.symbol.replace(".NS", ""));

      if (bullishStocks.length > 0) {
        stocks = bullishStocks.slice(0, 3);
      } else {
        stocks = ["RELIANCE", "HDFCBANK"]; // Fallback
      }
    }
  } else if (stocks.length === 0) {
    stocks = ["RELIANCE"]; // Fallback
  }

  for (const symbol of stocks) {
    const [yahoo, technical, fmp, news] = await Promise.all([
      collectYahoo(symbol), collectTechnical(symbol), getFMP(symbol), collectNews(symbol)
    ]);

    evidence.push({
      symbol: normalizeSymbol(symbol),
      yahooSymbol: yahooSymbol(symbol),
      yahoo: yahoo.success ? yahoo.data : null,
      technical: technical.success ? technical.data : null,
      fmp: fmp.success ? fmp.data : null,
      news: news.success ? { articles: news.articles } : { articles: [] }
    });
  }

  return {
    success: true,
    question,
    stocks,
    evidence,
    research: { success: true }
  };
}

module.exports = {
  collectResearch,
  startBackgroundScanner,
  runMarketScan,
  collectTechnical
};