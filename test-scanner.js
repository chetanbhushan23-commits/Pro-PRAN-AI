const {
  scanStocks
} = require("./scanner");

// =====================================================
// SCANNER TEST
// =====================================================

async function main() {
  const stocks = [
    "RELIANCE",
    "TCS",
    "INFY",
    "MCX",
    "HDFCBANK",
    "SBIN",
    "ITC",
    "ICICIBANK",
    "BHARTIARTL",
    "LT"
  ];

  const results = await scanStocks(stocks);

  console.log("\n");
  console.log("==============================================================");
  console.log("                 📊 SCANNER RESULTS");
  console.log("==============================================================");

  console.log(
    "\nStock          Price       RSI    EMA20     EMA50     Score   Signal"
  );

  console.log(
    "-----------------------------------------------------------------------"
  );

  for (const result of results) {
    if (!result.success) {
      console.log(
        `${result.symbol.padEnd(14)} ERROR: ${result.error}`
      );
      continue;
    }

    const stock = result.symbol
      .replace(".NS", "");

    console.log(
      `${stock.padEnd(14)}` +
      `${String(result.price ?? "-").padEnd(12)}` +
      `${String(result.rsi ?? "-").padEnd(8)}` +
      `${String(result.ema20 ?? "-").padEnd(10)}` +
      `${String(result.ema50 ?? "-").padEnd(10)}` +
      `${String(result.score + "/100").padEnd(9)}` +
      `${result.signal}`
    );
  }

  // =====================================================
  // TOP STOCKS
  // =====================================================

  const successful = results.filter(
    result => result.success
  );

  const bullish = successful.filter(
    result =>
      result.signal === "STRONG BUY" ||
      result.signal === "BUY"
  );

  console.log("\n");
  console.log("==============================================================");
  console.log("🔥 TOP BULLISH STOCKS");
  console.log("==============================================================");

  if (bullish.length === 0) {
    console.log("No BUY candidates found.");
  } else {
    bullish.forEach((stock, index) => {
      console.log(
        `${index + 1}. ${stock.symbol} | ` +
        `${stock.signal} | ` +
        `${stock.score}/100 | ` +
        `RSI ${stock.rsi}`
      );

      console.log(
        `   Reasons: ${stock.reasons.join(", ")}`
      );
    });
  }

  console.log("\n");
  console.log("==============================================================");
  console.log("📈 SCAN COMPLETE");
  console.log("==============================================================");
}

main().catch(error => {
  console.error("\n❌ SCANNER ERROR:");
  console.error(error.message);
});