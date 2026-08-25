import sys
import json
import os
from datetime import datetime, timezone
import warnings

import numpy as np
import pandas as pd
import requests
import yfinance as yf
from dotenv import load_dotenv

warnings.filterwarnings("ignore")
load_dotenv()

ALPHA_VANTAGE_API_KEY = os.getenv("ALPHA_VANTAGE_API_KEY")


def clean_symbol(symbol):
    value = str(symbol or "").strip().upper()
    value = value.replace(".NS", "").replace(".NSE", "")
    value = value.replace(".BSE", "").replace(".BO", "")
    value = "".join(value.split())
    aliases = {"HDFCBANKLTD": "HDFCBANK", "HDFCBANKLIMITED": "HDFCBANK"}
    return aliases.get(value, value)


def source_meta(provider, url=None, retrieved_at=None):
    return {"provider": provider, "url": url, "retrieved_at": retrieved_at or datetime.now(timezone.utc).isoformat()}


def fetch_yahoo(symbol):
    ticker_symbol = f"{clean_symbol(symbol)}.NS"
    ticker = yf.Ticker(ticker_symbol)
    df = ticker.history(period="1y", auto_adjust=False, actions=False)
    if df.empty:
        raise ValueError("Yahoo returned no historical data")
    df = df[["Open", "High", "Low", "Close", "Volume"]].copy().dropna(subset=["Open", "High", "Low", "Close"])
    if len(df) < 60:
        raise ValueError(f"Yahoo returned only {len(df)} rows")
    df.index = pd.to_datetime(df.index)
    return df, source_meta("Yahoo Finance", f"https://finance.yahoo.com/quote/{ticker_symbol}/history")


def fetch_alpha_vantage(symbol):
    if not ALPHA_VANTAGE_API_KEY:
        raise ValueError("ALPHA_VANTAGE_API_KEY is not configured")
    url = "https://www.alphavantage.co/query"
    params = {"function": "TIME_SERIES_DAILY", "symbol": f"{clean_symbol(symbol)}.BSE", "outputsize": "full", "apikey": ALPHA_VANTAGE_API_KEY}
    response = requests.get(url, params=params, timeout=15)
    response.raise_for_status()
    payload = response.json()
    series = payload.get("Time Series (Daily)")
    if not series:
        raise ValueError(payload.get("Note") or payload.get("Information") or "Alpha Vantage returned no daily data")
    rows = [{"Date": date, "Open": float(v["1. open"]), "High": float(v["2. high"]), "Low": float(v["3. low"]), "Close": float(v["4. close"]), "Volume": float(v["5. volume"])} for date, v in series.items()]
    df = pd.DataFrame(rows).set_index("Date").sort_index()
    df.index = pd.to_datetime(df.index)
    if len(df) < 60:
        raise ValueError(f"Alpha Vantage returned only {len(df)} rows")
    return df, source_meta("Alpha Vantage", "https://www.alphavantage.co/")


def validate_ohlcv(df):
    required = ["Open", "High", "Low", "Close", "Volume"]
    if df is None or df.empty or any(col not in df.columns for col in required):
        raise ValueError("No valid OHLCV data")
    for col in required:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    df = df[(df["High"] >= df["Low"]) & (df["High"] >= df["Open"]) & (df["High"] >= df["Close"])]
    df = df[df["Low"] <= df["Open"]]
    df = df[df["Low"] <= df["Close"]]
    df = df[df["Close"] > 0]
    if len(df) < 60:
        raise ValueError(f"Only {len(df)} valid OHLC rows after validation")
    return df.sort_index()


def fetch_market_data(symbol):
    errors = []
    for provider in (fetch_yahoo, fetch_alpha_vantage):
        try:
            df, meta = provider(symbol)
            return validate_ohlcv(df), meta, errors
        except Exception as exc:
            errors.append(f"{provider.__name__}: {exc}")
    return None, None, errors


def fetch_fundamentals(symbol):
    ticker_symbol = f"{clean_symbol(symbol)}.NS"
    url = f"https://finance.yahoo.com/quote/{ticker_symbol}/"
    try:
        info = yf.Ticker(ticker_symbol).info
        def num(key):
            value = info.get(key)
            return float(value) if value is not None and np.isfinite(value) else None
        roe = num("returnOnEquity")
        values = {"market_cap": num("marketCap"), "PE_ratio": num("trailingPE"), "PB_ratio": num("priceToBook"), "ROE": roe * 100 if roe is not None else None, "debt_to_equity": num("debtToEquity")}
        return {"values": values, "source": source_meta("Yahoo Finance", url), "status": "OK" if any(v is not None for v in values.values()) else "UNAVAILABLE"}
    except Exception as exc:
        return {"values": {"market_cap": None, "PE_ratio": None, "PB_ratio": None, "ROE": None, "debt_to_equity": None}, "source": source_meta("Yahoo Finance", url), "status": "UNAVAILABLE", "error": str(exc)}


