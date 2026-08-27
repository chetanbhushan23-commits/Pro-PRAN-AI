# PRAN AI — Data Layer Contract v1
# This file defines the data layers required before claiming full 260-question coverage.

layers:
  1_market_basics:
    covers: [share_market, NSE, BSE, Sensex, Nifty50, Nifty500, market_cap, IPO, corporate_actions]
    mode: educational
  2_price_ohlcv:
    covers: [price, OHLC, volume, 52W_high_low]
    mode: verified_live_or_latest
  3_technical:
    covers: [trend, support, resistance, candlestick, price_action, breakout, breakdown]
    mode: calculated
  4_moving_averages:
    covers: [SMA, EMA20, EMA50, EMA200, golden_cross, death_cross]
    mode: calculated
  5_rsi:
    covers: [RSI14, overbought, oversold, divergence]
    mode: calculated
  6_volume:
    covers: [current_volume, average_volume_20, average_volume_30, volume_ratio, delivery]
    mode: verified_or_calculated
  7_fundamentals:
    covers: [revenue, sales, net_profit, EPS, PE, PB, ROE, ROCE, debt_equity, margins, EBITDA, FCF]
    mode: verified
  8_quarterly_results:
    covers: [QoQ, YoY, last_6_months_profit, last_6_months_sales, earnings_growth]
    mode: verified_historical
  9_promoter_shareholding:
    covers: [promoter_holding, holding_change, pledge]
    mode: verified_historical
  10_risk_trade_plan:
    covers: [entry, stop_loss, targets, risk_reward, position_size, invalidation]
    mode: calculated_scenario
  11_signal_engine:
    covers: [BUY, STRONG_BUY, SELL, STRONG_SELL, WAIT, pass_fail_conditions]
    mode: deterministic
  12_market_context:
    covers: [Nifty, BankNifty, global_markets, FII, DII]
    mode: verified_current
  13_fno:
    covers: [futures, option_chain, OI, PCR, max_pain, IV, Greeks]
    mode: verified_current
  14_sector_relative_strength:
    covers: [sector_strength, sector_rotation, relative_strength, strong_sector_stock]
    mode: calculated_plus_verified
  15_news_events_sentiment:
    covers: [news, orders, buyback, merger, acquisition, dividend, RBI, policy, rates, crude, gold]
    mode: verified_plus_AI_summary
  16_ai_reasoning_guardrails:
    covers: [intent_routing, evidence_only, missing_data_NA, source_attribution, no_guarantee]
    mode: AI_control

question_coverage:
  basics: [1-20]
  trading: [21-40]
  technical: [41-60]
  moving_average: [61-75]
  rsi: [76-90]
  volume: [91-105]
  fundamental: [106-130]
  quarterly_results: [131-144]
  signal: [145-160]
  risk: [161-175]
  fno: [176-195]
  market: [196-210]
  sector: [211-222]
  news_events: [223-236]
  stock_analyzer: [237-260]
