require("dotenv").config();

const https = require("https");

const apiKey = process.env.NEWS_API_KEY;

if (!apiKey) {
  console.log("❌ NEWS_API_KEY .env file me nahi mili.");
  process.exit(1);
}

const query = "Reliance India";

const path =
  `/v2/everything?q=${encodeURIComponent(query)}` +
  `&language=en` +
  `&sortBy=publishedAt` +
  `&pageSize=5` +
  `&apiKey=${apiKey}`;

const options = {
  hostname: "newsapi.org",
  path: path,
  method: "GET",
  headers: {
    Accept: "application/json",
    "User-Agent": "api-test/1.0"
  }
};

console.log("🔄 News API test ho raha hai...");
console.log(`📰 Search: ${query}`);

const req = https.request(options, (res) => {
  let data = "";

  res.on("data", (chunk) => {
    data += chunk;
  });

  res.on("end", () => {
    try {
      const result = JSON.parse(data);

      console.log("\n========== NEWS API RESULT ==========\n");
      console.log(JSON.stringify(result, null, 2));

      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log("\n✅ News API — WORKING");

        console.log(
          "Total Results:",
          result.totalResults ?? 0
        );

        if (result.articles && result.articles.length > 0) {
          console.log("\n📰 Latest News:\n");

          result.articles.forEach((article, index) => {
            console.log(`${index + 1}. ${article.title || "No title"}`);

            console.log(
              `   Source: ${article.source?.name || "Unknown"}`
            );

            console.log(
              `   Author: ${article.author || "Unknown"}`
            );

            console.log(
              `   Date: ${article.publishedAt || "Unknown"}`
            );

            console.log(
              `   Description: ${article.description || "No description"}`
            );

            console.log(
              `   URL: ${article.url || "N/A"}`
            );

            console.log("");
          });
        } else {
          console.log("\n⚠️ API working hai, lekin koi article nahi mila.");
        }
      } else {
        console.log(`\n❌ News API ERROR — HTTP ${res.statusCode}`);

        if (result.message) {
          console.log("Error:", result.message);
        }

        if (result.code) {
          console.log("Code:", result.code);
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