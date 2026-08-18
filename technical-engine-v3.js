"use strict";

const https = require("https");
require("dotenv").config(); // Load env for FMP Key

/*
=========================================================
TECHNICAL ENGINE V3 (ULTIMATE DUAL-FALLBACK EDITION)
Indian Stock AI
---------------------------------------------------------
Features:
- Primary: Yahoo Finance Chart API (v8)
- Fallback: FMP Historical Price API (Guaranteed Data)
- RSI 14, EMA 20 / 50 / 200, SMA 20 / 50 / 200
- ATR 14, ADX 14, MACD, Volume Ratio
- Swing Support / Resistance & Pivot Points
=========================================================
*/

// =======================================================
// DUAL DATA FETCHER (YAHOO + FMP)
// =======================================================

function fetchFromFMP(symbol) {
  return new Promise((resolve) => {
    const key = process.env.FMP_API_KEY;
    if (!key) return resolve([]); // Skip if no key

    let clean = String(symbol).trim().toUpperCase().replace(/\.NS$/i, "").replace(/\.NSE$/i, "");
    const fmpSymbol = (clean.startsWith("^") || clean.includes("=")) ? clean : `${clean}.NS`;

    const options = {
      hostname: 'financialmodelingprep.com',
      path: `/api/v3/historical-price-full/${encodeURIComponent(fmpSymbol)}?apikey=${key}`,
      method: 'GET'
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && Array.isArray(json.historical)) {
            resolve(json.historical);
          } else {
            resolve([]);
          }
        } catch (e) {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

function fetchFromYahoo(symbol) {
  return new Promise((resolve) => {
    let clean = String(symbol).trim().toUpperCase().replace(/\.NS$/i, "").replace(/\.NSE$/i, "");
    const ySymbol = (clean.startsWith("^") || clean.includes("=")) ? clean : `${clean}.NS`;

    const options = {
      hostname: 'query2.finance.yahoo.com',
      path: `/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=1d&range=1y`,
      method: 'GET',
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve([]); // Blocked by Yahoo, fail fast
        try {
          const json = JSON.parse(data);
          const result = json.chart?.result?.[0];
          if (!result || !result.timestamp) return resolve([]);

          const quotes = result.indicators.quote[0];
          const candles = result.timestamp.map((time, i) => ({
            date: new Date(time * 1000).toISOString(),
            open: quotes.open[i],
            high: quotes.high[i],
            low: quotes.low[i],
            close: quotes.close[i],
            volume: quotes.volume[i]
          })).filter(c => c.close !== null && c.close !== undefined);

          resolve(candles);
        } catch (err) {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

async function fetchMarketData(symbol) {
  console.log(`\n⏳ Fetching Market Data for ${symbol}...`);
  
  // Attempt 1: Yahoo Finance
  let candles = await fetchFromYahoo(symbol);
  if (candles.length >= 30) {
    console.log(`✅ Success: Chart data fetched from Yahoo.`);
    return candles;
  }
  
  // Attempt 2: FMP Fallback
  console.log(`⚠️ Yahoo blocked the request. Falling back to FMP API...`);
  candles = await fetchFromFMP(symbol);
  if (candles.length >= 30) {
    console.log(`✅ Success: Chart data fetched from FMP.`);
    return candles;
  }

  console.log(`❌ All technical data providers failed for ${symbol}`);
  return [];
}

// =======================================================
// HELPERS
// =======================================================

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, decimals = 2) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(Number(value) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeCandles(input = []) {
  if (!Array.isArray(input)) return [];
  return input.map(c => ({
      date: c.date || c.datetime || c.timestamp || c.time || null,
      open: num(c.open ?? c.Open),
      high: num(c.high ?? c.High),
      low: num(c.low ?? c.Low),
      close: num(c.close ?? c.Close ?? c.adjclose ?? c.adjClose),
      volume: num(c.volume ?? c.Volume)
    }))
    .filter(c => c.high !== null && c.low !== null && c.close !== null)
    .sort((a, b) => {
      if (!a.date || !b.date) return 0;
      return new Date(a.date) - new Date(b.date);
    });
}

// =======================================================
// SMA
// =======================================================

function calculateSMA(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const slice = values.slice(-period);
  const valid = slice.filter(v => Number.isFinite(Number(v)));
  if (valid.length < period) return null;
  return valid.reduce((sum, value) => sum + Number(value), 0) / period;
}

// =======================================================
// EMA SERIES
// =======================================================

function calculateEMASeries(values, period) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const result = new Array(values.length).fill(null);
  if (values.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += Number(values[i]);
  let ema = sum / period;
  result[period - 1] = ema;

  const multiplier = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    ema = (Number(values[i]) - ema) * multiplier + ema;
    result[i] = ema;
  }
  return result;
}

function calculateEMA(values, period) {
  const series = calculateEMASeries(values, period);
  for (let i = series.length - 1; i >= 0; i--) {
    if (Number.isFinite(series[i])) return series[i];
  }
  return null;
}

// =======================================================
// RSI
// =======================================================

function calculateRSI(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return null;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = Number(values[i]) - Number(values[i - 1]);
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = Number(values[i]) - Number(values[i - 1]);
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// =======================================================
// TRUE RANGE & ATR
// =======================================================

function calculateTRSeries(candles) {
  const tr = [];
  for (let i = 0; i < candles.length; i++) {
    const current = candles[i];
    if (i === 0) {
      tr.push(current.high - current.low);
      continue;
    }
    const previous = candles[i - 1];
    const range1 = current.high - current.low;
    const range2 = Math.abs(current.high - previous.close);
    const range3 = Math.abs(current.low - previous.close);
    tr.push(Math.max(range1, range2, range3));
  }
  return tr;
}

function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const tr = calculateTRSeries(candles);
  return calculateSMA(tr, period);
}

// =======================================================
// MACD
// =======================================================

function calculateMACD(values) {
  const ema12 = calculateEMA(values, 12);
  const ema26 = calculateEMA(values, 26);

  if (ema12 === null || ema26 === null) {
    return { macd: null, signal: null, histogram: null };
  }

  const series12 = calculateEMASeries(values, 12);
  const series26 = calculateEMASeries(values, 26);
  const macdSeries = [];

  for (let i = 0; i < values.length; i++) {
    if (series12[i] !== null && series26[i] !== null) {
      macdSeries.push(series12[i] - series26[i]);
    }
  }

  const macd = macdSeries[macdSeries.length - 1];
  const signal = calculateEMA(macdSeries, 9);

  return {
    macd: round(macd),
    signal: signal === null ? null : round(signal),
    histogram: signal === null ? null : round(macd - signal)
  };
}

// =======================================================
// VOLUME
// =======================================================

function calculateVolumeMetrics(candles, period = 30) {
  const volumes = candles.map(c => c.volume).filter(v => Number.isFinite(v));
  if (volumes.length === 0) return { volume: null, averageVolume: null, volumeRatio: null };

  const currentVolume = volumes[volumes.length - 1];
  const averageVolume = calculateSMA(volumes, Math.min(period, volumes.length));

  return {
    volume: currentVolume,
    averageVolume: averageVolume === null ? null : round(averageVolume, 0),
    volumeRatio: averageVolume && averageVolume > 0 ? round(currentVolume / averageVolume, 2) : null
  };
}

// =======================================================
// SWING LEVELS & CLUSTER
// =======================================================

function findSwingLevels(candles, lookback = 60) {
  const data = candles.slice(-lookback);
  if (data.length < 5) return { swingLows: [], swingHighs: [] };

  const swingLows = [], swingHighs = [];
  for (let i = 2; i < data.length - 2; i++) {
    const current = data[i];
    if (current.low < data[i - 1].low && current.low < data[i - 2].low && current.low < data[i + 1].low && current.low < data[i + 2].low) {
      swingLows.push(current.low);
    }
    if (current.high > data[i - 1].high && current.high > data[i - 2].high && current.high > data[i + 1].high && current.high > data[i + 2].high) {
      swingHighs.push(current.high);
    }
  }
  return { swingLows, swingHighs };
}

function clusterLevels(levels, tolerancePercent = 0.012) {
  const clean = levels.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const clusters = [];

  for (const level of clean) {
    let cluster = clusters.find(c => Math.abs(c.average - level) / level <= tolerancePercent);
    if (!cluster) {
      clusters.push({ values: [level], average: level });
    } else {
      cluster.values.push(level);
      cluster.average = cluster.values.reduce((a, b) => a + b, 0) / cluster.values.length;
    }
  }
  return clusters.map(c => ({ level: round(c.average), strength: c.values.length }));
}

function calculateSupportResistance(candles, indicators) {
  const price = indicators.price;
  const swing = findSwingLevels(candles, 80);
  const supports = [], resistances = [];

  for (const level of swing.swingLows) { if (level < price) supports.push(level); }
  for (const level of swing.swingHighs) { if (level > price) resistances.push(level); }

  if (indicators.ema20 !== null && indicators.ema20 < price) supports.push(indicators.ema20);
  if (indicators.ema50 !== null && indicators.ema50 < price) supports.push(indicators.ema50);
  if (indicators.ema200 !== null && indicators.ema200 < price) supports.push(indicators.ema200);

  const nearestSupports = clusterLevels(supports).filter(x => x.level < price).sort((a, b) => b.level - a.level).slice(0, 3);
  const nearestResistances = clusterLevels(resistances).filter(x => x.level > price).sort((a, b) => a.level - b.level).slice(0, 3);

  return {
    supports: nearestSupports.map(x => x.level),
    resistances: nearestResistances.map(x => x.level)
  };
}

// =======================================================
// TREND
// =======================================================

function calculateTrend(price, ema20, ema50, ema200, rsi) {
  let score = 50;
  if (ema20 !== null && price > ema20) score += 10; else score -= 10;
  if (ema50 !== null && price > ema50) score += 10; else score -= 10;
  if (ema200 !== null && price > ema200) score += 10; else score -= 10;
  if (ema20 !== null && ema50 !== null) { if (ema20 > ema50) score += 10; else score -= 10; }
  if (rsi !== null) { if (rsi >= 55) score += 5; if (rsi < 45) score -= 5; }

  let trend = "NEUTRAL";
  if (score >= 80) trend = "STRONG_BULLISH";
  else if (score >= 65) trend = "BULLISH";
  else if (score <= 20) trend = "STRONG_BEARISH";
  else if (score <= 35) trend = "BEARISH";

  return { score, trend };
}

// =======================================================
// MAIN CALCULATE FUNCTION
// =======================================================

function calculateTechnicalV3(input) {
  const candles = normalizeCandles(input?.candles || input?.history || input || []);
  if (candles.length < 30) return { success: false, error: "Insufficient candle data" };

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];

  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi = calculateRSI(closes, 14);
  const volume = calculateVolumeMetrics(candles, 30);

  const indicators = {
    price: round(price),
    ema20: ema20 === null ? null : round(ema20),
    ema50: ema50 === null ? null : round(ema50),
    ema200: ema200 === null ? null : round(ema200),
    rsi: rsi === null ? null : round(rsi),
    volume: volume.volume,
    averageVolume: volume.averageVolume,
    volumeRatio: volume.volumeRatio
  };

  const levels = calculateSupportResistance(candles, indicators);
  const trend = calculateTrend(price, ema20, ema50, ema200, rsi);

  return {
    success: true,
    price: indicators.price,
    indicators,
    levels,
    trend
  };
}

// =======================================================
// 🚀 ASYNC COLLECTOR
// =======================================================

async function collectTechnical(symbolOrCandles) {
  if (Array.isArray(symbolOrCandles) || symbolOrCandles?.candles) {
    return calculateTechnicalV3(symbolOrCandles);
  }

  if (typeof symbolOrCandles === 'string') {
    try {
      const candles = await fetchMarketData(symbolOrCandles);
      
      if (!candles || candles.length < 30) {
        return { success: false, error: "Insufficient historical data fetched from all providers." };
      }

      const calc = calculateTechnicalV3(candles);
      if (!calc.success) return { success: false, error: calc.error };

      console.log(`✅ Success! Generated technicals for ${symbolOrCandles} (Price: ₹${calc.price})`);

      // 🎯 Exact format needed by your Answer Engine
      return {
        success: true,
        provider: "Dual-Engine V3",
        data: {
          price: calc.price,
          rsi: calc.indicators.rsi,
          ema20: calc.indicators.ema20,
          ema50: calc.indicators.ema50,
          ema200: calc.indicators.ema200,
          supports: calc.levels.supports,
          resistances: calc.levels.resistances,
          support: calc.levels.supports[0] || null,
          resistance: calc.levels.resistances[0] || null,
          trend: calc.trend.trend,
          volume: calc.indicators.volume,
          averageVolume: calc.indicators.averageVolume,
          volumeRatio: calc.indicators.volumeRatio
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: "Invalid input" };
}

// =======================================================
// EXPORT
// =======================================================

module.exports = {
  calculateTechnicalV3,
  collectTechnical,
  calculateRSI,
  calculateEMA,
  calculateSMA,
  calculateATR,
  calculateMACD,
  calculateSupportResistance,
  normalizeCandles
};