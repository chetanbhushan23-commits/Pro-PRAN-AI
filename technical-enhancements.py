import sys, json
import numpy as np
import pandas as pd
import yfinance as yf


def n(v):
    try:
        x=float(v); return round(x,2) if np.isfinite(x) else None
    except: return None

def run(symbol):
    clean=str(symbol or '').strip().upper().replace('.NS','').replace('.NSE','')
    ticker=f'{clean}.NS'
    try:
        df=yf.Ticker(ticker).history(period='1y',auto_adjust=False,actions=False)
        if df.empty or len(df)<60: raise ValueError('Insufficient OHLCV history')
        h,l,c=df['High'],df['Low'],df['Close']
        tr=pd.concat([h-l,(h-c.shift()).abs(),(l-c.shift()).abs()],axis=1).max(axis=1)
        up=h.diff(); down=-l.diff()
        plus_dm=up.where((up>down)&(up>0),0.0); minus_dm=down.where((down>up)&(down>0),0.0)
        atr=tr.ewm(alpha=1/14,adjust=False).mean()
        plus_di=100*plus_dm.ewm(alpha=1/14,adjust=False).mean()/atr
        minus_di=100*minus_dm.ewm(alpha=1/14,adjust=False).mean()/atr
        dx=100*(plus_di-minus_di).abs()/(plus_di+minus_di).replace(0,np.nan)
        adx=dx.ewm(alpha=1/14,adjust=False).mean()
        ema20=c.ewm(span=20,adjust=False).mean(); ema50=c.ewm(span=50,adjust=False).mean(); ema200=c.ewm(span=200,adjust=False).mean()
        rsi_delta=c.diff(); gain=rsi_delta.clip(lower=0); loss=-rsi_delta.clip(upper=0)
        ag=gain.ewm(alpha=1/14,adjust=False).mean(); al=loss.ewm(alpha=1/14,adjust=False).mean(); rsi=100-(100/(1+(ag/al.replace(0,np.nan))))
        avgvol=df['Volume'].rolling(20).mean(); vr=df['Volume']/avgvol
        price=float(c.iloc[-1]); prev20=float(h.iloc[-21:-1].max()) if len(h)>=21 else None
        return {'status':'OK','symbol':clean,'source':{'provider':'Yahoo Finance','url':f'https://finance.yahoo.com/quote/{ticker}/history'},'trend_strength':{'ADX_14':n(adx.iloc[-1]),'plus_DI':n(plus_di.iloc[-1]),'minus_DI':n(minus_di.iloc[-1]),'label':'STRONG TREND' if adx.iloc[-1]>=25 else 'WEAK/MODERATE TREND'},'breakout':{'previous_20_day_high':n(prev20),'price':n(price),'above_previous_20_day_high':bool(prev20 is not None and price>prev20)},'momentum':{'RSI_14':n(rsi.iloc[-1]),'EMA20_slope_pct_5d':n((ema20.iloc[-1]/ema20.iloc[-6]-1)*100) if len(ema20)>6 else None,'EMA50_slope_pct_5d':n((ema50.iloc[-1]/ema50.iloc[-6]-1)*100) if len(ema50)>6 else None,'volume_ratio_20d':n(vr.iloc[-1])},'quality_rules':['ADX>=25 indicates stronger directional trend; not a buy signal by itself.','20-day breakout is confirmation only when price exceeds the previous 20-session high.','RSI, EMA slopes and volume are supporting evidence, not guarantees.']}
    except Exception as e:
        return {'status':'UNAVAILABLE','symbol':clean,'source':{'provider':'Yahoo Finance','url':f'https://finance.yahoo.com/quote/{ticker}/history'},'error':str(e)}

if __name__=='__main__': print(json.dumps(run(sys.argv[1] if len(sys.argv)>1 else 'RELIANCE'),default=str))
