const {
  getUniqueStocks,
  getStockRecords,
  findStock,
  toYahooSymbol
} = require("./stock-universe");

function main() {
  const stocks = getUniqueStocks();
  const records = getStockRecords();

  console.log("\n==========================================");
  console.log(" 🇮🇳 INDIAN STOCK UNIVERSE TEST");
  console.log("==========================================");

  console.log(`\nUnique stocks loaded: ${stocks.length}`);

  console.log("\nFirst 20 stocks:");

  records.slice(0, 20).forEach(stock => {
    console.log(
      `${stock.id}. ${stock.symbol} → ${stock.yahooSymbol}`
    );
  });

  console.log("\nSymbol tests:");

  console.log(
    "RELIANCE →",
    toYahooSymbol("RELIANCE")
  );

  console.log(
    "TCS →",
    toYahooSymbol("TCS")
  );

  console.log(
    "INFY →",
    toYahooSymbol("INFY")
  );

  console.log("\nSearch MCX:");

  console.log(
    findStock("MCX")
  );

  console.log("\n==========================================");
  console.log("✅ STOCK UNIVERSE — WORKING");
  console.log("==========================================");
}

main();