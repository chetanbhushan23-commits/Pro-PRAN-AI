require("dotenv").config();

const https = require("https");

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.log("❌ GROQ_API_KEY .env file me nahi mili.");
  process.exit(1);
}

const requestData = JSON.stringify({
  model: "llama-3.1-8b-instant",
  messages: [
    {
      role: "user",
      content: "Reply with exactly: Groq API is working"
    }
  ],
  temperature: 0
});

const options = {
  hostname: "api.groq.com",
  path: "/openai/v1/chat/completions",
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(requestData)
  }
};

console.log("🔄 Groq API test ho raha hai...");

const req = https.request(options, (res) => {
  let data = "";

  res.on("data", (chunk) => {
    data += chunk;
  });

  res.on("end", () => {
    try {
      const result = JSON.parse(data);

      console.log("\n========== GROQ RESULT ==========\n");
      console.log(JSON.stringify(result, null, 2));

      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log("\n✅ Groq API — WORKING");

        const answer = result.choices?.[0]?.message?.content;

        if (answer) {
          console.log("AI Response:", answer);
        }
      } else {
        console.log(`\n❌ Groq API ERROR — HTTP ${res.statusCode}`);

        if (result.error) {
          console.log("Error:", result.error.message || result.error);
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