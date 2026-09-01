import sys
import json
import os
from datetime import datetime, timezone

import numpy as np
import yfinance as yf
from dotenv import load_dotenv

load_dotenv()

def clean_symbol(symbol):
    value = str(symbol or "").strip().upper()
    for suffix in (".NS", ".NSE", ".BSE", ".BO"):
        if value.endswith(suffix):
            value = value[:-len(suffix)]
    return "".join(value.split())

def finite_num(value):
    try:
        v = float(value)
        return v if np.isfinite(v) else None
    except Exception:
        return None

def find_row(df, names):
    if df is None or df.empty:
        return None
    for name in names:
        if name in df.index:
            return df.loc[name]
    return None

def fetch_quarterly(symbol):
    clean = clean_symbol(symbol)
    ticker_symbol = f"{clean}.NS"
    ticker = yf.Ticker(ticker_symbol)
    df = ticker.quarterly_financials
    if df is None or df.empty:
        raise ValueError("Yahoo Finance quarterly financials unavailable")
    revenue_row = find_row(df, ["Total Revenue", "Operating Revenue", "TotalRevenue"])
    profit_row = find_row(df, ["Net Income", "Net Income Common Stockholders", "NetIncome"])
    if revenue_row is None and profit_row is None:
        raise ValueError("Quarterly Revenue/Net Profit rows unavailable")

    dates = list(df.columns)
    rows = []
    for idx, dt in enumerate(dates[:6]):
        revenue = finite_num(revenue_row.iloc[idx]) if revenue_row is not None else None
        profit = finite_num(profit_row.iloc[idx]) if profit_row is not None else None
        prev_revenue = finite_num(revenue_row.iloc[idx + 1]) if revenue_row is not None and idx + 1 < len(dates) else None
        prev_profit = finite_num(profit_row.iloc[idx + 1]) if profit_row is not None and idx + 1 < len(dates) else None
        qoq_revenue = round((revenue - prev_revenue) / abs(prev_revenue) * 100, 2) if revenue is not None and prev_revenue not in (None, 0) else None
        qoq_profit = round((profit - prev_profit) / abs(prev_profit) * 100, 2) if profit is not None and prev_profit not in (None, 0) else None
        rows.append({
            "quarter_end": dt.strftime("%Y-%m-%d") if hasattr(dt, "strftime") else str(dt),
            "revenue": round(revenue, 2) if revenue is not None else None,
            "net_profit": round(profit, 2) if profit is not None else None,
            "qoq_revenue_pct": qoq_revenue,
            "qoq_net_profit_pct": qoq_profit,
        })
    return {
        "symbol": clean,
        "status": "SUCCESS",
        "period": "Latest reported quarterly financials",
        "quarters": rows,
        "source": {
            "provider": "Yahoo Finance",
            "url": f"https://finance.yahoo.com/quote/{ticker_symbol}/financials",
            "retrieved_at": datetime.now(timezone.utc).isoformat()
        },
        "note": "Reported financials only. No estimates are used. Values are in the reporting currency (normally INR for NSE stocks)."
    }

if __name__ == "__main__":
    symbol = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        print(json.dumps(fetch_quarterly(symbol), default=str))
    except Exception as exc:
        print(json.dumps({"symbol": clean_symbol(symbol), "status": "FAILED", "error": str(exc)}))