def cluster_levels(levels, tolerance=0.008):
    clean = sorted(float(x) for x in levels if x is not None and np.isfinite(x) and x > 0)
    clusters = []
    for level in clean:
        found = None
        for cluster in clusters:
            if abs(cluster["level"] - level) / level <= tolerance:
                found = cluster
                break
        if found:
            found["values"].append(level)
            found["level"] = sum(found["values"]) / len(found["values"])
        else:
            clusters.append({"level": level, "values": [level]})
    return clusters


def calculate_support_resistance(df, price, ema20, ema50, ema200):
    lows = df["Low"].to_numpy(dtype=float)
    highs = df["High"].to_numpy(dtype=float)
    supports, resistances = [], []
    start = max(2, len(df) - 120)
    end = len(df) - 2
    for i in range(start, end):
        if lows[i] <= lows[i-1] and lows[i] <= lows[i-2] and lows[i] <= lows[i+1] and lows[i] <= lows[i+2] and lows[i] < price:
            supports.append(lows[i])
        if highs[i] >= highs[i-1] and highs[i] >= highs[i-2] and highs[i] >= highs[i+1] and highs[i] >= highs[i+2] and highs[i] > price:
            resistances.append(highs[i])
    recent_lows = df["Low"].tail(60).min()
    recent_highs = df["High"].tail(60).max()
    if recent_lows < price: supports.append(recent_lows)
    if recent_highs > price: resistances.append(recent_highs)
    for ema in (ema20, ema50, ema200):
        if ema is not None and np.isfinite(ema) and ema < price: supports.append(ema)
    support_clusters = sorted(cluster_levels(supports), key=lambda x: x["level"], reverse=True)
    resistance_clusters = sorted(cluster_levels(resistances), key=lambda x: x["level"])
    support_levels = [round(x["level"], 2) for x in support_clusters[:3]]
    resistance_levels = [round(x["level"], 2) for x in resistance_clusters[:3]]
    support = support_levels[0] if support_levels else None
    resistance = resistance_levels[0] if resistance_levels else None
    return {
        "supports": support_levels,
        "resistances": resistance_levels,
        "support": support,
        "resistance": resistance,
        "major_support": support_levels[-1] if support_levels else None,
        "major_resistance": resistance_levels[-1] if resistance_levels else None,
        "method": "120-session swing levels + 60-session extremes + EMA20/50/200; clustered within 0.8%"
    }


def calculate_trade_levels(price, atr, support, resistance, ema20):
    if price is None or not np.isfinite(price):
        return {"entry_zone": None, "stop_loss": None, "targets": [], "risk_reward_to_resistance": None}
    atr_value = float(atr) if atr is not None and np.isfinite(atr) else price * 0.03
    entry_low = max(0.01, min(price, float(ema20) if ema20 is not None and np.isfinite(ema20) else price - 0.75 * atr_value))
    entry_high = price
    if support is not None and support < price:
        entry_low = max(entry_low, float(support) * 0.995)
    stop_base = float(support) if support is not None and support < price else price - 1.5 * atr_value
    stop_loss = min(stop_base * 0.99, price - 0.75 * atr_value)
    risk = price - stop_loss
    targets = []
    if resistance is not None and resistance > price:
        targets.append(float(resistance))
    targets.extend([price + risk * 2, price + risk * 3])
    targets = sorted({round(x, 2) for x in targets if x > price})[:3]
    rr = round((resistance - price) / risk, 2) if resistance is not None and resistance > price and risk > 0 else None
    return {"entry_zone": {"low": round(entry_low, 2), "high": round(entry_high, 2)}, "stop_loss": round(stop_loss, 2), "targets": targets, "risk_reward_to_resistance": rr, "basis": "ATR + nearest validated support/resistance; scenario levels, not price guarantees"}


