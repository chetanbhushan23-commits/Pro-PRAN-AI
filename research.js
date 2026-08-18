require("dotenv").config();

const https = require("https");
const readline = require("readline");

// =====================================================
// INDIAN STOCK RESEARCH ENGINE
// =====================================================

const DEFAULT_SYMBOL = "RELIANCE";

// =====================================================
// HTTP HELPER
// =====================================================

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        let parsed;

        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }

        resolve({
          statusCode: res.statusCode,
          data: parsed
        });
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

// =====================================================
// SYMBOL NORMALIZATION
// =====================================================

function normalizeIndianSymbol(symbol) {
  return symbol
    .trim()
    .toUpperCase()
    .replace(".NS", "")
    .replace(".NSE", "");
}

function getYahooStyleSymbol(symbol) {
  return `${normalizeIndianSymbol(symbol)}.NS`;
}

// =====================================================
// FMP - INDIAN STOCK
// =====================================================

async function getFMP(symbol) {
  const key = process.env.FMP_API_KEY;

  if (!key) {
    return {
      provider: "FMP",
      success: false,
      error: "FMP_API_KEY missing"
    };
  }

  const cleanSymbol = normalizeIndianSymbol(symbol);

  const options = {
    hostname: "financialmodelingprep.com",
    path:
      `/stable/quote?symbol=${encodeURIComponent(cleanSymbol)}` +
      `&apikey=${key}`,
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  };

  try {
    const response = await request(options);

    if (
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      Array.isArray(response.data) &&
      response.data.length
    ) {
      const q = response.data[0];

      return {
        provider: "FMP",
        success: true,
        data: {
          symbol: q.symbol,
          name: q.name,
          price: q.price,
          change: q.change,
          changePercentage: q.changePercentage,
          volume: q.volume,
          dayLow: q.dayLow,
          dayHigh: q.dayHigh,
          yearLow: q.yearLow,
          yearHigh: q.yearHigh,
          marketCap: q.marketCap,
          priceAvg50: q.priceAvg50,
          priceAvg200: q.priceAvg200,
          exchange: q.exchange
        }
      };
    }

    return {
      provider: "FMP",
      success: false,
      error:
        response.data?.["Error Message"] ||
        response.data?.error ||
        "Indian stock not available in FMP"
    };
  } catch (error) {
    return {
      provider: "FMP",
      success: false,
      error: error.message
    };
  }
}

// =====================================================
// ALPHA VANTAGE
// =====================================================

async function getAlpha(symbol) {
  const key = process.env.ALPHA_VANTAGE_API_KEY;

  if (!key) {
    return {
      provider: "Alpha Vantage",
      success: false,
      error: "ALPHA_VANTAGE_API_KEY missing"
    };
  }

  const cleanSymbol = normalizeIndianSymbol(symbol);

  const options = {
    hostname: "www.alphavantage.co",
    path:
      `/query?function=GLOBAL_QUOTE` +
      `&symbol=${encodeURIComponent(cleanSymbol)}` +
      `&apikey=${key}`,
    method: "GET"
  };

  try {
    const response = await request(options);

    const q = response.data?.["Global Quote"];

    if (q && Object.keys(q).length) {
      return {
        provider: "Alpha Vantage",
        success: true,
        data: {
          symbol: q["01. symbol"],
          open: q["02. open"],
          high: q["03. high"],
          low: q["04. low"],
          price: q["05. price"],
          volume: q["06. volume"],
          latestTradingDay: q["07. latest trading day"],
          previousClose: q["08. previous close"],
          change: q["09. change"],
          changePercent: q["10. change percent"]
        }
      };
    }

    return {
      provider: "Alpha Vantage",
      success: false,
      error:
        response.data?.Note ||
        response.data?.["Error Message"] ||
        "Indian stock not available in Alpha Vantage"
    };
  } catch (error) {
    return {
      provider: "Alpha Vantage",
      success: false,
      error: error.message
    };
  }
}

// =====================================================
// NEWS API - INDIAN STOCK
// =====================================================

