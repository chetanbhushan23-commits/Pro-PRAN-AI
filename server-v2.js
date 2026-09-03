"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { execFile } = require("child_process");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");

const { analyzeSentiment } = require("./sentiment.js");
const { saveReport, getReports } = require("./report-history.js");
const { buildResearchQuality } = require("./research-quality.js");
const { classifyQuestion, UNIVERSAL_RULES } = require("./universal-question-taxonomy.js");

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const geminiKey = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
const groqKey = String(process.env.GROQ_API_KEY || "").trim();
const geminiModelName = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const groqModelName = String(process.env.GROQ_MODEL || "openai/gpt-oss-20b").trim();
const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
const geminiModel = genAI ? genAI.getGenerativeModel({ model: geminiModelName }) : null;
const groq = groqKey ? new Groq({ apiKey: groqKey }) : null;

function providerStatus() {
  return {
    gemini: { configured: !!geminiKey, model: geminiKey ? geminiModelName : null },
    groq: { configured: !!groqKey, model: groqKey ? groqModelName : null },
    active_provider: geminiModel ? "GEMINI" : groq ? "GROQ" : "NONE"
  };
}

function normalizeSymbol(s) {
  return String(s || "").trim().toUpperCase()
    .replace(/\\.(NS|NSE|BSE|BO)$/i, "")
    .replace(/[^A-Z0-9&-]/g, "");
}

function runPython(args) {
  return new Promise(resolve => {
    execFile(
      String(process.env.PYTHON_EXECUTABLE || (process.platform === "win32" ? "python.exe" : "python3")),
      [path.join(__dirname, "quant-pipeline.py"), ...args],
      { cwd: __dirname, timeout: Number(process.env.PYTHON_TIMEOUT_MS || 90000), maxBuffer: 8 * 1024 * 1024, env: process.env },
      (error, stdout, stderr) => resolve({ error, stdout: stdout || "", stderr: stderr || "" })
    );
  });
}

function parseJson(stdout) {
  const s = String(stdout || "").trim();
  try { return JSON.parse(s); } catch (_) {}
  const lines = s.split(/\\r?\\n/).map(x => x.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch (_) {}
  }
  throw new Error("Quant pipeline returned invalid JSON");
}

async function getQuantData(symbol) {
  const clean = normalizeSymbol(symbol);
  if (!clean) return { status: "FAILED", error: "Stock symbol is required." };
  const result = await runPython([clean]);
  if (result.error && !result.stdout.trim()) {
    return { status: "FAILED", error: result.error.message, stderr: result.stderr.slice(0, 2000) };
  }
  try {
    const data = parseJson(result.stdout);
    return data?.status === "SUCCESS" ? data : { status: "FAILED", error: data?.error || "Quant data unavailable.", raw: data };
  } catch (e) {
    return { status: "FAILED", error: e.message, stderr: result.stderr.slice(0, 2000) };
  }
}

function finite(v) { return v != null && Number.isFinite(Number(v)); }
function n(v, d = 2) { return finite(v) ? Number(Number(v).toFixed(d)) : null; }

