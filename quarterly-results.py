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


def growth(new, old):
    if new is None or old in (None, 0):
        return None
    return round((new - old) / abs(old) * 100, 2)


def run(symbol):
    clean = str(symbol or '').strip().upper().replace('.NS', '').replace('.NSE', '')
    ticker = f'{clean}.NS'
    source = {'provider': 'Yahoo Finance', 'url': f'https://finance.yahoo.com/quote/{ticker}/financials'}
    try:
        t = yf.Ticker(ticker)
        stmt = t.quarterly_income_stmt
        if stmt is None or stmt.empty:
            return {'status': 'UNAVAILABLE', 'symbol': clean, 'period': 'Last 6 months (latest 2 reported quarters)', 'source': source, 'quarters': []}

        rows = []
        for col in list(stmt.columns)[:6]:
            period = col.strftime('%Y-%m-%d') if hasattr(col, 'strftime') else str(col)[:10]

            def get(*names):
                for name in names:
                    if name in stmt.index:
                        return num(stmt.loc[name, col])
                return None

            revenue = get('Total Revenue', 'Operating Revenue')
            net_profit = get('Net Income', 'Net Income Common Stockholders')
            if revenue is None and net_profit is None:
                continue
            rows.append({
                'quarter_end': period,
                'revenue': revenue,
                'net_profit': net_profit
            })

        rows = sorted(rows, key=lambda x: x['quarter_end'], reverse=True)
        latest_two = rows[:2]
        if len(latest_two) >= 2:
            latest_two[0]['qoq_revenue_pct'] = growth(latest_two[0]['revenue'], latest_two[1]['revenue'])
            latest_two[0]['qoq_net_profit_pct'] = growth(latest_two[0]['net_profit'], latest_two[1]['net_profit'])
        else:
            for row in latest_two:
                row['qoq_revenue_pct'] = None
                row['qoq_net_profit_pct'] = None

        return {
            'status': 'OK' if latest_two else 'UNAVAILABLE',
            'symbol': clean,
            'period': 'Last 6 months (latest 2 reported quarters)',
            'source': {**source, 'retrieved_at': datetime.now(timezone.utc).isoformat()},
            'quarters': latest_two,
            'history_quarters_available': len(rows),
            'note': 'Last 6 months is represented by the latest 2 reported quarters. Revenue/Sales and Net Profit come only from reported quarterly income-statement fields; missing values remain N/A and are never estimated.'
        }
    except Exception as e:
        return {'status': 'UNAVAILABLE', 'symbol': clean, 'period': 'Last 6 months', 'source': source, 'quarters': [], 'error': str(e)}


if __name__ == '__main__':
    print(json.dumps(run(sys.argv[1] if len(sys.argv) > 1 else 'RELIANCE'), default=str))
