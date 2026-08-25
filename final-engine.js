"use strict";
require("dotenv").config();
const { execFile } = require("child_process");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { analyzeSentiment } = require("./sentiment.js");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

function py(file, symbol) {
  return new Promise(resolve => execFile("python3", [file, String(symbol).replace(/[^A-Za-z0-9._-]/g, "")], {timeout:60000}, (error, stdout) => {
    if (error) return resolve({status:"UNAVAILABLE", error:error.message});
    try { resolve(JSON.parse(stdout.trim())); } catch { resolve({status:"UNAVAILABLE", error:"Invalid JSON"}); }
  }));
}
function getQuantData(symbol) { return py("quant-pipeline.py", symbol); }
function buildHardTechnicalFacts(q) {
  const t=q?.technicals, i=t?.indicators;
  if(!t||!i) return {status:"UNAVAILABLE"};
  const p=t.current_price;
  const bull=p>i.EMA_20&&i.EMA_20>i.EMA_50&&i.EMA_50>i.EMA_200;
  const bear=p<i.EMA_20&&i.EMA_20<i.EMA_50&&i.EMA_50<i.EMA_200;
  return {status:"VERIFIED",price:p,trend:t.trend,ema_stack:bull?"BULLISH: Price > EMA20 > EMA50 > EMA200":bear?"BEARISH: Price < EMA20 < EMA50 < EMA200":"MIXED",rsi:i.RSI_14,macd:i.MACD_Histogram,volume_ratio:i.Volume_Ratio,support_resistance:t.support_resistance,trade_plan:t.trade_plan,hard_rule:bull?"Do not describe setup as bearish.":bear?"Do not describe setup as bullish.":"Describe setup as mixed only."};
}
function buildScore(q,s){
  const i=q?.technicals?.indicators,f=q?.fundamentals?.values;if(!i)return {status:"INCOMPLETE"};
  let technical=5;if(["BULLISH","STRONG_BULLISH"].includes(q.technicals.trend))technical+=2;if(i.RSI_14>=50&&i.RSI_14<70)technical++;if(i.MACD_Histogram>0)technical++;if(i.Volume_Ratio>=1.5)technical++;technical=Math.min(10,technical);
  let fundamental=null;if(f){fundamental=5;if(f.debt_to_equity!=null&&f.debt_to_equity<1)fundamental+=1.5;if(f.ROE!=null&&f.ROE>=15)fundamental+=1.5;if(f.PE_ratio>0&&f.PE_ratio<35)fundamental++;if(f.PB_ratio>0&&f.PB_ratio<8)fundamental++;fundamental=Math.min(10,fundamental);}
  return {status:"PARTIAL",technical:Number(technical.toFixed(2)),fundamental:fundamental==null?null:Number(fundamental.toFixed(2)),sentiment:s?.score??null,market_sector:null,note:"Market/Sector/OI N/A unless verified data exists."};
}
function formatSources(q,s,extra){const a=[];if(q?.data_source?.url)a.push(q.data_source);if(q?.fundamentals?.source?.url)a.push(q.fundamentals.source);if(extra?.source?.url)a.push(extra.source);for(const x of s?.articles||[])if(x.url)a.push({provider:x.source,url:x.url,published_at:x.publishedAt,title:x.title});return a;}

async function generateFinalReport(symbol){
  const clean=String(symbol||"").toUpperCase();
  console.log(`Starting enhanced analysis for ${clean}`);
  const [q,s,quarterly,enhanced]=await Promise.all([getQuantData(clean),analyzeSentiment(clean),py("quarterly-results.py",clean),py("technical-enhancements.py",clean)]);
  if(!q||q.status!=="SUCCESS"){console.log(JSON.stringify(q,null,2));return;}
  const hard=buildHardTechnicalFacts(q),score=buildScore(q,s);
  const context={symbol:clean,quant_data:q,verified_technical_facts:hard,deterministic_score:score,enhanced_technical:enhanced,quarterly_results:quarterly,news_sentiment:s,sources:formatSources(q,s,quarterly)};
  const prompt=`You are an evidence-first Indian Stock Market Quant Analyst. Analyze ONLY supplied JSON for ${clean}.

NON-NEGOTIABLE:
- Never invent, estimate or fill missing numbers.
- Null/unavailable = N/A.
- Never contradict verified EMA/trend facts.
- Support/resistance and trade levels ONLY from supplied validated data.
- Enhanced technical metrics (ADX, DI, 20-day breakout, EMA slopes, volume) are confirmation signals, not guarantees.
- Quarterly revenue and net profit MUST come only from quarterly_results. Do not invent EPS or other results.
- Last 6 months means the latest 2 reported quarters. Show quarter-end dates.
- Clearly label Yahoo Finance as the current financial/market data source. If company/NSE/BSE filing data is later available, it should take precedence over aggregator data.

OUTPUT IN SHORT, EASY HINDI/HINGLISH. Highlight main points. Do NOT produce a long research essay.

FORMAT:
1. 🟢 FINAL VIEW — BUY / WAIT / SELL + one-line reason.
2. 📊 TECHNICAL — Trend, RSI, EMA20/50/200, MACD, ADX, breakout, volume, support/resistance. Mark STRONG/WEAK signals.
3. 💰 QUARTERLY RESULTS — table with latest 2 quarters (last 6 months): Quarter | Sales/Revenue | Net Profit. Add QoQ change only if both comparable values exist; otherwise N/A.
4. 🧾 FUNDAMENTAL — PE, PB, ROE, Debt/Equity only if supplied.
5. 🎯 LEVELS — Entry, Stop Loss, Target 1/2/3 and risk/reward when supplied. Say scenario, not guarantee.
6. ⚠️ RISKS — maximum 3 bullets.
7. 🔎 SOURCES — only supplied URLs.
Keep the report concise and easy to scan.

VERIFIED DATA:
${JSON.stringify(context,null,2)}`;
  try{const r=await geminiModel.generateContent(prompt);console.log(r.response.text());}catch(e){console.error("Gemini API Error:",e.message);}
}
if(require.main===module)generateFinalReport(process.argv[2]||"MCX");
module.exports={generateFinalReport,getQuantData};