function buildSignal(q) {
  const t = q?.technicals || {};
  const i = t?.indicators || {};
  const sr = t?.support_resistance || {};
  const price = Number(t.current_price);
  const ema20 = Number(i.EMA_20), ema50 = Number(i.EMA_50), ema200 = Number(i.EMA_200);
  const rsi = Number(i.RSI_14), vr = Number(i.Volume_Ratio);
  const recentHigh20 = Number(i.Recent_High_20);
  const previousHigh20 = Number(i.Previous_High_20);
  const breakout = finite(recentHigh20) && price > recentHigh20;
  const trendBull = [price, ema20, ema50].every(Number.isFinite) && price > ema20 && ema20 > ema50;
  const trendBear = [price, ema20, ema50].every(Number.isFinite) && price < ema20 && ema20 < ema50;
  const rsiBuy = finite(rsi) && rsi >= 30 && rsi <= 55;
  const rsiStrong = finite(rsi) && rsi > 55 && rsi < 70;
  const volumeStrong = finite(vr) && vr >= 1.5;
  const emaGap = finite(ema20) ? ((price - ema20) / ema20) * 100 : null;
  const nearEma20 = finite(emaGap) && emaGap >= 0 && emaGap <= 2;
  const support = finite(sr.support) ? Number(sr.support) : null;
  const supportBounce = finite(support) && price > support && ((price - support) / price) <= 0.03;
  const buyConditions = [
    { key: "trend", label: "Price > EMA20 > EMA50", passed: trendBull },
    { key: "rsi", label: "RSI 30–55 recovery zone", passed: rsiBuy },
    { key: "volume", label: "Volume >= 1.5x average", passed: volumeStrong },
    { key: "support", label: "Price near/above validated support", passed: supportBounce },
    { key: "ema_gap", label: "Price 0–2% above EMA20", passed: nearEma20 }
  ];
  const sellConditions = [
    { key: "trend", label: "Price < EMA20 < EMA50", passed: trendBear },
    { key: "rsi", label: "RSI below 45", passed: finite(rsi) && rsi < 45 },
    { key: "macd", label: "MACD histogram negative", passed: finite(i.MACD_Histogram) && Number(i.MACD_Histogram) < 0 },
    { key: "volume", label: "Volume >= 1.5x average", passed: volumeStrong }
  ];
  const buyCount = buyConditions.filter(x => x.passed).length;
  const sellCount = sellConditions.filter(x => x.passed).length;
  const recommendation = buyCount >= 4 ? "STRONG BUY" : buyCount >= 3 ? "BUY" : sellCount >= 3 ? "SELL" : "WAIT";
  let breakoutGenuine = "NO";
  if (breakout) {
    breakoutGenuine = volumeStrong && finite(i.RSI_14) && Number(i.RSI_14) > 50 && finite(i.MACD_Histogram) && Number(i.MACD_Histogram) > 0 ? "YES" : "WEAK / UNCONFIRMED";
  }
  const risk = finite(t.trade_plan?.stop_loss) ? price - Number(t.trade_plan.stop_loss) : null;
  const rr = finite(t.trade_plan?.risk_reward_to_resistance) ? Number(t.trade_plan.risk_reward_to_resistance) : null;
  return {
    recommendation, buy_count: buyCount, sell_count: sellCount, breakout, breakout_genuine: breakoutGenuine,
    conditions: { buy: buyConditions, sell: sellConditions },
    ema_gap_percent: n(emaGap), risk_per_share: n(risk), risk_reward: n(rr),
    entry: t.trade_plan?.entry_zone || null, stop_loss: n(t.trade_plan?.stop_loss),
    targets: (t.trade_plan?.targets || []).map(x => n(x)).filter(finite)
  };
}

function buildScores(q, sentiment) {
  const i = q?.technicals?.indicators || {};
  const t = q?.technicals || {};
  let technical = 5;
  if (t.trend === "BULLISH") technical += 2;
  if (t.trend === "BEARISH") technical -= 2;
  if (finite(i.RSI_14) && Number(i.RSI_14) >= 50 && Number(i.RSI_14) < 70) technical += 1;
  if (finite(i.RSI_14) && Number(i.RSI_14) < 30) technical -= 1;
  if (finite(i.MACD_Histogram)) technical += Number(i.MACD_Histogram) > 0 ? 1 : -1;
  if (finite(i.Volume_Ratio) && Number(i.Volume_Ratio) >= 1.5) technical += 1;
  technical = Math.max(0, Math.min(10, technical));
  const f = q?.fundamentals?.values || {};
  let fundamental = null;
  if ([f.PE_ratio, f.PB_ratio, f.ROE, f.debt_to_equity].some(finite)) {
    fundamental = 5;
    if (finite(f.debt_to_equity) && Number(f.debt_to_equity) < 1) fundamental += 1.5;
    if (finite(f.ROE) && Number(f.ROE) >= 15) fundamental += 1.5;
    if (finite(f.PE_ratio) && Number(f.PE_ratio) > 0 && Number(f.PE_ratio) < 35) fundamental += 1;
    if (finite(f.PB_ratio) && Number(f.PB_ratio) > 0 && Number(f.PB_ratio) < 8) fundamental += 1;
    fundamental = Math.min(10, fundamental);
  }
  const sentimentScore = finite(sentiment?.score) ? Number(sentiment.score) : null;
  const overallParts = [technical, fundamental, sentimentScore].filter(finite);
  const overall = overallParts.length ? n(overallParts.reduce((a,b)=>a+b,0)/overallParts.length) : null;
  return { technical: n(technical), fundamental: n(fundamental), sentiment: n(sentimentScore), market_sector: null, overall, scale: "0-10" };
}

