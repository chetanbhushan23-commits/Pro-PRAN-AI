import yfinance as yf
import pandas as pd
import json
import sys
import warnings

warnings.filterwarnings("ignore")

# Humari top liquid watchlist (Nifty 50/Defence/Momentum)
SCAN_BASKET = ["RELIANCE.NS", "HAL.NS", "TRENT.NS", "ZOMATO.NS", "MAZDOCK.NS", "SBIN.NS", "TCS.NS", "BHEL.NS", "SUZLON.NS"]

def scan_stocks():
    breakout_stocks = []
    
    for stock in SCAN_BASKET:
        try:
            ticker = yf.Ticker(stock)
            # Pitchle 6 mahine ka daily data
            df = ticker.history(period="6mo")
            
            if len(df) < 50:
                continue
                
            current_close = float(df['Close'].iloc[-1])
            current_vol = float(df['Volume'].iloc[-1])
            
            # Moving Averages & Volume calculation
            avg_vol_20d = float(df['Volume'].iloc[-21:-1].mean())
            ema_50 = float(df['Close'].ewm(span=50, adjust=False).mean().iloc[-1])
            prev_high = float(df['High'].iloc[:-1].max())
            
            # THE BREAKOUT LOGIC (Volume Spurt + Bullish + Near High)
            is_volume_spurt = current_vol > (avg_vol_20d * 1.5) # 150% volume
            is_bullish = current_close > ema_50
            near_breakout = current_close > (prev_high * 0.90) # Within 10% of 6-month high
            
            if is_volume_spurt and is_bullish and near_breakout:
                breakout_stocks.append(stock.replace(".NS", ""))
                
        except Exception as e:
            continue

    # Return top 2 stocks as JSON so Node.js can read it
    if len(breakout_stocks) == 0:
        print(json.dumps(["TRENT", "HAL"])) # Fallback
    else:
        print(json.dumps(breakout_stocks[:2]))

if __name__ == "__main__":
    scan_stocks()