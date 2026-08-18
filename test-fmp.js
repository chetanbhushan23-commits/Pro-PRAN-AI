require("dotenv").config();

const https = require("https");

const apiKey = process.env.FMP_API_KEY;

if (!apiKey) {
  console.log("❌ FMP_API_KEY .env file me nahi mili.");
  process.exit(1);
}

const symbol = "AAPL";

const path =
  `/stable/quote?symbol=${symbol}&apikey=${apiKey}`;

const options = {
  hostname: "financialmodelingprep.com",
  path: path,
  method: "GET",
  headers: {
    Accept: "application/json"
  }
};

console.log("🔄 FMP API test ho raha hai...");
console.log(`📊 Symbol: ${symbol}`);

const req = https.request(options, (res) => {
  let data = "";

  res.on("data", (chunk) => {
    data += chunk;
  });

  res.on("end", () => {
    try {
      const result = JSON.parse(data);

      console.log("\n========== FMP RESULT ==========\n");
      console.log(JSON.stringify(result, null, 2));

      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (Array.isArray(result) && result.length > 0) {
          const quote = result[0];

          console.log("\n✅ FMP API — WORKING");
          console.log("Symbol:", quote.symbol);
          console.log("Price:", quote.price);
          console.log("Change:", quote.change);
          console.log("Change %:", quote.changePercentage);
        } else {
          console.log("\n⚠️ FMP connected, but data nahi mila.");
        }
      } else {
        console.log(`\n❌ FMP API ERROR — HTTP ${res.statusCode}`);

        if (result["Error Message"]) {
          console.log("Error:", result["Error Message"]);
        }

        if (result.error) {
          console.log("Error:", result.error);
        }
      }
    } catch (error) {
      console.log("\n❌ Response parse error:", error.message);
      console.log("Raw response:", data);
    }
  });
});

req.on("error", (error) => {
  console.log("\n❌ Network error:", error.message);
});

req.end();