function extractSymbol(question, fallback) {
  if (fallback) return normalizeSymbol(fallback);
  const q = String(question || "").toUpperCase();
  const aliases = {
    "RELIANCE": "RELIANCE", "RIL": "RELIANCE", "HDFC BANK": "HDFCBANK", "HDFCBANK": "HDFCBANK",
    "ICICI BANK": "ICICIBANK", "ICICIBANK": "ICICIBANK", "INFOSYS": "INFY", "INFY": "INFY",
    "TCS": "TCS", "SBIN": "SBIN", "SBI": "SBIN", "ITC": "ITC", "TATA MOTORS": "TATAMOTORS",
    "TATAMOTORS": "TATAMOTORS", "MCX": "MCX", "AXISBANK": "AXISBANK", "WIPRO": "WIPRO",
    "HCLTECH": "HCLTECH", "SUNPHARMA": "SUNPHARMA", "MARUTI": "MARUTI", "TATASTEEL": "TATASTEEL"
  };
  for (const [key, value] of Object.entries(aliases)) if (q.includes(key)) return value;
  const tokens = q.match(/\\b[A-Z][A-Z0-9&-]{1,11}\\b/g) || [];
  const stop = new Set(["KYA","KYU","KYUN","KAISE","KA","KE","KI","KO","ME","MEIN","HAI","HUA","HUI","BATAO","BTAO","SHARE","STOCK","PRICE","RSI","EMA","SUPPORT","RESISTANCE","TREND","VOLUME","BREAKOUT","BUY","SELL","WAIT","TARGET","STOP","LOSS","PROFIT","SALES","PROMOTER","HOLDING","DEBT","RISK","REWARD","SCORE","FUNDAMENTAL","TECHNICAL","TODAY","NEXT","WEEK","WEEKS","MONTH","MONTHS","ANALYSIS","REPORT","STRONG","Genuine","GENUINE"]);
  return tokens.find(x => !stop.has(x)) || "";
}

function makeContext(symbol, q, sentiment, signal, scores, quality) {
  return {
    symbol, generated_at: new Date().toISOString(),
    market_data: q?.technicals || null,
    fundamentals: q?.fundamentals || null,
    signal, scores,
    sentiment: sentiment ? {
      sentiment: sentiment.sentiment, score: sentiment.score, summary: sentiment.summary,
      articles: (sentiment.articles || []).slice(0, 15).map(a => ({
        title: a.title, source: a.source || a.publisher, provider: a.provider,
        publishedAt: a.publishedAt, relevance: a.relevance, url: a.url
      }))
    } : null,
    research_quality: quality || null,
    data_policy: "Use only supplied verified/calculated data. Missing values are N/A. Never invent unavailable fundamentals, quarterly results, promoter history, FII/DII, OI or sector data."
  };
}

