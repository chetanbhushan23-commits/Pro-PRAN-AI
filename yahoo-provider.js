const https = require("https");

// =====================================================
// 1. MODERN USER-AGENTS (For Rotation)
// =====================================================
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/122.0.0.0 Safari/537.36"
];

function getRandomAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// =====================================================
// 2. IN-MEMORY CACHE (Avoid duplicate calls)
// =====================================================
const cache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 Minutes Cache

function getCachedData(key) {
  if (cache.has(key)) {
    const { data, expiry } = cache.get(key);
    if (Date.now() < expiry) return data;
    cache.delete(key); // Remove expired cache
  }
  return null;
}

function setCachedData(key, data) {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

// =====================================================
// YAHOO FINANCE - INDIAN MARKET PROVIDER
// =====================================================

function normalizeSymbol(symbol) {
  symbol = symbol.trim().toUpperCase();
  if (symbol.endsWith(".NS")) {
    return symbol;
  }
  return `${symbol}.NS`;
}

// =====================================================
// HTTP REQUEST (Core)
// =====================================================

function yahooRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "query1.finance.yahoo.com",
      path,
      method: "GET",
      headers: {
        "User-Agent": getRandomAgent(), // 👈 Using Rotated Agent
        Accept: "application/json"
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve({ statusCode: res.statusCode, data: json });
        } catch {
          resolve({ statusCode: res.statusCode, data: null, raw: data });
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

// =====================================================
// 3. EXPONENTIAL BACKOFF (Auto-Retry Logic)
// =====================================================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

async function fetchWithRetry(path, retries = 0) {
  // Check Cache first
  const cached = getCachedData(path);
  if (cached) {
    console.log(`⚡ Using cached data for: ${path.split('?')[0]}`);
    return cached;
  }

  try {
    const response = await yahooRequest(path);

    // If Rate Limited (429) or Server Error (5xx)
    if (response.statusCode === 429 || response.statusCode >= 500) {
      throw new Error(`HTTP ${response.statusCode}`);
    }

    // Cache successful requests
    if (response.statusCode >= 200 && response.statusCode < 300) {
      setCachedData(path, response);
    }

    return response;
  } catch (error) {
    if (retries < MAX_RETRIES) {
      const waitTime = INITIAL_BACKOFF_MS * Math.pow(2, retries); // 2s, 4s, 8s
      console.warn(`⚠️ Yahoo API failed (${error.message}). Retrying in ${waitTime / 1000}s... (Attempt ${retries + 1}/${MAX_RETRIES})`);
      await sleep(waitTime);
      return fetchWithRetry(path, retries + 1); // Retry recursively
    } else {
      console.error(`❌ Max retries reached for ${path}`);
      return { statusCode: 500, error: error.message }; // Return failure state safely
    }
  }
}

// =====================================================
// GET QUOTE
// =====================================================

async function getQuote(symbol) {
  const yahooSymbol = normalizeSymbol(symbol);
  const path = `/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1m&includePrePost=false`;

  try {
    const response = await fetchWithRetry(path); // 👈 Replaced direct call with Retry Function

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return { success: false, symbol: yahooSymbol, error: `Yahoo HTTP ${response.statusCode}`, raw: response.data || response.raw };
    }

    const result = response.data?.chart?.result?.[0];
    if (!result) return { success: false, symbol: yahooSymbol, error: response.data?.chart?.error?.description || "No Yahoo data" };

    const meta = result.meta || {};
    return {
      success: true,
      symbol: yahooSymbol,
      data: {
        symbol: meta.symbol,
        exchange: meta.exchangeName,
        fullExchangeName: meta.fullExchangeName,
        currency: meta.currency,
        price: meta.regularMarketPrice,
        previousClose: meta.previousClose,
        open: meta.regularMarketOpen,
        dayHigh: meta.regularMarketDayHigh,
        dayLow: meta.regularMarketDayLow,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
        volume: meta.regularMarketVolume,
        marketState: meta.marketState,
        timestamp: meta.regularMarketTime
      }
    };
  } catch (error) {
    return { success: false, symbol: yahooSymbol, error: error.message };
  }
}

// =====================================================
// GET HISTORICAL OHLCV
// =====================================================

async function getHistory(symbol, range = "1y", interval = "1d") {
  const yahooSymbol = normalizeSymbol(symbol);
  const path = `/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`;

  try {
    const response = await fetchWithRetry(path); // 👈 Replaced direct call with Retry Function

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return { success: false, symbol: yahooSymbol, error: `Yahoo HTTP ${response.statusCode}` };
    }

    const result = response.data?.chart?.result?.[0];
    if (!result) return { success: false, symbol: yahooSymbol, error: response.data?.chart?.error?.description || "No historical data" };

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};

    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];

    const candles = [];

    for (let i = 0; i < timestamps.length; i++) {
      if (opens[i] == null || highs[i] == null || lows[i] == null || closes[i] == null) continue;

      candles.push({
        timestamp: timestamps[i],
        date: new Date(timestamps[i] * 1000).toISOString(),
        open: opens[i],
        high: highs[i],
        low: lows[i],
        close: closes[i],
        volume: volumes[i] ?? 0
      });
    }

    return { success: true, symbol: yahooSymbol, interval, range, count: candles.length, candles };
  } catch (error) {
    return { success: false, symbol: yahooSymbol, error: error.message };
  }
}

// =====================================================
// COMPLETE STOCK DATA
// =====================================================

async function getStockData(symbol) {
  console.log(`🔄 Yahoo data fetching: ${normalizeSymbol(symbol)}`);
  const [quote, history] = await Promise.all([
    getQuote(symbol),
    getHistory(symbol, "1y", "1d")
  ]);

  return { provider: "Yahoo Finance", symbol: normalizeSymbol(symbol), quote, history };
}

// =====================================================
// EXPORT
// =====================================================

module.exports = { normalizeSymbol, getQuote, getHistory, getStockData };