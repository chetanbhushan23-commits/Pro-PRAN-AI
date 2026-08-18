const {
  answerQuestion
} = require("./ai-answer-engine");

async function main() {

  const question =
    "MCX kyu gir raha hai aur iska support resistance kya hai?";

  console.log("\n==========================================");
  console.log("🤖 INDIAN STOCK AI");
  console.log("==========================================");

  const result =
    await answerQuestion(question);

  console.log("\n");
  console.log("==========================================");
  console.log("📌 FINAL AI ANSWER");
  console.log("==========================================");

  console.log(result.answer);

  console.log("\n==========================================");
  console.log(
    `🤖 Provider: ${result.provider}`
  );
  console.log(
    `🧠 Model: ${result.model}`
  );
  console.log("==========================================");
}

main().catch(error => {

  console.error("\n❌ ERROR:");
  console.error(error.message);

});