const { getStockData: getYahooData } = require("./yahoo-provider");

// =====================================================
// FALLBACK ARCHITECTURE (Primary -> Secondary)
// =====================================================

async function getStockDataWithFallback(symbol) {
  console.log(`📡 Fetching market data for ${symbol}...`);

  // --- ATTEMPT 1: Primary Data Source (e.g., FMP, Upstox, etc.) ---
  try {
    // 💡 Jab aapke paas FMP ya koi aur Primary API ho, toh uska logic yahan aayega.
    // Abhi ke liye hum force-error throw kar rahe hain taaki Fallback test ho sake.
    throw new Error("Primary provider not yet connected");
    
  } catch (error) {
    console.log(`⚠️ Primary source failed (${error.message}). Falling back to Yahoo Finance...`);
    
    // --- ATTEMPT 2: Fallback to Secondary Source (Yahoo) ---
    const fallbackData = await getYahooData(symbol);
    return fallbackData;
  }
}

// =====================================================
// TECHNICAL ANALYSIS ENGINE
// =====================================================

function round(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  return Number(value.toFixed(decimals));
}

// =====================================================
// EMA
// =====================================================

function calculateEMA(values, period) {
  if (values.length < period) {
    return null;
  }

  const multiplier = 2 / (period + 1);

  // Initial SMA
  let ema =
    values
      .slice(0, period)
      .reduce((sum, value) => sum + value, 0) / period;

  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }

  return ema;
}

// =====================================================
// RSI
// =====================================================

function calculateRSI(values, period = 14) {
  if (values.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    averageGain = ((averageGain * (period - 1)) + gain) / period;
    averageLoss = ((averageLoss * (period - 1)) + loss) / period;
  }

  if (averageLoss === 0) {
    return 100;
  }

  const rs = averageGain / averageLoss;
  return 100 - (100 / (1 + rs));
}

// =====================================================
// MACD
// =====================================================

function calculateMACD(values) {
  if (values.length < 35) {
    return null;
  }

  const ema12Series = [];
  const ema26Series = [];

  function buildEMASeries(data, period) {
    if (data.length < period) {
      return [];
    }

    const multiplier = 2 / (period + 1);
    let ema =
      data
        .slice(0, period)
        .reduce((sum, value) => sum + value, 0) / period;

    const series = [];
    series.push(ema);

    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
      series.push(ema);
    }
    return series;
  }

  const ema12 = buildEMASeries(values, 12);
  const ema26 = buildEMASeries(values, 26);

  // Align EMA12 with EMA26
  for (let i = 0; i < ema26.length; i++) {
    const ema12Index = i + (12 - 26);
    if (ema12Index >= 0) {
      ema12Series.push(ema12[ema12Index]);
    }
  }

  const macdLine = [];
  for (let i = 0; i < ema26.length; i++) {
    const fast = ema12Series[i];
    if (fast !== undefined) {
      macdLine.push(fast - ema26[i]);
    }
  }

  if (macdLine.length < 9) {
    return null;
  }

  const signal = calculateEMA(macdLine, 9);
  const latestMACD = macdLine[macdLine.length - 1];

  return {
    macd: latestMACD,
    signal,
    histogram: signal !== null ? latestMACD - signal : null
  };
}

// =====================================================
// ATR
// =====================================================

function calculateATR(candles, period = 14) {
  if (candles.length <= period) {
    return null;
  }

  const trueRanges = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const highLow = current.high - current.low;
    const highPreviousClose = Math.abs(current.high - previous.close);
    const lowPreviousClose = Math.abs(current.low - previous.close);

    const trueRange = Math.max(
      highLow,
      highPreviousClose,
      lowPreviousClose
    );
    trueRanges.push(trueRange);
  }

  if (trueRanges.length < period) {
    return null;
  }

  let atr =
    trueRanges
      .slice(0, period)
      .reduce((sum, value) => sum + value, 0) / period;

  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
  }

  return atr;
}

// =====================================================
// AVERAGE VOLUME
// =====================================================

function calculateAverageVolume(candles, period = 30) {
  if (candles.length < period) {
    return null;
  }

  const volumes = candles
    .slice(-period)
    .map(candle => candle.volume || 0);

  return (
    volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length
  );
}

// =====================================================
// SUPPORT / RESISTANCE
// =====================================================

function calculateSupportResistance(candles) {
  if (candles.length < 20) {
    return {
      support: null,
      resistance: null
    };
  }

  const recent = candles.slice(-20);
  const support = Math.min(...recent.map(candle => candle.low));
  const resistance = Math.max(...recent.map(candle => candle.high));

  return { support, resistance };
}

// =====================================================
// TREND
// =====================================================

function determineTrend(price, ema20, ema50, ema200) {
  if (ema20 === null || ema50 === null) {
    return "INSUFFICIENT_DATA";
  }

  if (ema200 !== null && price > ema20 && ema20 > ema50 && ema50 > ema200) {
    return "STRONG_BULLISH";
  }
  if (price > ema20 && ema20 > ema50) {
    return "BULLISH";
  }
  if (ema200 !== null && price < ema20 && ema20 < ema50 && ema50 < ema200) {
    return "STRONG_BEARISH";
  }
  if (price < ema20 && ema20 < ema50) {
    return "BEARISH";
  }

  return "SIDEWAYS";
}

// =====================================================
// COMPLETE TECHNICAL ANALYSIS
// =====================================================

async function analyzeStock(symbol) {
  console.log(`\n🔄 Technical analysis: ${symbol}`);

  // 👉 Direct Yahoo ki jagah ab hum Fallback function call karenge
  const stock = await getStockDataWithFallback(symbol);

  if (!stock || !stock.history || !stock.history.success) {
    return {
      success: false,
      error: stock?.history?.error || "Historical data unavailable across all providers"
    };
  }

  const candles = stock.history.candles;

  if (candles.length < 50) {
    return {
      success: false,
      error: "Not enough historical data for technical analysis"
    };
  }

  const closes = candles.map(candle => candle.close);
  const price = closes[closes.length - 1];

  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const atr = calculateATR(candles, 14);
  const averageVolume = calculateAverageVolume(candles, 30);
  const latestVolume = candles[candles.length - 1].volume;

  const volumeRatio = averageVolume && averageVolume > 0
    ? latestVolume / averageVolume
    : null;

  const supportResistance = calculateSupportResistance(candles);
  const trend = determineTrend(price, ema20, ema50, ema200);

  return {
    success: true,
    provider: stock.provider || "Fallback Provider",
    symbol: stock.symbol,
    technical: {
      price: round(price),
      ema20: round(ema20),
      ema50: round(ema50),
      ema200: round(ema200),
      rsi14: round(rsi),
      macd: macd
        ? {
            line: round(macd.macd),
            signal: round(macd.signal),
            histogram: round(macd.histogram)
          }
        : null,
      atr14: round(atr),
      volume: latestVolume,
      averageVolume30: round(averageVolume),
      volumeRatio: round(volumeRatio),
      support: round(supportResistance.support),
      resistance: round(supportResistance.resistance),
      trend
    },
    dataPoints: candles.length
  };
}

// =====================================================
// EXPORT
// =====================================================

module.exports = {
  analyzeStock,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateAverageVolume
};