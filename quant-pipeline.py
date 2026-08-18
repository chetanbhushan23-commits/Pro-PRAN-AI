import sys
import json
import pandas as pd
import numpy as np
import yfinance as yf
import requests
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv
import warnings

# Node.js ke parser ko bachane ke liye warnings band ki hain
warnings.filterwarnings('ignore')

load_dotenv()
client_id = os.getenv("DHAN_CLIENT_ID")       
access_token = os.getenv("DHAN_ACCESS_TOKEN") 

symbol_to_dhan_id = {
    "RELIANCE": "2885", "TCS": "11536", "HDFC": "1333", 
    "ZOMATO": "5097", "HAL": "2303", "TRENT": "3432", "SBI": "4329"
}

def fetch_market_data(symbol):
    clean_symbol = symbol.replace(".NS", "").replace(".BSE", "").upper()
    
    # 1. DHAN REST API
    if client_id and access_token:
        try:
            security_id = symbol_to_dhan_id.get(clean_symbol)
            if security_id:
                to_date = datetime.now().strftime('%Y-%m-%d')
                from_date = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')
                
                url = "https://api.dhan.co/charts/historical"
                headers = {
                    "client-id": client_id,
                    "access-token": access_token,
                    "Content-Type": "application/json"
                }
                payload = {
                    "securityId": str(security_id),
                    "exchangeSegment": "NSE_EQ",
                    "instrument": "EQUITY",
                    "expiryCode": 0,
                    "fromDate": from_date,
                    "toDate": to_date
                }
                response = requests.post(url, headers=headers, json=payload, timeout=10)
                if response.status_code == 200:
                    res_json = response.json()
                    if res_json.get('status') == 'success' and res_json.get('data'):
                        data = res_json['data']
                        df = pd.DataFrame({
                            'Open': data['open'], 'High': data['high'],
                            'Low': data['low'], 'Close': data['close'], 'Volume': data['volume'],
                        })
                        return df, "DHAN_DIRECT_API"
        except Exception:
            pass 

    # 2. YAHOO FINANCE FALLBACK
    try:
        yf_symbol = f"{clean_symbol}.NS"
        df = yf.Ticker(yf_symbol).history(period="1y")
        if not df.empty:
            return df[['Open', 'High', 'Low', 'Close', 'Volume']], "YAHOO_FINANCE_FALLBACK"
    except Exception:
        pass
        
    return None, "NO_DATA"

def fetch_fundamentals(symbol):
    clean_symbol = symbol.replace(".NS", "").replace(".BSE", "").upper()
    try:
        info = yf.Ticker(f"{clean_symbol}.NS").info
        return {
            "market_cap": info.get("marketCap", 0),
            "PE_ratio": round(info.get("trailingPE", 0), 2) if info.get("trailingPE") else "N/A",
            "PB_ratio": round(info.get("priceToBook", 0), 2) if info.get("priceToBook") else "N/A",
            "ROE": round(info.get("returnOnEquity", 0) * 100, 2) if info.get("returnOnEquity") else "N/A",
            "debt_to_equity": round(info.get("debtToEquity", 0), 2) if info.get("debtToEquity") else "N/A"
        }
    except:
        return {"error": "Fundamentals missing"}

def calculate_technicals(df):
    if df is None or len(df) < 50:
        return {"error": "Not enough data"}

    df['EMA_50'] = df['Close'].ewm(span=50, adjust=False).mean()
    delta = df['Close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = gain / loss
    df['RSI_14'] = 100 - (100 / (1 + rs))

    ema_12 = df['Close'].ewm(span=12, adjust=False).mean()
    ema_26 = df['Close'].ewm(span=26, adjust=False).mean()
    df['MACD'] = ema_12 - ema_26
    df['MACD_Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()

    latest = df.iloc[-1]
    
    trend = "BULLISH" if (latest['Close'] > latest['EMA_50'] and latest['RSI_14'] > 55) else "BEARISH" if (latest['Close'] < latest['EMA_50']) else "NEUTRAL"

    # Float casting is important for pure JSON output
    return {
        "current_price": float(round(latest['Close'], 2)),
        "trend": trend,
        "indicators": {
            "RSI": float(round(latest['RSI_14'], 2)) if not pd.isna(latest['RSI_14']) else 0,
            "MACD": float(round(latest['MACD'], 2)) if not pd.isna(latest['MACD']) else 0,
            "EMA_50": float(round(latest['EMA_50'], 2)) if not pd.isna(latest['EMA_50']) else 0
        }
    }

def run_pipeline(symbol):
    try:
        hist_df, source = fetch_market_data(symbol)
        technicals = calculate_technicals(hist_df)
        fundamentals = fetch_fundamentals(symbol)

        # Final Clean JSON for Node.js
        print(json.dumps({
            "symbol": symbol.upper(),
            "status": "SUCCESS",
            "data_source": source,
            "technicals": technicals,
            "fundamentals": fundamentals
        }))
    except Exception as e:
        print(json.dumps({"symbol": symbol, "status": "FAILED", "error": str(e)}))

if __name__ == "__main__":
    stock_symbol = sys.argv[1] if len(sys.argv) > 1 else "ZOMATO"
    run_pipeline(stock_symbol)