function questionPrompt(question, context) {
  const intents = classifyQuestion(question);
  return `You are PRAN AI, an evidence-first Indian stock research assistant. Answer the user's question directly in the user's language (Hindi/Hinglish/English).

USER QUESTION:
${question}

RULES:
1. Use ONLY the supplied context. Never invent numbers, quarterly results, promoter holding changes, debt trend, OI, FII/DII, sector data, targets or news.
2. If the question asks for a value that is not supplied, say "N/A — verified data available nahi hai" and explain what is missing.
3. For "why STRONG BUY/SELL", explicitly list passed and failed conditions from signal.conditions and distinguish deterministic rules from AI commentary.
4. For RSI/EMA/volume/support/resistance/breakout/RR/entry/SL/target, give the exact supplied/calculated values and a one-line interpretation.
5. For 6-month profit/sales/promoter/debt questions, use only historical fundamental data if present; otherwise clearly say unavailable. Do not infer a trend from a single current ratio.
6. For "today trend", use the latest validated daily candle in market_data.last_candle and trend.
7. For "breakout genuine", use signal.breakout_genuine and explain volume, RSI and MACD evidence.
8. For scores, show the scale and components. Do not imply the score predicts returns.
9. If the user asks a broad question such as "is this good for swing trading?", combine trend, RSI, EMA, volume, breakout, support/resistance and risk/reward from context.
10. Be concise but complete. Prefer a numbered answer when the question contains multiple subquestions.
11. Never promise a win rate or guaranteed return. This is research, not a guaranteed trade.

SUPPLIED CONTEXT:
${JSON.stringify(context, null, 2)}`;
}

async function ai(prompt) {
  if (geminiModel) {
    try {
      const r = await geminiModel.generateContent(prompt);
      const t = r?.response?.text?.();
      if (t) return { text: t.trim(), provider: "GEMINI", model: geminiModelName };
    } catch (e) { console.error("Gemini:", e.message); }
  }
  if (groq) {
    try {
      const r = await groq.chat.completions.create({
        model: groqModelName,
        messages: [
          { role: "system", content: "You are PRAN AI, an evidence-first Indian stock research assistant." },
          { role: "user", content: prompt }
        ],
        temperature: 0.1, max_tokens: 7000
      });
      const t = r?.choices?.[0]?.message?.content?.trim();
      if (t) return { text: t, provider: "GROQ", model: groqModelName };
    } catch (e) { console.error("Groq:", e.message); }
  }
  return { text: null, provider: "DETERMINISTIC", model: null };
}

function deterministicAnswer(question, context) {
  const s = context.signal, t = context.market_data || {}, i = t.indicators || {};
  const q = String(question || "").toLowerCase();
  if (q.includes("rsi")) return `RSI(14): ${i.RSI_14 ?? "N/A"}. Latest daily RSI supplied by the validated quant pipeline.`;
  if (q.includes("trend")) return `Trend: ${t.trend || "N/A"}. Price ${t.current_price ?? "N/A"}, EMA20 ${i.EMA_20 ?? "N/A"}, EMA50 ${i.EMA_50 ?? "N/A"}.`;
  if (q.includes("support") || q.includes("resistance")) return `Support: ${t.support_resistance?.support ?? "N/A"} | Resistance: ${t.support_resistance?.resistance ?? "N/A"}.`;
  return "AI provider unavailable. Verified context is available, but a natural-language answer could not be generated.";
}

async function researchFor(symbol) {
  const q = await getQuantData(symbol);
  if (q.status !== "SUCCESS") throw new Error(q.error || "Validated market data unavailable.");
  let sentiment;
  try { sentiment = await analyzeSentiment(symbol); } catch (_) {
    sentiment = { sentiment: "N/A", score: null, summary: "News sentiment unavailable.", articles: [] };
  }
  const signal = buildSignal(q);
  const scores = buildScores(q, sentiment);
  let quality = null;
  try { quality = buildResearchQuality(symbol, q, sentiment); } catch (_) {}
  return { q, sentiment, signal, scores, quality, context: makeContext(symbol, q, sentiment, signal, scores, quality) };
}