def calculate_technicals(df):
    if df is None or len(df) < 60:
        return {"error": "Not enough validated data"}
    close = df["Close"]
    df = df.copy()
    df["EMA_20"] = close.ewm(span=20, adjust=False).mean()
    df["EMA_50"] = close.ewm(span=50, adjust=False).mean()
    df["EMA_200"] = close.ewm(span=200, adjust=False).mean()

    # RSI(14) — Wilder RMA: seed with the first 14-period SMA, then apply Wilder smoothing.
    # This matches the standard daily RSI(14) convention used by TradingView/Investing-style indicators.
    delta = close.diff()
    gain = delta.clip(lower=0).to_numpy(dtype=float)
    loss = (-delta.clip(upper=0)).to_numpy(dtype=float)
    rsi_values = np.full(len(close), np.nan, dtype=float)
    if len(close) > 14:
        avg_gain = gain[1:15].mean()
        avg_loss = loss[1:15].mean()
        if avg_loss == 0:
            rsi_values[14] = 100.0 if avg_gain > 0 else 50.0
        else:
            rs = avg_gain / avg_loss
            rsi_values[14] = 100.0 - (100.0 / (1.0 + rs))
        for i in range(15, len(close)):
            avg_gain = ((avg_gain * 13.0) + gain[i]) / 14.0
            avg_loss = ((avg_loss * 13.0) + loss[i]) / 14.0
            if avg_loss == 0:
                rsi_values[i] = 100.0 if avg_gain > 0 else 50.0
            else:
                rs = avg_gain / avg_loss
                rsi_values[i] = 100.0 - (100.0 / (1.0 + rs))
    df["RSI_14"] = rsi_values

    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    df["MACD"] = ema12 - ema26
    df["MACD_Signal"] = df["MACD"].ewm(span=9, adjust=False).mean()
    df["MACD_Histogram"] = df["MACD"] - df["MACD_Signal"]
    tr = pd.concat([df["High"] - df["Low"], (df["High"] - close.shift()).abs(), (df["Low"] - close.shift()).abs()], axis=1).max(axis=1)
    df["ATR_14"] = tr.ewm(alpha=1/14, adjust=False).mean()
    df["AvgVolume_20"] = df["Volume"].rolling(20).mean()
    df["Volume_Ratio"] = df["Volume"] / df["AvgVolume_20"]
    latest = df.iloc[-1]
    price = float(latest["Close"])
    trend = "BULLISH" if price > latest["EMA_20"] > latest["EMA_50"] and latest["EMA_50"] > latest["EMA_200"] else "BEARISH" if price < latest["EMA_20"] < latest["EMA_50"] and latest["EMA_50"] < latest["EMA_200"] else "SIDEWAYS"
    def rounded(name):
        value = latest[name]
        return round(float(value), 2) if pd.notna(value) else None
    levels = calculate_support_resistance(df, price, latest["EMA_20"], latest["EMA_50"], latest["EMA_200"])
    trade = calculate_trade_levels(price, latest["ATR_14"], levels["support"], levels["resistance"], latest["EMA_20"])
    return {
        "current_price": rounded("Close"), "previous_close": round(float(df["Close"].iloc[-2]), 2) if len(df) > 1 else None,
        "trend": trend, "data_points": int(len(df)), "last_candle": df.index[-1].isoformat(),
        "indicators": {"RSI_14": rounded("RSI_14"), "EMA_20": rounded("EMA_20"), "EMA_50": rounded("EMA_50"), "EMA_200": rounded("EMA_200"), "MACD": rounded("MACD"), "MACD_Signal": rounded("MACD_Signal"), "MACD_Histogram": rounded("MACD_Histogram"), "ATR_14": rounded("ATR_14"), "Volume": rounded("Volume"), "AvgVolume_20": rounded("AvgVolume_20"), "Volume_Ratio": rounded("Volume_Ratio")},
        "support_resistance": levels,
        "trade_plan": trade
    }


def run_pipeline(symbol):
    clean = clean_symbol(symbol)
    try:
        hist_df, market_source, provider_errors = fetch_market_data(clean)
        if hist_df is None:
            print(json.dumps({"symbol": clean, "status": "FAILED", "error": "No validated market data available", "provider_errors": provider_errors}))
            return
        technicals = calculate_technicals(hist_df)
        fundamentals = fetch_fundamentals(clean)
        print(json.dumps({"symbol": clean, "status": "SUCCESS", "data_source": market_source, "provider_errors": provider_errors, "technicals": technicals, "fundamentals": fundamentals, "data_policy": "No Dhan dependency; no estimated values; unavailable values are null"}, default=str))
    except Exception as exc:
        print(json.dumps({"symbol": clean, "status": "FAILED", "error": str(exc)}))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "FAILED", "error": "Usage: python quant-pipeline.py SYMBOL"}))
        sys.exit(1)
    run_pipeline(sys.argv[1])