async function getNews(symbol) {
  const key = process.env.NEWS_API_KEY;

  if (!key) {
    return {
      provider: "News API",
      success: false,
      error: "NEWS_API_KEY missing"
    };
  }

  const cleanSymbol = normalizeIndianSymbol(symbol);

  const query = encodeURIComponent(
    `"${cleanSymbol}" India stock`
  );

  const options = {
    hostname: "newsapi.org",
    path:
      `/v2/everything?q=${query}` +
      `&language=en` +
      `&sortBy=publishedAt` +
      `&pageSize=10` +
      `&apiKey=${key}`,
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "india-stock-research/1.0"
    }
  };

  try {
    const response = await request(options);

    if (
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      response.data?.status === "ok"
    ) {
      const articles = (response.data.articles || []).map((a) => ({
        title: a.title,
        source: a.source?.name,
        publishedAt: a.publishedAt,
        description: a.description,
        url: a.url
      }));

      return {
        provider: "News API",
        success: true,
        data: {
          totalResults: response.data.totalResults,
          articles
        }
      };
    }

    return {
      provider: "News API",
      success: false,
      error:
        response.data?.message ||
        "News request failed"
    };
  } catch (error) {
    return {
      provider: "News API",
      success: false,
      error: error.message
    };
  }
}

// =====================================================
// GROQ ANALYSIS
// =====================================================

async function askGroq(prompt) {
  const key = process.env.GROQ_API_KEY;

  if (!key) {
    return {
      provider: "Groq",
      success: false,
      error: "GROQ_API_KEY missing"
    };
  }

  const body = JSON.stringify({
    model: "llama-3.1-8b-instant",

    messages: [
      {
        role: "system",
        content:
          "You are an Indian stock market research assistant. " +
          "Analyze only supplied evidence. " +
          "Do not invent financial numbers. " +
          "Clearly separate facts and interpretation."
      },
      {
        role: "user",
        content: prompt
      }
    ],

    temperature: 0.2
  });

  const options = {
    hostname: "api.groq.com",
    path: "/openai/v1/chat/completions",
    method: "POST",

    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    }
  };

  try {
    const response = await request(options, body);

    const answer =
      response.data?.choices?.[0]?.message?.content;

    if (
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      answer
    ) {
      return {
        provider: "Groq",
        success: true,
        data: answer
      };
    }

    return {
      provider: "Groq",
      success: false,
      error:
        response.data?.error?.message ||
        "Groq request failed"
    };
  } catch (error) {
    return {
      provider: "Groq",
      success: false,
      error: error.message
    };
  }
}

// =====================================================
// GEMINI ANALYSIS
// =====================================================

async function askGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    return {
      provider: "Gemini",
      success: false,
      error: "GEMINI_API_KEY missing"
    };
  }

  const body = JSON.stringify({
    model: "gemini-3.6-flash",
    input: prompt
  });

  const options = {
    hostname: "generativelanguage.googleapis.com",
    path: "/v1beta/interactions",
    method: "POST",

    headers: {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    }
  };

  try {
    const response = await request(options, body);

    let answer = response.data?.output_text;

    if (!answer && Array.isArray(response.data?.steps)) {
      answer = response.data.steps
        .filter(
          (step) => step.type === "model_output"
        )
        .flatMap(
          (step) => step.content || []
        )
        .filter(
          (item) => item.type === "text"
        )
        .map(
          (item) => item.text
        )
        .join("\n");
    }

    if (
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      answer
    ) {
      return {
        provider: "Gemini",
        success: true,
        data: answer
      };
    }

    return {
      provider: "Gemini",
      success: false,
      error:
        response.data?.error?.message ||
        "Gemini request failed"
    };
  } catch (error) {
    return {
      provider: "Gemini",
      success: false,
      error: error.message
    };
  }
}

// =====================================================
// BUILD RESEARCH PROMPT
// =====================================================

function buildPrompt(symbol, fmp, alpha, news) {
  return `
You are analyzing an Indian stock.

Stock:
${symbol}

Market Data:
${JSON.stringify(fmp, null, 2)}

Alpha Vantage Data:
${JSON.stringify(alpha, null, 2)}

Latest News:
${JSON.stringify(news, null, 2)}

Prepare an Indian stock research summary.

Use this structure:

1. Current Price / Market Snapshot
2. Price Trend
3. Positive Signals
4. Negative Signals
5. News Impact
6. Risk Factors
7. Short-Term View
8. Overall Conclusion

Rules:
- Use only supplied evidence.
- Do not invent PE, ROE, EPS, debt, revenue or other fundamentals.
- If data is unavailable, explicitly say "Data unavailable".
- Distinguish facts from interpretation.
- Do not give guaranteed returns.
`;
}

