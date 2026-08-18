// AI ANSWER ENGINE — FIXED VERSION
require("dotenv").config();

const { collectResearch } = require("./research-data-engine");
const { buildTrustedEvidence } = require("./source-validator");

function buildPrompt(researchResult) {
  const evidence = researchResult.evidence || [];

  let context = "";

  for (const stock of evidence) {
    context += `
STOCK: ${stock.symbol}
YAHOO SYMBOL: ${stock.yahooSymbol || "N/A"}

MARKET DATA:
${JSON.stringify(stock.yahoo || null, null, 2)}

TECHNICAL DATA:
${JSON.stringify(stock.technical || null, null, 2)}

FMP DATA:
${JSON.stringify(stock.fmp || null, null, 2)}

ALPHA DATA:
${JSON.stringify(stock.alpha || null, null, 2)}

NEWS:
${JSON.stringify(
  stock.validatedNews || stock.news || null,
  null,
  2
)}
`;
  }

  return `
You are an evidence-based Indian stock research AI.

USER QUESTION:
${researchResult.question}

LANGUAGE:
${researchResult.language}

RULES:
1. Answer the exact question first.
2. Use only supplied evidence.
3. Never invent prices, news, targets, ratings, financial results or analyst opinions.
4. If data is unavailable, say "Data unavailable."
5. Separate FACT, ANALYSIS and SCENARIO.
6. Do not guarantee returns.
7. Future movement must be described only as a scenario.
8. Use Hindi for Hindi questions.
9. Use English for English questions.
10. Use Hinglish for Hinglish questions.
11. Explain technical indicators simply.
12. Prioritize official exchange/company/SEBI/RBI sources and reputable financial media.
13. If evidence conflicts, explain the conflict.
14. End with:
   - Key Takeaway
   - Important Levels
   - Main Risks
   - Sources

RESEARCH EVIDENCE:
${context}

Now provide the best evidence-based answer.
`;
}

async function askGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY missing");
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        model: "gemini-3.6-flash",
        input: prompt
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      `Gemini HTTP ${response.status}`
    );
  }

  let text = "";

  if (typeof data.output_text === "string") {
    text = data.output_text;
  }

  if (!text && Array.isArray(data.steps)) {
    for (const step of data.steps) {
      if (
        step?.type === "model_output" &&
        Array.isArray(step.content)
      ) {
        for (const item of step.content) {
          if (
            item?.type === "text" &&
            typeof item.text === "string"
          ) {
            text += item.text;
          }
        }
      }
    }
  }

  if (!text && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (typeof item === "string") {
        text += item;
      } else if (
        typeof item?.text === "string"
      ) {
        text += item.text;
      }
    }
  }

  if (!text.trim()) {
    throw new Error("Gemini returned empty response");
  }

  return {
    provider: "Gemini",
    model:
      data.model || "gemini-3.6-flash",
    answer: text.trim(),
    raw: data
  };
}

async function askGroq(prompt) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY missing");
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content:
              "You are an evidence-based Indian stock research assistant. Use only supplied evidence. Never invent financial data."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      `Groq HTTP ${response.status}`
    );
  }

  const answer =
    data?.choices?.[0]?.message?.content || "";

  if (!answer.trim()) {
    throw new Error("Groq returned empty response");
  }

  return {
    provider: "Groq",
    model: data.model || "llama-3.1-8b-instant",
    answer: answer.trim(),
    raw: data
  };
}

async function answerQuestion(question) {
  if (
    typeof question !== "string" ||
    !question.trim()
  ) {
    throw new Error("Question empty hai.");
  }

  console.log("\nResearching question...");

  const research = await collectResearch(
    question.trim()
  );

  if (!research) {
    throw new Error(
      "Research engine returned no result."
    );
  }

  if (!Array.isArray(research.evidence)) {
    research.evidence = [];
  }

  for (const stock of research.evidence) {
    if (
      stock &&
      stock.news &&
      Array.isArray(stock.news.articles)
    ) {
      try {
        stock.validatedNews =
          buildTrustedEvidence(
            stock.news.articles
          );
      } catch (error) {
        stock.validatedNews = {
          success: false,
          error: error.message,
          articles: []
        };
      }
    }
  }

  const prompt = buildPrompt(research);

  try {
    console.log(
      "\nGemini answer generate kar raha hai..."
    );

    const result = await askGemini(prompt);

    return {
      success: true,
      provider: result.provider,
      model: result.model,
      question: question.trim(),
      answer: result.answer,
      research
    };
  } catch (geminiError) {
    console.log(
      `Gemini failed: ${geminiError.message}`
    );
    console.log("Groq fallback...");
  }

  try {
    const groq = await askGroq(prompt);

    return {
      success: true,
      provider: groq.provider,
      model: groq.model,
      question: question.trim(),
      answer: groq.answer,
      research
    };
  } catch (groqError) {
    return {
      success: false,
      provider: null,
      model: null,
      question: question.trim(),
      answer: "",
      error:
        `Gemini and Groq both failed. ` +
        `Groq: ${groqError.message}`,
      research
    };
  }
}

module.exports = {
  answerQuestion,
  askGemini,
  askGroq,
  buildPrompt
};