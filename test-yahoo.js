const https = require("https");

const symbol = "RELIANCE.NS";

const options = {
  hostname: "query1.finance.yahoo.com",
  path: `/v8/finance/chart/${symbol}?range=1d&interval=1m`,
  method: "GET",
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json"
  }
};

console.log("🔄 Yahoo Finance test ho raha hai...");
console.log(`📊 Symbol: ${symbol}`);

const req = https.request(options, (res) => {
  let data = "";

  res.on("data", (chunk) => {
    data += chunk;
  });

  res.on("end", () => {
    try {
      const result = JSON.parse(data);

      console.log("\n========== YAHOO RESULT ==========\n");

      if (
        result.chart &&
        result.chart.result &&
        result.chart.result.length > 0
      ) {
        const chart = result.chart.result[0];
        const meta = chart.meta;

        console.log("Symbol:", meta.symbol);
        console.log("Exchange:", meta.exchangeName);
        console.log("Currency:", meta.currency);
        console.log("Market Price:", meta.regularMarketPrice);
        console.log("Previous Close:", meta.previousClose);
        console.log("52W High:", meta.fiftyTwoWeekHigh);
        console.log("52W Low:", meta.fiftyTwoWeekLow);

        console.log("\n✅ Yahoo Finance — WORKING");
      } else {
        console.log("❌ Yahoo Finance — NO DATA");
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (error) {
      console.log("❌ JSON Error:", error.message);
      console.log(data);
    }
  });
});

req.on("error", (error) => {
  console.log("❌ Network Error:", error.message);
});

req.end();