// =====================================================
// MAIN
// =====================================================

async function runResearch(symbol) {
  symbol = normalizeIndianSymbol(symbol);

  console.log("\n========================================");
  console.log(" 🇮🇳 INDIAN STOCK RESEARCH ENGINE");
  console.log("========================================");

  console.log(`\n📌 NSE Symbol: ${symbol}`);
  console.log(`📡 Provider Symbol: ${getYahooStyleSymbol(symbol)}`);

  console.log("\n🔄 Collecting data...\n");

  const [fmp, alpha, news] =
    await Promise.all([
      getFMP(symbol),
      getAlpha(symbol),
      getNews(symbol)
    ]);

  console.log("--------------- PROVIDERS ---------------");

  console.log(
    `${fmp.success ? "🟢" : "🔴"} FMP`
  );

  console.log(
    `${alpha.success ? "🟢" : "🔴"} Alpha Vantage`
  );

  console.log(
    `${news.success ? "🟢" : "🔴"} News API`
  );

  // ===================================================
  // NEWS
  // ===================================================

  console.log("\n--------------- NEWS --------------------");

  if (news.success) {
    console.log(
      `Total results: ${news.data.totalResults}`
    );

    news.data.articles
      .slice(0, 5)
      .forEach((article, index) => {
        console.log(
          `\n${index + 1}. ${article.title}`
        );

        console.log(
          `   Source: ${article.source}`
        );

        console.log(
          `   Date: ${article.publishedAt}`
        );

        console.log(
          `   URL: ${article.url}`
        );
      });
  } else {
    console.log(`❌ ${news.error}`);
  }

  // ===================================================
  // AI RESEARCH
  // ===================================================

  const prompt = buildPrompt(
    symbol,
    fmp.success ? fmp.data : null,
    alpha.success ? alpha.data : null,
    news.success ? news.data : null
  );

  console.log("\n🤖 Groq analyzing...");

  const groq = await askGroq(prompt);

  console.log("🧠 Gemini analyzing...");

  const gemini = await askGemini(prompt);

  // ===================================================
  // FINAL REPORT
  // ===================================================

  console.log("\n========================================");
  console.log("        🇮🇳 FINAL RESEARCH REPORT");
  console.log("========================================");

  console.log("\n📊 MARKET DATA");

  if (fmp.success) {
    console.log(
      JSON.stringify(fmp.data, null, 2)
    );
  } else {
    console.log(
      `FMP unavailable: ${fmp.error}`
    );
  }

  console.log("\n📈 ALPHA VANTAGE");

  if (alpha.success) {
    console.log(
      JSON.stringify(alpha.data, null, 2)
    );
  } else {
    console.log(
      `Alpha unavailable: ${alpha.error}`
    );
  }

  console.log("\n========================================");
  console.log("             ⚡ GROQ VIEW");
  console.log("========================================");

  if (groq.success) {
    console.log(groq.data);
  } else {
    console.log(`❌ ${groq.error}`);
  }

  console.log("\n========================================");
  console.log("            🧠 GEMINI VIEW");
  console.log("========================================");

  if (gemini.success) {
    console.log(gemini.data);
  } else {
    console.log(`❌ ${gemini.error}`);
  }

  console.log("\n========================================");
  console.log("       ✅ RESEARCH COMPLETE");
  console.log("========================================\n");
}

// =====================================================
// USER INPUT
// =====================================================

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question(
  `Enter NSE stock symbol [${DEFAULT_SYMBOL}]: `,
  async (input) => {
    const symbol =
      input.trim() || DEFAULT_SYMBOL;

    rl.close();

    try {
      await runResearch(symbol);
    } catch (error) {
      console.error(
        "\n❌ Research Engine Error:",
        error.message
      );
    }
  }
);