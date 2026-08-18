require("dotenv").config();

const https = require("https");

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.log("❌ GEMINI_API_KEY .env file me nahi mili.");
  process.exit(1);
}

const requestData = JSON.stringify({
  model: "gemini-3.6-flash",
  input: "Reply with exactly: Gemini API is working"
});

const options = {
  hostname: "generativelanguage.googleapis.com",
  path: "/v1beta/interactions",
  method: "POST",
  headers: {
    "x-goog-api-key": apiKey,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(requestData)
  }
};

console.log("🔄 Gemini API test ho raha hai...");

const req = https.request(options, (res) => {
  let data = "";

  res.on("data", (chunk) => {
    data += chunk;
  });

  res.on("end", () => {
    try {
      const result = JSON.parse(data);

      console.log("\n========== GEMINI RESULT ==========\n");
      console.log(JSON.stringify(result, null, 2));

      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log("\n✅ Gemini API — WORKING");

        if (result.output_text) {
          console.log("AI Response:", result.output_text);
        } else {
          const text = result.steps
            ?.filter(step => step.type === "model_output")
            ?.flatMap(step => step.content || [])
            ?.filter(item => item.type === "text")
            ?.map(item => item.text)
            ?.join("\n");

          if (text) {
            console.log("AI Response:", text);
          }
        }
      } else {
        console.log(`\n❌ Gemini API ERROR — HTTP ${res.statusCode}`);

        if (result.error) {
          console.log(
            "Error:",
            result.error.message || result.error
          );
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

req.write(requestData);
req.end();