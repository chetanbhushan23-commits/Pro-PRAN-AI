const { analyzeStock } = require("./technical-provider");

// =====================================================
// INDIAN STOCK SCANNER
// =====================================================

const DEFAULT_STOCKS = [
  "RELIANCE",
  "TCS",
  "INFY",
  "MCX",
  "HDFCBANK",
  "SBIN",
  "ITC",
  "ICICIBANK",
  "BHARTIARTL",
  "LT"
];

// =====================================================
// BULLISH SCORE
// =====================================================

function calculateScore(technical) {
  let score = 0;
  const reasons = [];

  const {
    price,
    ema20,
    ema50,
    ema200,
    rsi14,
    volumeRatio,
    macd,
    trend
  } = technical;

  // Price > EMA20
  if (price !== null && ema20 !== null && price > ema20) {
    score += 15;
    reasons.push("Price > EMA20");
  }

  // EMA20 > EMA50
  if (ema20 !== null && ema50 !== null && ema20 > ema50) {
    score += 15;
    reasons.push("EMA20 > EMA50");
  }

  // EMA50 > EMA200
  if (ema50 !== null && ema200 !== null && ema50 > ema200) {
    score += 15;
    reasons.push("EMA50 > EMA200");
  }

  // RSI
  if (rsi14 !== null && rsi14 >= 55 && rsi14 <= 70) {
    score += 15;
    reasons.push("RSI bullish zone");
  } else if (rsi14 !== null && rsi14 > 70) {
    score += 5;
    reasons.push("RSI > 70");
  }

  // MACD
  if (
    macd &&
    macd.line !== null &&
    macd.signal !== null &&
    macd.line > macd.signal
  ) {
    score += 15;
    reasons.push("MACD bullish");
  }

  // Volume
  if (volumeRatio !== null && volumeRatio >= 1.5) {
    score += 15;
    reasons.push("Volume > 1.5x average");
  } else if (volumeRatio !== null && volumeRatio >= 1.2) {
    score += 5;
    reasons.push("Volume above average");
  }

  // Trend
  if (trend === "STRONG_BULLISH") {
    score += 10;
    reasons.push("Strong bullish trend");
  } else if (trend === "BULLISH") {
    score += 5;
    reasons.push("Bullish trend");
  }

  let signal = "WAIT";

  if (score >= 80) {
    signal = "STRONG BUY";
  } else if (score >= 65) {
    signal = "BUY";
  } else if (score >= 50) {
    signal = "WATCH";
  }

  return {
    score,
    signal,
    reasons
  };
}

// =====================================================
// SCAN ONE STOCK
// =====================================================

async function scanStock(symbol) {
  try {
    const result = await analyzeStock(symbol);

    if (!result.success) {
      return {
        success: false,
        symbol,
        error: result.error
      };
    }

    const technical = result.technical;

    const score = calculateScore(technical);

    return {
      success: true,

      symbol: result.symbol,

      price: technical.price,

      rsi: technical.rsi14,

      ema20: technical.ema20,
      ema50: technical.ema50,
      ema200: technical.ema200,

      macd: technical.macd?.line ?? null,
      macdSignal: technical.macd?.signal ?? null,

      volume: technical.volume,
      averageVolume30: technical.averageVolume30,
      volumeRatio: technical.volumeRatio,

      support: technical.support,
      resistance: technical.resistance,

      trend: technical.trend,

      score: score.score,
      signal: score.signal,

      reasons: score.reasons
    };
  } catch (error) {
    return {
      success: false,
      symbol,
      error: error.message
    };
  }
}

// =====================================================
// SCAN MULTIPLE STOCKS
// =====================================================

async function scanStocks(symbols = DEFAULT_STOCKS) {
  console.log("\n==========================================");
  console.log(" 🇮🇳 INDIAN STOCK SCANNER");
  console.log("==========================================");

  console.log(`\n📊 Stocks to scan: ${symbols.length}`);

  const results = [];

  // Sequential scanning
  // Safer for Yahoo request limits
  for (const symbol of symbols) {
    console.log(`\n🔍 Scanning ${symbol}...`);

    const result = await scanStock(symbol);

    results.push(result);

    if (result.success) {
      console.log(
        `✅ ${result.symbol} → ${result.signal} (${result.score}/100)`
      );
    } else {
      console.log(
        `❌ ${symbol} → ${result.error}`
      );
    }
  }

  // Highest score first
  results.sort((a, b) => {
    return (b.score || 0) - (a.score || 0);
  });

  return results;
}

// =====================================================
// EXPORT
// =====================================================

module.exports = {
  DEFAULT_STOCKS,
  calculateScore,
  scanStock,
  scanStocks
};