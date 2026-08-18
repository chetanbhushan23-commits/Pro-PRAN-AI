const fs = require("fs");
const https = require("https");

const NSE_URL =
  "https://archives.nseindia.com/content/equities/EQUITY_L.csv";

function download(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
          "Accept":
            "text/csv,application/csv,text/plain,*/*",
          "Referer": "https://www.nseindia.com/"
        }
      },
      response => {
        let data = "";

        response.on("data", chunk => {
          data += chunk;
        });

        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(
              new Error(
                `NSE HTTP ${response.statusCode}`
              )
            );
            return;
          }

          resolve(data);
        });
      }
    );

    request.on("error", reject);

    request.setTimeout(15000, () => {
      request.destroy(
        new Error("NSE request timeout")
      );
    });
  });
}

// -----------------------------------------------------
// CSV parser
// -----------------------------------------------------

function parseCSV(csv) {
  const lines = csv
    .split(/\r?\n/)
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("Invalid NSE CSV");
  }

  const headers = lines[0]
    .split(",")
    .map(x => x.trim().replace(/^"|"$/g, ""));

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]
      .split(",")
      .map(x => x.trim().replace(/^"|"$/g, ""));

    if (values.length !== headers.length) {
      continue;
    }

    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index];
    });

    rows.push(row);
  }

  return rows;
}

// -----------------------------------------------------
// Build universe
// -----------------------------------------------------

function buildUniverse(rows) {
  const seen = new Set();
  const stocks = [];

  for (const row of rows) {
    const symbol = String(row.SYMBOL || "")
      .trim()
      .toUpperCase();

    const series = String(row.SERIES || "")
      .trim()
      .toUpperCase();

    const isin = String(row.ISIN || "")
      .trim()
      .toUpperCase();

    if (!symbol) continue;

    // Equity only
    if (series !== "EQ") continue;

    // Avoid duplicate symbols
    if (seen.has(symbol)) continue;

    seen.add(symbol);

    stocks.push({
      id: stocks.length + 1,
      symbol,
      exchange: "NSE",
      series,
      isin,
      yahooSymbol: `${symbol}.NS`
    });
  }

  return stocks;
}

// -----------------------------------------------------
// Main
// -----------------------------------------------------

async function main() {
  console.log("\n==========================================");
  console.log(" 🇮🇳 NSE STOCK UNIVERSE UPDATE");
  console.log("==========================================");

  console.log("\n🔄 NSE equity master download ho raha hai...");

  const csv = await download(NSE_URL);

  console.log(
    `📦 Downloaded: ${(csv.length / 1024).toFixed(1)} KB`
  );

  const rows = parseCSV(csv);

  console.log(
    `📊 NSE rows found: ${rows.length}`
  );

  const stocks = buildUniverse(rows);

  console.log(
    `✅ Active EQ stocks: ${stocks.length}`
  );

  const output = {
    updatedAt: new Date().toISOString(),
    exchange: "NSE",
    source: "NSE Equity Master",
    count: stocks.length,
    stocks
  };

  fs.writeFileSync(
    "stock-universe.json",
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log(
    "\n💾 Saved: stock-universe.json"
  );

  console.log("\nFirst 20 stocks:");

  stocks.slice(0, 20).forEach(stock => {
    console.log(
      `${stock.id}. ${stock.symbol} → ${stock.yahooSymbol}`
    );
  });

  console.log("\n==========================================");
  console.log("✅ NSE UNIVERSE UPDATE COMPLETE");
  console.log("==========================================");
}

main().catch(error => {
  console.error("\n❌ ERROR:");
  console.error(error.message);
  process.exit(1);
});