app.get("/api/search-stocks", async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) return res.json({ success: true, query: "", results: [] });
  const clean = query.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let universe = [];
  try {
    universe = require("./stock-universe.json").stocks || [];
  } catch (_) {}
  function distance(a,b){
    const m=a.length,n=b.length,dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
    for(let i=0;i<=m;i++)dp[i][0]=i;
    for(let j=0;j<=n;j++)dp[0][j]=j;
    for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
    return dp[m][n];
  }
  const local = universe.map(s => {
    const sym=String(s.symbol||"").toUpperCase();
    let score=999;
    if(sym===clean)score=0;
    else if(sym.startsWith(clean))score=10+sym.length-clean.length;
    else if(sym.includes(clean))score=30+sym.indexOf(clean);
    else {
      const max=clean.length<=4?1:clean.length<=7?2:3;
      const d=distance(clean,sym.slice(0,Math.max(clean.length,sym.length)));
      if(d<=max)score=60+d*5+Math.abs(sym.length-clean.length);
    }
    return score<999?{symbol:sym,exchange:s.exchange||"NSE",score}:null;
  }).filter(Boolean);
  try {
    const r=await fetch("https://query1.finance.yahoo.com/v1/finance/search?q="+encodeURIComponent(query)+"&quotesCount=10&newsCount=0");
    if(r.ok){
      const j=await r.json();
      for(const x of (j?.quotes||[])){
        const sym=String(x.symbol||"").replace(/\.NS$/i,"").toUpperCase();
        if(!sym || !universe.some(s=>String(s.symbol).toUpperCase()===sym))continue;
        const row=local.find(v=>v.symbol===sym);
        if(row){row.companyName=x.longname||x.shortname||row.companyName;row.score=Math.min(row.score,5);}
      }
    }
  }catch(_){}
  const results=local.sort((a,b)=>a.score-b.score||a.symbol.localeCompare(b.symbol)).slice(0,10);
  return res.json({success:true,query,results});
});

app.get("/api/ask", async (req, res) => {
  const question = String(req.query.question || "").trim();
  const symbol = extractSymbol(question, req.query.symbol);
  if (!question) return res.status(400).json({ success: false, error: "Question is required." });
  if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol nahi mila. Question ke saath symbol bhi likhiye, jaise: INFY ka RSI kya hai?" });
  try {
    const r = await researchFor(symbol);
    const result = await ai(questionPrompt(question, r.context));
    return res.json({
      success: true, question, symbol, answer: result.text || deterministicAnswer(question, r.context),
      provider: result.provider, model: result.model, data: r.context
    });
  } catch (e) {
    return res.status(502).json({ success: false, error: e.message });
  }
});

app.get("/api/analyze", async (req, res) => {
  const symbol = normalizeSymbol(req.query.symbol);
  if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });
  try {
    const r = await researchFor(symbol);
    const reportPrompt = questionPrompt(
      `Create a complete stock report for ${symbol}. Cover: today's trend, support/resistance, RSI, Price vs EMA20/EMA50, volume vs average, breakout and genuine breakout, risk-reward, BUY/SELL/WAIT, why the signal was given, all signal conditions, Technical/Fundamental/Overall score, 6-month profit/sales/promoter/debt data if available, biggest risk/positive factor, next 2–3 week setup, swing suitability, entry/stop-loss/targets.`,
      r.context
    );
    const result = await ai(reportPrompt);
    const report = result.text || deterministicAnswer("Give complete stock analysis", r.context);
    const history = saveReport(symbol, { report, data: r.context });
    return res.json({
      success: true, report, data: {
        symbol, quantData: r.q, sentimentData: r.sentiment,
        verifiedTechnicalFacts: {
          trend: r.q.technicals?.trend,
          ema_stack: `Price ${r.q.technicals?.current_price ?? "N/A"} vs EMA20 ${r.q.technicals?.indicators?.EMA_20 ?? "N/A"} vs EMA50 ${r.q.technicals?.indicators?.EMA_50 ?? "N/A"}`,
          rsi: r.q.technicals?.indicators?.RSI_14, volume_ratio: r.q.technicals?.indicators?.Volume_Ratio
        },
        deterministicScore: r.scores, signal: r.signal, researchQuality: r.quality,
        sources: (r.sentiment?.articles || []).filter(a => a.url).map(a => ({
          type: "news", provider: a.provider, publisher: a.source, url: a.url,
          published_at: a.publishedAt, title: a.title
        })),
        ai_used: result.provider, ai_model: result.model
      }, history
    });
  } catch (e) {
    return res.status(502).json({ success: false, error: e.message });
  }
});

