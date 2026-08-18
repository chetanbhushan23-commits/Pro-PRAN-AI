require("dotenv").config();

const https = require("https");

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          resolve({
            statusCode: res.statusCode,
            data: JSON.parse(data)
          });
        } catch {
          resolve({
            statusCode: res.statusCode,
            data
          });
        }
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

// ========================================
// 1. ALPHA VANTAGE
// ========================================

async function testAlpha() {
  const key = process.env.ALPHA_VANTAGE_API_KEY;

  if (!key) {
    return { name: "Alpha Vantage", status: "MISSING KEY" };
  }

  const options = {
    hostname: "www.alphavantage.co",
    path: `/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=${key}`,
    method: "GET"
  };

  try {
    const response = await request(options);
    const quote = response.data?.["Global Quote"];

    if (quote && Object.keys(quote).length > 0) {
      return {
        name: "Alpha Vantage",
        status: "WORKING",
        detail: `IBM $${quote["05. price"]}`
      };
    }

    return {
      name: "Alpha Vantage",
      status: "FAILED",
      detail: response.data?.Note || "No data"
    };
  } catch (error) {
    return {
      name: "Alpha Vantage",
      status: "FAILED",
      detail: error.message
    };
  }
}

// ========================================
// 2. GROQ
// ========================================

async function testGroq() {
  const key = process.env.GROQ_API_KEY;

  if (!key) {
    return { name: "Groq", status: "MISSING KEY" };
  }

  const body = JSON.stringify({
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "user",
        content: "Reply only with: OK"
      }
    ],
    temperature: 0
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

    if (
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      response.data?.choices?.length
    ) {
      return {
        name: "Groq",
        status: "WORKING",
        detail: response.data.choices[0].message.content
      };
    }

    return {
      name: "Groq",
      status: "FAILED",
      detail: response.data?.error?.message || "Request failed"
    };
  } catch (error) {
    return {
      name: "Groq",
      status: "FAILED",
      detail: error.message
    };
  }
}

// ========================================
// 3. GEMINI
// ========================================

async function testGemini() {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    return { name: "Gemini", status: "MISSING KEY" };
  }

  const body = JSON.stringify({
    model: "gemini-3.6-flash",
    input: "Reply only with: OK"
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

    if (
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      response.data?.status
    ) {
      return {
        name: "Gemini",
        status: "WORKING",
        detail: response.data.status
      };
    }

    return {
      name: "Gemini",
      status: "FAILED",
      detail: response.data?.error?.message || "Request failed"
    };
  } catch (error) {
    return {
      name: "Gemini",
      status: "FAILED",
      detail: error.message
    };
  }
}

// ========================================
// 4. FMP
// ========================================

async function testFMP() {
  const key = process.env.FMP_API_KEY;

  if (!key) {
    return { name: "FMP", status: "MISSING KEY" };
  }

  const options = {
    hostname: "financialmodelingprep.com",
    path: `/stable/quote?symbol=AAPL&apikey=${key}`,
    method: "GET"
  };

  try {
    const response = await request(options);
    const quote = response.data?.[0];

    if (
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      quote
    ) {
      return {
        name: "FMP",
        status: "WORKING",
        detail: `AAPL $${quote.price}`
      };
    }

    return {
      name: "FMP",
      status: "FAILED",
      detail:
        response.data?.["Error Message"] ||
        response.data?.error ||
        "No data"
    };
  } catch (error) {
    return {
      name: "FMP",
      status: "FAILED",
      detail: error.message
    };
  }
}

// ========================================
// 5. NEWS API
// ========================================

async function testNews() {
  const key = process.env.NEWS_API_KEY;

  if (!key) {
    return { name: "News API", status: "MISSING KEY" };
  }

  const query = encodeURIComponent("Reliance India");

  const options = {
    hostname: "newsapi.org",
    path:
      `/v2/everything?q=${query}` +
      `&language=en` +
      `&sortBy=publishedAt` +
      `&pageSize=1` +
      `&apiKey=${key}`,
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "api-test/1.0"
    }
  };

  try {
    const response = await request(options);

    if (
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      response.data?.status === "ok"
    ) {
      return {
        name: "News API",
        status: "WORKING",
        detail: `${response.data.totalResults} results`
      };
    }

    return {
      name: "News API",
      status: "FAILED",
      detail: response.data?.message || "Request failed"
    };
  } catch (error) {
    return {
      name: "News API",
      status: "FAILED",
      detail: error.message
    };
  }
}

// ========================================
// RUN ALL TESTS
// ========================================

async function main() {
  console.log("\n");
  console.log("========================================");
  console.log("        API HEALTH CHECK");
  console.log("========================================");
  console.log("\n🔄 Testing 5 APIs...\n");

  const results = await Promise.all([
    testAlpha(),
    testGroq(),
    testGemini(),
    testFMP(),
    testNews()
  ]);

  console.log("----------------------------------------");

  results.forEach((result) => {
    const icon =
      result.status === "WORKING"
        ? "🟢"
        : result.status === "MISSING KEY"
        ? "🟡"
        : "🔴";

    console.log(
      `${icon} ${result.name.padEnd(18)} ${result.status}`
    );

    if (result.detail) {
      console.log(`   └─ ${result.detail}`);
    }
  });

  console.log("----------------------------------------");

  const working = results.filter(
    (r) => r.status === "WORKING"
  ).length;

  console.log(`\n📊 RESULT: ${working}/5 APIs working`);

  if (working === 5) {
    console.log("\n🎉 ALL 5 APIs ARE WORKING ✅");
  } else {
    console.log("\n⚠️ Some APIs need attention.");
  }

  console.log("\n========================================\n");
}

main();