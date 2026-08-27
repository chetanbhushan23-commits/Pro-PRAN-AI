// PRAN AI Universal Question Taxonomy v2
// 260 Hindi/Hinglish/English question families -> intent routing.
// The AI may answer any natural-language variation, not only these exact examples.

const INTENTS = {
  BASICS:["share market","nse","bse","share","stock","sensex","nifty 50","nifty 500","market cap","large cap","mid cap","small cap","equity","ipo","fpo","bonus","stock split","rights issue","dividend","face value","book value"],
  TRADING:["trading","investing","intraday","swing","positional","scalping","delivery","btst","stbt","short selling","long position","short position","entry point","exit point","stop loss","target price","risk reward","trailing stop","partial profit"],
  TECHNICAL:["technical analysis","candlestick","green candle","red candle","doji","hammer","shooting star","engulfing","support","resistance","breakout","breakdown","false breakout","trend","uptrend","downtrend","sideways","higher high","higher low","lower high","lower low","trendline","price action"],
  EMA:["moving average","sma","ema","20 ema","50 ema","200 ema","golden cross","death cross","ema support","ema resistance","ema confirmation"],
  RSI:["rsi","overbought","oversold","rsi divergence","bullish divergence","bearish divergence"],
  VOLUME:["volume","average volume","20 days average volume","30 days average volume","volume breakout","delivery volume","volume ratio"],
  FUNDAMENTAL:["fundamental","sales","revenue","net profit","profit","eps","p/e","pe ratio","p/b","pb ratio","roe","roce","debt to equity","debt","operating margin","net profit margin","ebitda","free cash flow","promoter holding","promoter pledge","cash flow","quarterly results","6 months results"],
  RESULTS:["quarterly result","qoq","yoy","revenue qoq","revenue yoy","profit qoq","profit yoy","ebitda margin","earnings growth","sustainable growth"],
  SIGNAL:["buy","sell","hold","wait","strong buy","strong sell","signal","conditions","technical score","fundamental score","overall score"],
  RISK:["risk management","position size","capital","risk","1% risk","risk reward","overtrading","revenge trading","fomo","stop loss","portfolio","diversification","concentration risk"],
  OPTIONS:["futures","options","call option","put option","strike price","expiry","premium","option chain","open interest","oi","pcr","max pain","hedging","implied volatility","option greeks"],
  MARKET:["nifty","bank nifty","market trend","global market","us market","fii","dii"],
  SECTOR:["sector","sector rotation","banking","it sector","pharma","auto","metal","fmcg","relative strength","strong sector","strong stock"],
  NEWS:["news","order","buyback","merger","acquisition","dividend announcement","government policy","rbi policy","interest rate","crude oil","gold"]
};

const UNIVERSAL_RULES = [
  "Understand the user's intent even when wording differs from the examples.",
  "Resolve stock symbol from explicit symbol, common company name/alias, or active analysis context.",
  "For educational questions, explain concept simply in Hindi/Hinglish/English and use an example.",
  "For live/stock-specific questions, use only verified supplied data; never invent values.",
  "Separate factual calculated data from AI interpretation.",
  "For unavailable historical data, say N/A and identify the missing dataset.",
  "For Buy/Sell/Wait, explain evidence, passed/failed conditions, risk and invalidation; never guarantee returns.",
  "For multi-part questions, answer every sub-question in numbered format.",
  "For ambiguous questions, make the smallest reasonable assumption and state it; ask for clarification only when the stock/timeframe is essential."
];

function classifyQuestion(question){
  const q=String(question||"").toLowerCase();
  const matches=[];
  for(const [intent,terms] of Object.entries(INTENTS)){
    const score=terms.reduce((n,t)=>n+(q.includes(t)?1:0),0);
    if(score) matches.push({intent,score});
  }
  return matches.sort((a,b)=>b.score-a.score);
}

const LAYER_MAP = {
 BASICS:"1_market_basics", TRADING:"2_price_ohlcv", TECHNICAL:"3_technical", EMA:"4_moving_averages",
 RSI:"5_rsi", VOLUME:"6_volume", FUNDAMENTAL:"7_fundamentals", RESULTS:"8_quarterly_results",
 SIGNAL:"11_signal_engine", RISK:"10_risk_trade_plan", OPTIONS:"13_fno", MARKET:"12_market_context",
 SECTOR:"14_sector_relative_strength", NEWS:"15_news_events_sentiment"
};
function routeQuestion(question){
 const intents=classifyQuestion(question);
 return {intents, layers:[...new Set(intents.map(x=>LAYER_MAP[x.intent]).filter(Boolean))], universal:true};
}
module.exports={INTENTS,UNIVERSAL_RULES,LAYER_MAP,classifyQuestion,routeQuestion};
