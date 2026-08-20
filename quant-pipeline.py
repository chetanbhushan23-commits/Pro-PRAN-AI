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
    return symbol.replace(".NS", "").replace(".BSE", "").upper().strip()


def source_meta(provider, url=None, retrieved_at=None):
    return {
        "provider": provider,
        "url": url,
        "retrieved_at": retrieved_at or datetime.now(timezone.utc).isoformat()
    }


def fetch_yahoo(symbol):
    ticker_symbol = f"{clean_symbol(symbol)}.NS"
    ticker = yf.Ticker(ticker_symbol)
    df = ticker.history(period="1y", auto_adjust=False, actions=False)
    if df.empty:
        raise ValueError("Yahoo returned no historical data")
    df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    if len(df) < 60:
        raise ValueError(f"Yahoo returned only {len(df)} rows")
    df.index = pd.to_datetime(df.index)
    return df, source_meta(
        "Yahoo Finance",
        f"https://finance.yahoo.com/quote/{ticker_symbol}/history"
    )


def fetch_alpha_vantage(symbol):
    if not ALPHA_VANTAGE_API_KEY:
        raise ValueError("ALPHA_VANTAGE_API_KEY is not configured")

    url = "https://www.alphavantage.co/query"
    params = {
        "function": "TIME_SERIES_DAILY",
        "symbol": f"{clean_symbol(symbol)}.BSE",
        "outputsize": "full",
        "apikey": ALPHA_VANTAGE_API_KEY,
    }
    response = requests.get(url, params=params, timeout=15)
    response.raise_for_status()
    payload = response.json()
    series = payload.get("Time Series (Daily)")
    if not series:
        raise ValueError(payload.get("Note") or payload.get("Information") or "Alpha Vantage returned no daily data")

    rows = []
    for date, values in series.items():
        rows.append({
            "Date": date,
            "Open": float(values["1. open"]),
            "High": float(values["2. high"]),
            "Low": float(values["3. low"]),
            "Close": float(values["4. close"]),
            "Volume": float(values["5. volume"]),
        })
    df = pd.DataFrame(rows).set_index("Date").sort_index()
    df.index = pd.to_datetime(df.index)
    if len(df) < 60:
        raise ValueError(f"Alpha Vantage returned only {len(df)} rows")
    return df, source_meta("Alpha Vantage", "https://www.alphavantage.co/")


def validate_ohlcv(df):
    required = ["Open", "High", "Low", "Close", "Volume"]
    if df is None or df.empty:
        raise ValueError("No OHLCV data")
    if any(col not in df.columns for col in required):
        raise ValueError("OHLCV columns missing")
    if df[required].isnull().all(axis=None):
        raise ValueError("OHLCV is empty")
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
            df = validate_ohlcv(df)
            return df, meta, errors
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

        values = {
            "market_cap": num("marketCap"),
            "PE_ratio": num("trailingPE"),
            "PB_ratio": num("priceToBook"),
            "ROE": (num("returnOnEquity") * 100) if num("returnOnEquity") is not None else None,
            "debt_to_equity": num("debtToEquity"),
        }
        return {
            "values": values,
            "source": source_meta("Yahoo Finance", url),
            "status": "OK" if any(v is not None for v in values.values()) else "UNAVAILABLE",
        }
    except Exception as exc:
        return {
            "values": {"market_cap": None, "PE_ratio": None, "PB_ratio": None, "ROE": None, "debt_to_equity": None},
            "source": source_meta("Yahoo Finance", url),
            "status": "UNAVAILABLE",
            "error": str(exc),
        }


def calculate_technicals(df):
    if df is None or len(df) < 60:
        return {"error": "Not enough validated data"}

    close = df["Close"]
    df = df.copy()
    df["EMA_20"] = close.ewm(span=20, adjust=False).mean()
    df["EMA_50"] = close.ewm(span=50, adjust=False).mean()
    df["EMA_200"] = close.ewm(span=200, adjust=False).mean()

    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    avg_loss = loss.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    df["RSI_14"] = 100 - (100 / (1 + rs))
    df.loc[(avg_loss == 0) & (avg_gain > 0), "RSI_14"] = 100

    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    df["MACD"] = ema12 - ema26
    df["MACD_Signal"] = df["MACD"].ewm(span=9, adjust=False).mean()
    df["MACD_Histogram"] = df["MACD"] - df["MACD_Signal"]
    df["ATR_14"] = pd.concat([
        df["High"] - df["Low"],
        (df["High"] - close.shift()).abs(),
        (df["Low"] - close.shift()).abs(),
    ], axis=1).max(axis=1).ewm(alpha=1 / 14, adjust=False).mean()
    df["AvgVolume_20"] = df["Volume"].rolling(20).mean()
    df["Volume_Ratio"] = df["Volume"] / df["AvgVolume_20"]

    latest = df.iloc[-1]
    price = float(latest["Close"])
    trend = "BULLISH" if price > latest["EMA_20"] > latest["EMA_50"] else "BEARISH" if price < latest["EMA_20"] < latest["EMA_50"] else "SIDEWAYS"

    def rounded(name):
        value = latest[name]
        return round(float(value), 2) if pd.notna(value) else None

    return {
        "current_price": rounded("Close"),
        "previous_close": round(float(df["Close"].iloc[-2]), 2) if len(df) > 1 else None,
        "trend": trend,
        "data_points": int(len(df)),
        "last_candle": df.index[-1].isoformat(),
        "indicators": {
            "RSI_14": rounded("RSI_14"),
            "EMA_20": rounded("EMA_20"),
            "EMA_50": rounded("EMA_50"),
            "EMA_200": rounded("EMA_200"),
            "MACD": rounded("MACD"),
            "MACD_Signal": rounded("MACD_Signal"),
            "MACD_Histogram": rounded("MACD_Histogram"),
            "ATR_14": rounded("ATR_14"),
            "Volume": rounded("Volume"),
            "AvgVolume_20": rounded("AvgVolume_20"),
            "Volume_Ratio": rounded("Volume_Ratio"),
        },
    }


def run_pipeline(symbol):
    clean = clean_symbol(symbol)
    try:
        hist_df, market_source, provider_errors = fetch_market_data(clean)
        if hist_df is None:
            print(json.dumps({
                "symbol": clean,
                "status": "FAILED",
                "error": "No validated market data available",
                "provider_errors": provider_errors,
            }))
            return

        technicals = calculate_technicals(hist_df)
        fundamentals = fetch_fundamentals(clean)
        print(json.dumps({
            "symbol": clean,
            "status": "SUCCESS",
            "data_source": market_source,
            "provider_errors": provider_errors,
            "technicals": technicals,
            "fundamentals": fundamentals,
            "data_policy": "No Dhan dependency; no estimated values; unavailable values are null",
        }, allow_nan=False))
    except Exception as exc:
        print(json.dumps({"symbol": clean, "status": "FAILED", "error": str(exc)}))


if __name__ == "__main__":
    stock_symbol = sys.argv[1] if len(sys.argv) > 1 else "MCX"
    run_pipeline(stock_symbol)
