const fs = require("fs");
const path = require("path");

// =====================================================
// AI RESEARCH AGENT — CORE
// Open-ended Hindi / English / Hinglish Q&A
// =====================================================

const UNIVERSE_FILE = path.join(
  __dirname,
  "stock-universe.json"
);

// -----------------------------------------------------
// Load stock universe
// -----------------------------------------------------

function loadUniverse() {
  if (!fs.existsSync(UNIVERSE_FILE)) {
    throw new Error(
      "stock-universe.json nahi mila. Pehle node update-universe.js chalao."
    );
  }

  const data = JSON.parse(
    fs.readFileSync(UNIVERSE_FILE, "utf8")
  );

  return data.stocks || [];
}

// -----------------------------------------------------
// Normalize text
// -----------------------------------------------------

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.\-& ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// -----------------------------------------------------
// Detect language
// -----------------------------------------------------

function detectLanguage(question) {
  const text = normalizeText(question);

  const hindiPattern = /[\u0900-\u097F]/;

  if (hindiPattern.test(text)) {
    return "HINDI";
  }

  // Common Hinglish words
  const hinglishWords = [
    "kyu",
    "kyon",
    "kaisa",
    "kaise",
    "kya",
    "hai",
    "hain",
    "batao",
    "btao",
    "karo",
    "karna",
    "chahiye",
    "gir",
    "badhega",
    "badhegi",
    "stock",
    "me",
    "mein",
    "wala",
    "wale",
    "ka",
    "ki",
    "ke"
  ];

  const words = text.split(" ");

  const matches = words.filter(
    word => hinglishWords.includes(word)
  ).length;

  if (matches >= 2) {
    return "HINGLISH";
  }

  return "ENGLISH";
}

// -----------------------------------------------------
// Find stocks mentioned in question
// -----------------------------------------------------

function findStocks(question, universe) {
  const text = normalizeText(question);

  const matches = [];

  for (const stock of universe) {
    const symbol = normalizeText(stock.symbol);

    if (!symbol) continue;

    // Exact symbol search
    const regex = new RegExp(
      `(^|\\s)${escapeRegex(symbol)}(\\s|$)`,
      "i"
    );

    if (regex.test(text)) {
      matches.push(stock);
    }
  }

  // Sort longest symbols first
  matches.sort(
    (a, b) =>
      b.symbol.length - a.symbol.length
  );

  return matches;
}

function escapeRegex(value) {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

// -----------------------------------------------------
// Common company-name aliases
// -----------------------------------------------------

const ALIASES = {
  reliance: "RELIANCE",
  tcs: "TCS",
  infy: "INFY",
  infosys: "INFY",
  mcx: "MCX",
  sbi: "SBIN",
  hdfc: "HDFCBANK",
  icici: "ICICIBANK",
  airtel: "BHARTIARTL",
  bharti: "BHARTIARTL",
  larsen: "LT",
  ltimindtree: "LTIM"
};

function findAliasStocks(question, universe) {
  const text = normalizeText(question);
  const found = [];

  for (const [alias, symbol] of Object.entries(ALIASES)) {
    const regex = new RegExp(
      `(^|\\s)${escapeRegex(alias)}(\\s|$)`,
      "i"
    );

    if (regex.test(text)) {
      const stock = universe.find(
        item => item.symbol === symbol
      );

      if (stock) {
        found.push(stock);
      }
    }
  }

  return found;
}

// -----------------------------------------------------
// Determine broad research requirements
// -----------------------------------------------------

function determineResearchNeeds(question) {
  const text = normalizeText(question);

  const needs = {
    marketData: true,
    technical: false,
    fundamentals: false,
    news: false,
    comparison: false,
    screening: false,
    explanation: false,
    scenario: false
  };

  // Technical
  if (
    /rsi|ema|macd|atr|support|resistance|technical|trend|breakout|volume|oversold|overbought|moving average/.test(text)
  ) {
    needs.technical = true;
  }

  // Fundamentals
  if (
    /fundamental|pe|p e|pb|roe|roce|debt|eps|revenue|profit|margin|valuation|dividend|balance sheet|results|earnings/.test(text)
  ) {
    needs.fundamentals = true;
  }

  // News / why movement
  if (
    /why|kyu|kyon|क्यों|news|headline|falling|fall|rising|rise|gira|giri|gir raha|badha|badhi|impact|reason/.test(text)
  ) {
    needs.news = true;
    needs.explanation = true;
  }

  // Comparison
  if (
    /compare|comparison|versus|vs|better than|best between|तुलना/.test(text)
  ) {
    needs.comparison = true;
  }

  // Screening
  if (
    /find|screen|scan|top|best|stocks|shares|under|above|below|less than|greater than|stocks where|ऐसे शेयर|ढूंढ|खोज/.test(text)
  ) {
    needs.screening = true;
  }

  // Scenario
  if (
    /if |what if|scenario|suppose|assuming|अगर|यदि|मान लो/.test(text)
  ) {
    needs.scenario = true;
  }

  return needs;
}

// -----------------------------------------------------
// Build research plan
// -----------------------------------------------------

function buildResearchPlan(question) {
  const universe = loadUniverse();

  const directStocks = findStocks(
    question,
    universe
  );

  const aliasStocks = findAliasStocks(
    question,
    universe
  );

  const allStocks = [
    ...directStocks,
    ...aliasStocks
  ];

  const uniqueStocks = [
    ...new Map(
      allStocks.map(stock => [
        stock.symbol,
        stock
      ])
    ).values()
  ];

  const language = detectLanguage(question);

  const needs = determineResearchNeeds(
    question
  );

  return {
    question,
    language,

    stocks: uniqueStocks,

    stockCount: uniqueStocks.length,

    needs,

    universeCount: universe.length,

    dataSources: [
      "Yahoo Finance",
      "FMP",
      "Alpha Vantage",
      "News API",
      "Gemini",
      "Groq"
    ]
  };
}

// -----------------------------------------------------
// Main
// -----------------------------------------------------

async function research(question) {
  if (!question || !question.trim()) {
    throw new Error(
      "Question empty hai."
    );
  }

  const plan = buildResearchPlan(
    question
  );

  return {
    success: true,
    type: "AI_RESEARCH_PLAN",
    ...plan
  };
}

// -----------------------------------------------------
// Export
// -----------------------------------------------------

module.exports = {
  loadUniverse,
  normalizeText,
  detectLanguage,
  findStocks,
  determineResearchNeeds,
  buildResearchPlan,
  research
};