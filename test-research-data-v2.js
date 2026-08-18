// =====================================================
// RESEARCH DATA ENGINE V2 TEST
// =====================================================

const {
  processResearch
} = require(
  "./research-data-engine-v2"
);

const articles = [

  {
    source:
      "The Times of India",

    title:
      "UBS upgrades MCX rating to Buy with Rs 3,800 target price",

    description:
      "UBS upgraded MCX to Buy from Neutral and raised its target price to Rs 3,800.",

    publishedAt:
      "2026-08-13T07:37:59Z",

    url:
      "https://economictimes.indiatimes.com/markets/stocks/news/ubs-upgrades-mcx-raises-target-price/articleshow/133203886.cms"
  },

  {
    source:
      "The Times of India",

    title:
      "MCX shares rise after SEBI proposal",

    description:
      "SEBI proposed widening foreign portfolio investor access to physically settled non-agricultural commodity derivatives.",

    publishedAt:
      "2026-08-12T05:10:52Z",

    url:
      "https://economictimes.indiatimes.com/markets/stocks/news/mcx-shares-rise-2-as-jpmorgan-upgrades-raises-target-price-after-this-sebi-proposal/articleshow/133171178.cms"
  }

];

async function main() {

  const result =
    await processResearch(
      articles
    );

  console.log(
    "\n=========================================="
  );

  console.log(
    "📋 FINAL RESEARCH EVIDENCE"
  );

  console.log(
    "=========================================="
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  console.log(
    "\n=========================================="
  );

  console.log(
    `📊 Articles: ${result.articlesProcessed}`
  );

  console.log(
    `🎯 Claims: ${result.totalClaims}`
  );

  console.log(
    `✅ Verified: ${result.verifiedClaims}`
  );

  console.log(
    `⚠️ Unverified: ${result.unverifiedClaims}`
  );

  console.log(
    "=========================================="
  );
}

main();