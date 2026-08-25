import sys, json
from datetime import datetime, timezone
import numpy as np
import yfinance as yf


def num(v):
    try:
        x = float(v)
        return round(x, 2) if np.isfinite(x) else None
    except Exception:
        return None


def run(symbol):
    clean = str(symbol or '').strip().upper().replace('.NS','').replace('.NSE','')
    ticker = f'{clean}.NS'
    try:
        t = yf.Ticker(ticker)
        stmt = t.quarterly_income_stmt
        if stmt is None or stmt.empty:
            return {'status':'UNAVAILABLE','symbol':clean,'source':{'provider':'Yahoo Finance','url':f'https://finance.yahoo.com/quote/{ticker}/financials'},'quarters':[]}
        rows=[]
        for col in list(stmt.columns)[:4]:
            period = col.strftime('%Y-%m-%d') if hasattr(col,'strftime') else str(col)[:10]
            def get(name):
                if name not in stmt.index: return None
                return num(stmt.loc[name, col])
            revenue = get('Total Revenue')
            net = get('Net Income')
            if revenue is None and net is None: continue
            rows.append({'quarter_end':period,'revenue':revenue,'net_profit':net})
        rows = sorted(rows, key=lambda x:x['quarter_end'], reverse=True)[:2]
        return {'status':'OK' if rows else 'UNAVAILABLE','symbol':clean,'period':'Last 6 months (latest 2 reported quarters)','source':{'provider':'Yahoo Finance','url':f'https://finance.yahoo.com/quote/{ticker}/financials','retrieved_at':datetime.now(timezone.utc).isoformat()},'quarters':rows,'note':'Revenue and net profit are taken from reported quarterly income-statement fields. Values are not estimated.'}
    except Exception as e:
        return {'status':'UNAVAILABLE','symbol':clean,'period':'Last 6 months','source':{'provider':'Yahoo Finance','url':f'https://finance.yahoo.com/quote/{ticker}/financials'},'quarters':[],'error':str(e)}

if __name__ == '__main__':
    print(json.dumps(run(sys.argv[1] if len(sys.argv)>1 else 'RELIANCE'), default=str))
