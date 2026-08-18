require("dotenv").config();

const https = require("https");

const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

if (!apiKey) {
  console.log("❌ ALPHA_VANTAGE_API_KEY .env file me nahi mili.");
  process.exit(1);
}

const url =
  `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=${apiKey}`;

console.log("🔄 Alpha Vantage API test ho raha hai...");

https.get(url, (res) => {
  let data = "";

  res.on("data", (chunk) => {
    data += chunk;
  });

  res.on("end", () => {
    try {
      const result = JSON.parse(data);

      console.log("\n========== ALPHA VANTAGE RESULT ==========\n");
      console.log(JSON.stringify(result, null, 2));

      if (
        result["Global Quote"] &&
        Object.keys(result["Global Quote"]).length > 0
      ) {
        console.log("\n✅ Alpha Vantage API — WORKING");
        console.log(
          "Symbol:",
          result["Global Quote"]["01. symbol"]
        );
        console.log(
          "Price:",
          result["Global Quote"]["05. price"]
        );
      } else if (result.Note) {
        console.log("\n⚠️ API LIMIT:");
        console.log(result.Note);
      } else if (result["Error Message"]) {
        console.log("\n❌ API ERROR:");
        console.log(result["Error Message"]);
      } else {
        console.log("\n⚠️ API connected, but data nahi mila.");
      }
    } catch (error) {
      console.log("\n❌ Response parse error:", error.message);
    }
  });
}).on("error", (error) => {
  console.log("\n❌ Network error:", error.message);
});