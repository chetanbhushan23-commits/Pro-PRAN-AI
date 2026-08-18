const {
  research
} = require("./ai-research-agent");

async function test(question) {
  console.log("\n");
  console.log("==========================================");
  console.log("🤖 AI RESEARCH AGENT");
  console.log("==========================================");

  console.log("\n❓ Question:");
  console.log(question);

  const result = await research(question);

  console.log("\n🌐 Language:");
  console.log(result.language);

  console.log("\n📊 Universe:");
  console.log(`${result.universeCount} stocks`);

  console.log("\n🎯 Stocks detected:");

  if (result.stocks.length === 0) {
    console.log("No specific stock detected.");
  } else {
    result.stocks.forEach(stock => {
      console.log(
        `${stock.symbol} → ${stock.yahooSymbol}`
      );
    });
  }

  console.log("\n🧠 Research requirements:");
  console.log(
    JSON.stringify(result.needs, null, 2)
  );

  console.log("\n🔌 Available sources:");

  result.dataSources.forEach(source => {
    console.log(`- ${source}`);
  });

  console.log("\n==========================================");
  console.log("✅ AI RESEARCH PLANNER — WORKING");
  console.log("==========================================");
}

async function main() {
  await test(
    "MCX kyu gir raha hai aur iska support resistance kya hai?"
  );
}

main().catch(error => {
  console.error("\n❌ ERROR:");
  console.error(error.message);
});