app.get("/api/history", (req, res) => {
  const symbol = normalizeSymbol(req.query.symbol);
  if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });
  try { return res.json({ success: true, ...getReports(symbol) }); }
  catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

app.get("/api/research-quality", async (req, res) => {
  const symbol = normalizeSymbol(req.query.symbol);
  if (!symbol) return res.status(400).json({ success: false, error: "Stock symbol is required." });
  try {
    const r = await researchFor(symbol);
    return res.json({ success: true, researchQuality: r.quality });
  } catch (e) { return res.status(502).json({ success: false, error: e.message }); }
});

/* =========================================================
   QUARTERLY RESULTS API
   Directly registered in server-v2.js because Railway's Dockerfile
   starts this file directly (no require-hook).
========================================================= */
app.get("/api/quarterly", async (req, res) => {
  const symbol = normalizeSymbol(req.query.symbol);
  if (!symbol) {
    return res.status(400).json({ success: false, error: "Stock symbol is required." });
  }

  const python = String(
    process.env.PYTHON_EXECUTABLE ||
    (process.platform === "win32" ? "python.exe" : "python3")
  ).trim();
  const script = path.join(__dirname, "quarterly-pipeline.py");

  try {
    const result = await new Promise(resolve => {
      execFile(
        python,
        [script, symbol],
        {
          cwd: __dirname,
          timeout: Number(process.env.QUARTERLY_TIMEOUT_MS || 90000),
          maxBuffer: 4 * 1024 * 1024,
          env: process.env
        },
        (error, stdout, stderr) => resolve({
          error,
          stdout: String(stdout || ""),
          stderr: String(stderr || "")
        })
      );
    });

    const raw = result.stdout.trim();
    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (_) {
        const lines = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try { data = JSON.parse(lines[i]); break; } catch (_) {}
        }
      }
    }

    if (!data) {
      return res.status(502).json({
        success: false,
        error: "Quarterly pipeline returned invalid JSON.",
        detail: result.stderr.slice(0, 1500)
      });
    }

    if (data.status !== "SUCCESS") {
      return res.status(502).json({
        success: false,
        error: data.error || "Quarterly result data unavailable.",
        symbol
      });
    }

    return res.json({
      success: true,
      symbol: data.symbol,
      period: data.period,
      quarters: Array.isArray(data.quarters) ? data.quarters : [],
      source: data.source || null,
      note: data.note || null
    });
  } catch (error) {
    console.error("Quarterly API error:", error.message);
    return res.status(502).json({
      success: false,
      error: "Quarterly result fetch failed.",
      detail: error.message
    });
  }
});

app.get("/api/health", (req, res) => res.json({
  success: true, server: "running", engine: "PRAN AI Universal Q&A v1",
  market_data: "validated quant-pipeline.py", news: "sentiment.js",
  question_api: "/api/ask", no_dhan_dependency: true, ai: providerStatus(),
  timestamp: new Date().toISOString()
}));

app.get("/api/ai-status", (req, res) => res.json({ success: true, ...providerStatus(), ready_for_ai: !!(geminiModel || groq) }));

app.get("/api/ai-test", async (req, res) => {
  const r = await ai("Reply with exactly: PRAN_AI_UNIVERSAL_QA_OK");
  res.json({ success: !!r.text, provider: r.provider, model: r.model, response: r.text, configured: providerStatus() });
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const server = app.listen(PORT, HOST, () => {
  console.log("==============================================");
  console.log("🚀 PRAN AI UNIVERSAL Q&A ENGINE RUNNING");
  console.log(`📊 Port: ${PORT} | AI: ${providerStatus().active_provider}`);
  console.log("🧠 /api/ask supports natural Hindi/Hinglish/English questions");
  console.log("==============================================");
});
server.on("error", e => console.error("Server error:", e.message));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
